import { addMeasurement } from "@/lib/supabaseQueries";
import { BandPassFilter, PulseDetector } from "@/utils/heartRateDetection";
import Entypo from "@expo/vector-icons/Entypo";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
} from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";
import { useResizePlugin } from "vision-camera-resize-plugin";

// --- Types ---
interface HeartRateResult {
  bpm: number;
  timestamp: Date;
}

export default function HeartRateMonitor() {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [currentBPM, setCurrentBPM] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [fingerDetected, setFingerDetected] = useState(false);

  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();

  const format = useCameraFormat(device, [
    { fps: 30 },
    { videoResolution: "max" }, // Max res helps with light gathering, but 1080p is sufficient
  ]);

  const { resize } = useResizePlugin();

  // --- Processing Refs ---
  const filterRef = useRef(new BandPassFilter());
  const detectorRef = useRef(new PulseDetector());
  const redValueHistoryRef = useRef<number[]>([]);
  const measurementStartTimeRef = useRef<number>(0);
  const detectionPhaseRef = useRef<"waiting" | "measuring">("waiting");
  const fingerDetectedRef = useRef<boolean>(false);
  const currentBPMRef = useRef<number | null>(null);

  // --- Core Logic (Runs on JS Thread) ---
  // We define this using useCallback so the reference stays stable
  const processFrameData = useCallback((avgRed: number) => {
    const now = Date.now() / 1000;

    // 1. Maintain a history buffer
    redValueHistoryRef.current.push(avgRed);
    if (redValueHistoryRef.current.length > 30) {
      redValueHistoryRef.current.shift();
    }

    // 2. Phase: Waiting for Finger
    if (detectionPhaseRef.current === "waiting") {
      // DETECTING FINGER:
      // When flash is on and finger covers lens, the image is BRIGHT RED.
      // Threshold: We check if average Red is high (0-255 scale).
      // A solid red finger is usually > 150, but we use > 60 to be safe across devices.
      if (redValueHistoryRef.current.length >= 5) {
        const recent = redValueHistoryRef.current.slice(-5);
        // Check if values are consistently high (finger is stable)
        const isCovered = recent.every((val) => val > 100);

        if (isCovered) {
          console.log("FINGER DETECTED - Starting Measure");
          detectionPhaseRef.current = "measuring";
          setFingerDetected(true);
          measurementStartTimeRef.current = Date.now();
          setCountdown(15);
        }
      }
    }
    // 3. Phase: Measuring
    else if (detectionPhaseRef.current === "measuring") {
      // Finger Removal Check: If brightness drops, finger is gone
      if (avgRed < 30) {
        setFingerDetected(false);
        detectionPhaseRef.current = "waiting";
        Alert.alert(
          "Finger Removed",
          "Please keep your finger covering the camera and flash."
        );
        stopMonitoring();
        return;
      }

      // Signal Processing
      const filtered = filterRef.current.processValue(avgRed);
      detectorRef.current.addNewValue(filtered, now);

      // Get BPM
      const avgPeriod = detectorRef.current.getAverage();
      if (avgPeriod > 0) {
        const bpm = Math.round(60 / avgPeriod);
        // Realistic bounds for human heart rate
        if (bpm >= 40 && bpm <= 220) {
          currentBPMRef.current = bpm;
          setCurrentBPM(bpm);
        }
      }

      // Countdown Timer
      if (measurementStartTimeRef.current > 0) {
        const elapsed = Math.floor(
          (Date.now() - measurementStartTimeRef.current) / 1000
        );
        const remaining = 15 - elapsed;

        if (remaining <= 0) {
          finalizeMeasurement();
        } else {
          setCountdown(remaining);
        }
      }
    }
  }, []);

  // Wrap the JS function to be callable from the Worklet (UI Thread)
  const runOnJsHandler = Worklets.createRunOnJS(processFrameData);

  // --- Frame Processor (Runs on Background Thread) ---
  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";

      // Safety check: Only run if monitoring
      if (!isMonitoring) return;

      try {
        // Resize 1080p/4k frame down to 16x16 pixels.
        // We only need the average color, so high res is not needed.
        const resized = resize(frame, {
          scale: { width: 16, height: 16 },
          pixelFormat: "rgb",
          dataType: "uint8",
        });

        // Calculate Average Red
        // resized is a Uint8Array: [R, G, B, R, G, B, ...]
        let totalRed = 0;
        const numPixels = resized.length / 3;

        for (let i = 0; i < resized.length; i += 3) {
          totalRed += resized[i];
        }

        const avgRed = totalRed / numPixels;

        // Pass to JS thread
        runOnJsHandler(avgRed);
      } catch (e) {
        console.log("Frame processing error:", e);
      }
    },
    [isMonitoring, runOnJsHandler, resize]
  );

  // --- Control Functions ---
  const startMonitoring = useCallback(async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) return;
    }

    console.log("Initializing monitoring...");

    // Reset Logic
    filterRef.current.reset();
    detectorRef.current.reset();
    redValueHistoryRef.current = [];
    currentBPMRef.current = null;
    measurementStartTimeRef.current = 0;

    // Set State
    setCurrentBPM(null);
    setFingerDetected(false);
    detectionPhaseRef.current = "waiting";
    setIsMonitoring(true);
  }, [hasPermission, requestPermission]);

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    setFingerDetected(false);
    setCountdown(0);
    detectionPhaseRef.current = "waiting";
  }, []);

  const finalizeMeasurement = async () => {
    stopMonitoring();
    const finalBPM = currentBPMRef.current;

    if (finalBPM) {
      setIsSaving(true);

      // Save measurement to database
      const { data, error } = await addMeasurement(finalBPM);

      setIsSaving(false);

      if (error) {
        Alert.alert(
          "Measurement Recorded",
          `Heart Rate: ${finalBPM} BPM\n\nNote: Could not save to history. ${error.message}`,
          [{ text: "OK" }]
        );
      } else {
        Alert.alert(
          "Success",
          `Heart Rate: ${finalBPM} BPM\n\nMeasurement saved successfully!`,
          [{ text: "OK" }]
        );
      }
    } else {
      Alert.alert("Error", "Could not get a clear reading. Please try again.");
    }
  };

  // --- Render ---
  if (!hasPermission)
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>No Permission</Text>
      </View>
    );
  if (!device)
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>No Camera Device</Text>
      </View>
    );

  return (
    <View style={styles.container}>
      {/* CRITICAL: 
         1. isActive must be true for the Torch to turn on.
         2. torch prop must be dynamic.
         3. pixelFormat="yuv" ensures the resize plugin works fastest.
      */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={true} // Keep camera active to avoid "warm up" delay on torch
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
        torch={isMonitoring ? "on" : "off"}
        enableZoomGesture={false}
      />

      <View style={styles.overlay}>
        {isMonitoring ? (
          <>
            <View style={styles.instructionCard}>
              <Entypo
                name="hand"
                size={50}
                color="#f0ebd8"
                style={styles.icon}
              />
              {!fingerDetected ? (
                <>
                  <Text style={styles.instructionText}>
                    Cover Camera & Flash
                  </Text>
                  <Text style={styles.detectingText}>
                    Detecting finger... (Avg Red)
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.instructionText}>Hold Still</Text>
                  <Text style={styles.instructionSubtext}>
                    Measuring Heart Rate...
                  </Text>
                </>
              )}
            </View>

            {fingerDetected && (
              <View style={styles.measurementCard}>
                <Text style={styles.countdownText}>{countdown}s</Text>
                <View style={styles.bpmDisplay}>
                  <Text style={styles.bpmValue}>{currentBPM || "--"}</Text>
                  <Text style={styles.bpmLabel}>BPM</Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              onPress={stopMonitoring}
              style={styles.stopButton}
            >
              <Text style={styles.stopButtonText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.centerContent}>
            <Entypo
              name="heart"
              size={60}
              color="#f0ebd8"
              style={{ marginBottom: 20 }}
            />
            <Text style={styles.instructionTitle}>Heart Rate Monitor</Text>
            <Text style={styles.instructionBody}>
              Place your finger over the camera lens and flash to begin.
            </Text>
            <TouchableOpacity onPress={startMonitoring}>
              <LinearGradient
                colors={["#3e5c76", "#748cab"]}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Start Measurement</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1d2d44" },
  overlay: { flex: 1, padding: 20, justifyContent: "center" },
  centerContent: { alignItems: "center", justifyContent: "center" },
  permissionText: {
    fontSize: 18,
    color: "#f0ebd8",
    textAlign: "center",
    marginTop: 100,
  },
  instructionCard: {
    backgroundColor: "rgba(13, 19, 33, 0.8)",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 20,
  },
  icon: { marginBottom: 12 },
  instructionText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#f0ebd8",
    textAlign: "center",
  },
  instructionSubtext: {
    fontSize: 14,
    color: "#748cab",
    textAlign: "center",
    marginTop: 4,
  },
  detectingText: {
    fontSize: 12,
    color: "#f0ebd8",
    marginTop: 8,
    fontStyle: "italic",
  },
  instructionTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 10,
  },
  instructionBody: {
    fontSize: 16,
    color: "#748cab",
    textAlign: "center",
    marginBottom: 30,
  },
  measurementCard: {
    backgroundColor: "rgba(13, 19, 33, 0.8)",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 20,
  },
  countdownText: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#748cab",
    marginBottom: 10,
  },
  bpmDisplay: { alignItems: "center" },
  bpmValue: { fontSize: 48, fontWeight: "bold", color: "#f0ebd8" },
  bpmLabel: { fontSize: 16, color: "#748cab" },
  button: { paddingHorizontal: 40, paddingVertical: 18, borderRadius: 12 },
  buttonText: { color: "#f0ebd8", fontSize: 18, fontWeight: "bold" },
  stopButton: {
    backgroundColor: "#c1121f",
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    alignSelf: "center",
  },
  stopButtonText: { color: "#f0ebd8", fontSize: 18, fontWeight: "bold" },
});
