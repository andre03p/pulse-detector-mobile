import { addMeasurement } from "@/lib/supabaseQueries";
import {
  ButterworthFilter,
  assessSignalQuality,
  estimateHeartRateAutocorrelation,
  weightedMedian,
} from "@/utils/heartRateDetection";
import Entypo from "@expo/vector-icons/Entypo";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
} from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";
import { useResizePlugin } from "vision-camera-resize-plugin";

interface HeartRateResult {
  bpm: number;
  timestamp: Date;
}

const SAMPLING_RATE = 30;
const WINDOW_SIZE = 180;
const FINGER_DETECTED_THRESHOLD = 80;
const FINGER_LOST_THRESHOLD = 40;
const MIN_VALID_BPM = 50;
const MAX_VALID_BPM = 180;
const MIN_QUALITY_SCORE = 0.5;

export default function HeartRateMonitor() {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [currentBPM, setCurrentBPM] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [fingerDetected, setFingerDetected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();

  const format = useCameraFormat(device, [{ fps: SAMPLING_RATE }]);

  const { resize } = useResizePlugin();

  const filterRef = useRef(new ButterworthFilter(SAMPLING_RATE));

  const dataBufferRef = useRef<number[]>([]);

  const detectionPhaseRef = useRef<"waiting" | "measuring">("waiting");
  const validReadingsRef = useRef<number[]>([]);
  const lastProcessTimeRef = useRef<number>(0);

  useEffect(() => {
    if (fingerDetected && currentBPM) {
      const interval = 60000 / currentBPM;
      const pulse = Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: interval / 3,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: interval / 3,
          useNativeDriver: true,
        }),
      ]);
      Animated.loop(pulse).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [fingerDetected, currentBPM]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: isMonitoring ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isMonitoring]);

  const processFrameData = useCallback((avgRed: number) => {
    const now = Date.now();

    if (detectionPhaseRef.current === "waiting") {
      if (avgRed > FINGER_DETECTED_THRESHOLD) {
        setFingerDetected(true);
        detectionPhaseRef.current = "measuring";
        dataBufferRef.current = [];
        validReadingsRef.current = [];
        filterRef.current.reset();
        setProgress(0);
      } else {
        setFingerDetected(false);
      }
      return;
    }

    if (detectionPhaseRef.current === "measuring") {
      if (avgRed < FINGER_LOST_THRESHOLD) {
        setFingerDetected(false);
        detectionPhaseRef.current = "waiting";
        setProgress(0);
        return;
      }

      const filteredValue = filterRef.current.process(avgRed);

      if (dataBufferRef.current.length > 5) {
        const lastValue =
          dataBufferRef.current[dataBufferRef.current.length - 1];
        const change = Math.abs(filteredValue - lastValue);

        if (change > 10) {
          dataBufferRef.current = dataBufferRef.current.slice(0, -5);
          return;
        }
      }

      dataBufferRef.current.push(filteredValue);

      if (dataBufferRef.current.length > WINDOW_SIZE) {
        dataBufferRef.current.shift();
      }

      const currentProgress = Math.min(
        dataBufferRef.current.length / WINDOW_SIZE,
        1
      );
      setProgress(currentProgress);

      if (
        dataBufferRef.current.length === WINDOW_SIZE &&
        now - lastProcessTimeRef.current > 500
      ) {
        lastProcessTimeRef.current = now;

        const quality = assessSignalQuality(dataBufferRef.current);

        if (quality >= MIN_QUALITY_SCORE) {
          const estimatedBPM = estimateHeartRateAutocorrelation(
            dataBufferRef.current,
            SAMPLING_RATE
          );

          if (estimatedBPM >= MIN_VALID_BPM && estimatedBPM <= MAX_VALID_BPM) {
            validReadingsRef.current.push(estimatedBPM);

            const smoothed = weightedMedian(validReadingsRef.current.slice(-7));
            setCurrentBPM(Math.round(smoothed));

            if (validReadingsRef.current.length >= 12) {
              finalizeMeasurement(Math.round(smoothed));
            }
          }
        }
      }
    }
  }, []);

  const runOnJsHandler = Worklets.createRunOnJS(processFrameData);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      if (!isMonitoring) return;

      // Resize to 16x16 for efficient average calculation
      const resized = resize(frame, {
        scale: { width: 16, height: 16 },
        pixelFormat: "rgb",
        dataType: "uint8",
      });

      // Calculate average Red channel intensity
      let totalRed = 0;
      const numPixels = resized.length / 3;
      for (let i = 0; i < resized.length; i += 3) {
        totalRed += resized[i];
      }
      const avgRed = totalRed / numPixels;

      runOnJsHandler(avgRed);
    },
    [isMonitoring, runOnJsHandler, resize]
  );

  const startMonitoring = useCallback(async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) return;
    }
    filterRef.current.reset();
    dataBufferRef.current = [];
    validReadingsRef.current = [];
    setCurrentBPM(null);
    setFingerDetected(false);
    detectionPhaseRef.current = "waiting";
    setIsMonitoring(true);
  }, [hasPermission, requestPermission]);

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    setFingerDetected(false);
    detectionPhaseRef.current = "waiting";
    setProgress(0);
  }, []);

  const finalizeMeasurement = async (finalBPM: number) => {
    stopMonitoring();
    setIsSaving(true);
    const { error } = await addMeasurement(finalBPM);
    setIsSaving(false);

    if (error) {
      Alert.alert(
        "Recorded",
        `${finalBPM} BPM (Save Failed: ${error.message})`
      );
    } else {
      Alert.alert("Success", `${finalBPM} BPM`);
    }
  };

  if (!device || !hasPermission)
    return (
      <LinearGradient colors={["#3e5c76", "#748cab"]} style={styles.container}>
        <View style={styles.permissionContainer}>
          <Entypo name="camera" size={60} colors={["#28080eff", "#920c0cff"]} />
          <Text style={styles.permissionText}>Camera Access Required</Text>
          <TouchableOpacity
            onPress={requestPermission}
            style={styles.permissionBtn}
          >
            <Text style={styles.permissionBtnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={true}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
        torch={isMonitoring ? "on" : "off"}
      />

      <View style={styles.darkOverlay} />

      <View style={styles.overlay}>
        {isMonitoring ? (
          <Animated.View style={[styles.card, { opacity: fadeAnim }]}>
            {!fingerDetected ? (
              <View style={styles.waitingContainer}>
                <View style={styles.iconContainer}>
                  <Ionicons name="finger-print" size={54} color="black" />
                </View>
                <Text style={styles.instructionTitle}>Place Your Finger</Text>
                <Text style={styles.instructionSubtitle}>
                  Cover the camera and flash completely
                </Text>
                <View style={styles.tipContainer}>
                  <Text style={styles.tipText}>Keep your hand steady</Text>
                </View>
              </View>
            ) : (
              <View style={styles.measuringContainer}>
                <Animated.View
                  style={[
                    styles.heartIconContainer,
                    { transform: [{ scale: pulseAnim }] },
                  ]}
                >
                  <LinearGradient
                    colors={["#28080eff", "#920c0cff"]}
                    style={styles.heartGradient}
                  >
                    <Entypo name="heart" size={50} color="#fff" />
                  </LinearGradient>
                </Animated.View>

                <View style={styles.bpmContainer}>
                  <Text style={styles.bpmText}>
                    {currentBPM ? `${currentBPM}` : "--"}
                  </Text>
                  <Text style={styles.bpmLabel}>BPM</Text>
                </View>

                {currentBPM && (
                  <View style={styles.statusBadge}>
                    <View style={styles.pulseIndicator} />
                    <Text style={styles.statusText}>Measuring...</Text>
                  </View>
                )}

                <View style={styles.progressContainer}>
                  <View style={styles.progressBarWrapper}>
                    <LinearGradient
                      colors={["#28080eff", "#920c0cff"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[
                        styles.progressFill,
                        { width: `${progress * 100}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressText}>
                    {Math.round(progress * 100)}%
                  </Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              onPress={stopMonitoring}
              style={styles.cancelBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <View style={styles.startContainer}>
            <View style={styles.welcomeContainer}>
              <LinearGradient
                colors={["#28080eff", "#920c0cff"]}
                style={styles.welcomeIconContainer}
              >
                <Entypo name="heart" size={60} color="#fff" />
              </LinearGradient>
              <Text style={styles.welcomeTitle}>Heart Rate Monitor</Text>
              <Text style={styles.welcomeSubtitle}>
                Measure your pulse in 15 seconds
              </Text>
            </View>

            <TouchableOpacity onPress={startMonitoring} activeOpacity={0.8}>
              <LinearGradient
                colors={["#28080eff", "#ed0909ff"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.startBtn}
              >
                <Entypo name="controller-play" size={24} color="#fff" />
                <Text style={styles.startText}>Start Measurement</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },

  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  permissionText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "600",
    marginTop: 24,
    marginBottom: 16,
    textAlign: "center",
  },
  permissionBtn: {
    backgroundColor: "#920c0cff",
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 30,
    marginTop: 16,
  },
  permissionBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  card: {
    backgroundColor: "rgba(40, 8, 14, 0.95)",
    padding: 32,
    borderRadius: 30,
    alignItems: "center",
    width: "90%",
    maxWidth: 400,
    borderWidth: 1,
    borderColor: "rgba(233, 69, 96, 0.3)",
    shadowColor: "#e94560",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },

  startContainer: {
    alignItems: "center",
    width: "100%",
  },
  welcomeContainer: {
    alignItems: "center",
    marginBottom: 40,
  },
  welcomeIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
    shadowColor: "#e94560",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  welcomeTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  welcomeSubtitle: {
    color: "#a0a0a0",
    fontSize: 16,
    textAlign: "center",
  },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 40,
    paddingVertical: 18,
    borderRadius: 30,
    shadowColor: "#e94560",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  startText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },

  waitingContainer: {
    alignItems: "center",
    width: "100%",
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(233, 69, 96, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
    borderWidth: 2,
    borderColor: "rgba(233, 69, 96, 0.3)",
  },
  instructionTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  instructionSubtitle: {
    color: "#a0a0a0",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 20,
  },
  tipContainer: {
    backgroundColor: "rgba(233, 69, 96, 0.1)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(233, 69, 96, 0.2)",
  },
  tipText: {
    color: "#e0e0e0",
    fontSize: 14,
  },

  measuringContainer: {
    alignItems: "center",
    width: "100%",
  },
  heartIconContainer: {
    marginBottom: 24,
  },
  heartGradient: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#e94560",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  bpmContainer: {
    alignItems: "center",
    marginBottom: 16,
  },
  bpmText: {
    color: "#fff",
    fontSize: 72,
    fontWeight: "800",
    lineHeight: 80,
    letterSpacing: -2,
  },
  bpmLabel: {
    color: "#920c0cff",
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: 2,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(233, 69, 96, 0.15)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(233, 69, 96, 0.3)",
  },
  pulseIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#12b07cff",
  },
  statusText: {
    color: "#e0e0e0",
    fontSize: 14,
    fontWeight: "600",
  },
  progressContainer: {
    width: "100%",
    alignItems: "center",
    gap: 8,
  },
  progressBarWrapper: {
    width: "100%",
    height: 8,
    backgroundColor: "rgba(233, 69, 96, 0.15)",
    borderRadius: 4,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(233, 69, 96, 0.2)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
  },
  progressText: {
    color: "#a0a0a0",
    fontSize: 13,
    fontWeight: "600",
  },

  cancelBtn: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  cancelText: {
    color: "#a0a0a0",
    fontSize: 16,
    fontWeight: "600",
  },
});
