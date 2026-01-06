import { addMeasurement } from "@/lib/supabaseQueries";
import {
  assessSignalQuality,
  ButterworthFilter,
  calculateHRV,
  calculateIBI,
  calculatePerfusionIndex,
  calculateSNR,
  calculateSQI,
  estimateHeartRateAutocorrelation,
  estimateRespirationRate,
  HRVMetrics,
  weightedMedian,
} from "@/utils/heartRateDetection";
import Entypo from "@expo/vector-icons/Entypo";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  ScrollView,
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

// ============================================
// HEART RATE MONITOR COMPONENT
// ============================================
// This component uses your phone's camera and flashlight to measure your heart rate.
// How it works: When you place your finger over the camera, the flashlight shines through
// your skin. As your heart beats, blood flows through your finger, changing how much
// light passes through. We detect these tiny changes to calculate your heart rate.

interface HeartRateResult {
  bpm: number;
  timestamp: Date;
}

// Advanced health metrics that provide deeper insights into your cardiovascular health
interface AdvancedMetrics {
  ibi: number; // IBI (Inter-Beat Interval): Time between heartbeats in milliseconds
  hrv: HRVMetrics; // HRV (Heart Rate Variability): How much your heart rate varies - indicates stress/recovery
  rr: number; // RR (Respiration Rate): How many breaths per minute
  pi: number; // PI (Perfusion Index): How well blood is flowing through your finger (circulation quality)
  snr: number; // SNR (Signal-to-Noise Ratio): How clear the signal is (higher = better quality)
  sqi: number; // SQI (Signal Quality Index): Overall quality score of the measurement (0-100%)
}

// ============================================
// MEASUREMENT SETTINGS
// ============================================
const SAMPLING_RATE = 30; // How many times per second we check the camera (30 frames per second)
const WINDOW_SIZE = 180; // How many samples we need before calculating heart rate (about 6 seconds of data)
const FINGER_DETECTED_THRESHOLD = 80; // Light level that means "finger is covering the camera"
const FINGER_LOST_THRESHOLD = 40; // Light level that means "finger was removed"
const MIN_VALID_BPM = 30; // Lowest realistic heart rate (anything lower is probably an error)
const MAX_VALID_BPM = 200; // Highest realistic heart rate (anything higher is probably an error)
const MIN_QUALITY_SCORE = 0.5; // Minimum quality score to accept a reading (0-1 scale)

export default function HeartRateMonitor() {
  // ============================================
  // STATE VARIABLES (App's memory)
  // ============================================
  // These variables keep track of what's currently happening in the app

  const [isMonitoring, setIsMonitoring] = useState(false); // True when actively taking a measurement
  const [currentBPM, setCurrentBPM] = useState<number | null>(null); // Current heart rate in beats per minute
  const [progress, setProgress] = useState(0); // How far along the measurement is (0 to 1, like 0% to 100%)
  const [fingerDetected, setFingerDetected] = useState(false); // True when finger is properly covering the camera
  const [isSaving, setIsSaving] = useState(false); // True when saving the result to the database
  const [advancedMetrics, setAdvancedMetrics] =
    useState<AdvancedMetrics | null>(null); // Stores all the extra health metrics

  // Animation variables - make the heart icon pulse in sync with your heartbeat
  const pulseAnim = useRef(new Animated.Value(1)).current; // Controls heart icon size (scales up and down)
  const fadeAnim = useRef(new Animated.Value(0)).current; // Controls fade-in/fade-out effect

  // Camera setup
  const device = useCameraDevice("back"); // Use the back camera (where the flashlight is)
  const { hasPermission, requestPermission } = useCameraPermission(); // Ask user for camera permission

  const format = useCameraFormat(device, [{ fps: SAMPLING_RATE }]); // Set camera to capture at our sampling rate

  const { resize } = useResizePlugin(); // Tool to resize camera images for faster processing

  // Signal processing tool - filters out noise to get a clean heart rate signal
  const filterRef = useRef(new ButterworthFilter(SAMPLING_RATE));

  // Data storage - keeps track of all the light readings from the camera
  const dataBufferRef = useRef<number[]>([]); // Array of red light intensity values

  // Tracking variables - keep track of where we are in the measurement process
  const detectionPhaseRef = useRef<"waiting" | "measuring">("waiting"); // Either waiting for finger or actively measuring
  const validReadingsRef = useRef<number[]>([]); // Array of valid heart rate readings we've calculated
  const lastProcessTimeRef = useRef<number>(0); // Timestamp of last calculation (to avoid calculating too often)

  // ============================================
  // PULSE ANIMATION EFFECT
  // ============================================
  // Makes the heart icon beat in sync with your actual heart rate
  useEffect(() => {
    if (fingerDetected && currentBPM) {
      // Calculate how long between beats (in milliseconds)
      const interval = 60000 / currentBPM; // 60,000 ms = 1 minute, divided by BPM

      // Create the pulse animation: grow bigger, then shrink back
      const pulse = Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2, // Grow to 120% size
          duration: interval / 3, // Take 1/3 of the beat time to grow
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1, // Shrink back to normal size
          duration: interval / 3, // Take 1/3 of the beat time to shrink
          useNativeDriver: true,
        }),
      ]);
      Animated.loop(pulse).start(); // Keep repeating this animation
    } else {
      pulseAnim.setValue(1); // Reset to normal size when not measuring
    }
  }, [fingerDetected, currentBPM]); // Run this whenever finger detection or BPM changes

  // Smooth fade-in effect when starting measurement, fade-out when stopping
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: isMonitoring ? 1 : 0, // Fade to visible (1) or invisible (0)
      duration: 300, // Take 300 milliseconds (0.3 seconds)
      useNativeDriver: true,
    }).start();
  }, [isMonitoring]); // Run whenever monitoring starts or stops

  // ============================================
  // MAIN PROCESSING FUNCTION
  // ============================================
  // This function runs for every camera frame (30 times per second)
  // It receives the average red light intensity from that frame
  const processFrameData = useCallback((avgRed: number) => {
    const now = Date.now(); // Current time in milliseconds

    // PHASE 1: WAITING FOR FINGER
    // We're waiting for the user to place their finger over the camera
    if (detectionPhaseRef.current === "waiting") {
      // Check if finger is detected (light level is high enough)
      if (avgRed > FINGER_DETECTED_THRESHOLD) {
        // Finger detected! Start the measurement
        setFingerDetected(true);
        detectionPhaseRef.current = "measuring"; // Switch to measuring phase

        // Clear all previous data to start fresh
        dataBufferRef.current = [];
        validReadingsRef.current = [];
        filterRef.current.reset();
        setProgress(0);
      } else {
        // Still waiting for finger
        setFingerDetected(false);
      }
      return; // Exit early, nothing more to do in this phase
    }

    // PHASE 2: MEASURING
    // Finger is detected, now we're collecting data
    if (detectionPhaseRef.current === "measuring") {
      // Check if finger was removed (light level dropped too low)
      if (avgRed < FINGER_LOST_THRESHOLD) {
        // Finger removed! Stop measuring and go back to waiting
        setFingerDetected(false);
        detectionPhaseRef.current = "waiting";
        setProgress(0);
        return;
      }

      // Filter the signal to remove noise and get a cleaner reading
      const filteredValue = filterRef.current.process(avgRed);

      // MOTION DETECTION: Check if there was sudden movement
      // Sudden changes in light usually mean the finger moved
      if (dataBufferRef.current.length > 5) {
        const lastValue =
          dataBufferRef.current[dataBufferRef.current.length - 1];
        const change = Math.abs(filteredValue - lastValue);

        // If the change is too big, it's probably movement - discard recent data
        if (change > 10) {
          dataBufferRef.current = dataBufferRef.current.slice(0, -5); // Remove last 5 readings
          return; // Skip this frame
        }
      }

      // Add this new reading to our collection
      dataBufferRef.current.push(filteredValue);

      // Keep only the most recent readings (sliding window)
      // Once we have enough data, remove the oldest reading each time we add a new one
      if (dataBufferRef.current.length > WINDOW_SIZE) {
        dataBufferRef.current.shift(); // Remove oldest reading
      }

      // Calculate progress: how close are we to having enough data?
      const currentProgress = Math.min(
        dataBufferRef.current.length / WINDOW_SIZE, // Fraction of data collected (0 to 1)
        1 // Cap at 100%
      );
      setProgress(currentProgress); // Update the progress bar

      // CHECK IF READY TO CALCULATE HEART RATE
      // We need enough data AND we shouldn't calculate too often (wait at least 500ms between calculations)
      if (
        dataBufferRef.current.length === WINDOW_SIZE && // Have enough data?
        now - lastProcessTimeRef.current > 500 // Been at least 500ms since last calculation?
      ) {
        lastProcessTimeRef.current = now; // Remember when we did this calculation

        // Step 1: Check if the signal quality is good enough
        const quality = assessSignalQuality(dataBufferRef.current);

        if (quality >= MIN_QUALITY_SCORE) {
          // Step 2: Calculate heart rate using autocorrelation
          // This finds repeating patterns in the data (the heartbeat rhythm)
          const estimatedBPM = estimateHeartRateAutocorrelation(
            dataBufferRef.current,
            SAMPLING_RATE
          );

          // Step 3: Check if the heart rate is realistic (within human range)
          if (estimatedBPM >= MIN_VALID_BPM && estimatedBPM <= MAX_VALID_BPM) {
            // It's valid! Add it to our collection of readings
            validReadingsRef.current.push(estimatedBPM);

            // Step 4: Smooth the result by combining recent readings
            // This reduces random fluctuations and gives a more stable number
            const smoothed = weightedMedian(validReadingsRef.current.slice(-7)); // Use last 7 readings
            setCurrentBPM(Math.round(smoothed)); // Display the rounded result

            // Step 5: Calculate all the extra health metrics
            // These give additional insights into your heart health and signal quality

            // IBI: Find the time between each heartbeat
            const ibis = calculateIBI(dataBufferRef.current, SAMPLING_RATE);
            const avgIBI =
              ibis.length > 0
                ? ibis.reduce((a, b) => a + b, 0) / ibis.length // Average of all intervals
                : 0;

            // HRV: Calculate heart rate variability (how much timing varies beat-to-beat)
            const hrv = calculateHRV(ibis);

            // RR: Estimate breathing rate from the signal
            const rr = estimateRespirationRate(
              dataBufferRef.current,
              SAMPLING_RATE
            );

            // PI: Calculate how well blood is flowing through the finger
            const pi = calculatePerfusionIndex(dataBufferRef.current);

            // SNR: Measure signal clarity (how much real signal vs. noise)
            const snr = calculateSNR(dataBufferRef.current);

            // SQI: Overall quality score combining multiple factors
            const sqi = calculateSQI(dataBufferRef.current);

            // Store all these metrics to display on screen
            setAdvancedMetrics({
              ibi: avgIBI,
              hrv,
              rr,
              pi,
              snr,
              sqi,
            });

            // Step 6: Check if we have enough consistent readings to be confident
            // We want at least 12 valid readings to ensure accuracy
            if (validReadingsRef.current.length >= 12) {
              // We have enough! Save the result and complete the measurement
              finalizeMeasurement(Math.round(smoothed));
            }
          }
        }
      }
    }
  }, []); // Empty dependency array means this function is created once and never changes

  const runOnJsHandler = Worklets.createRunOnJS(processFrameData);

  // ============================================
  // CAMERA FRAME PROCESSOR
  // ============================================
  // This runs 30 times per second, processing each camera frame
  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet"; // Special marker: this code runs on a fast background thread
      if (!isMonitoring) return; // Skip processing if we're not measuring

      // Resize the camera image to a tiny 16x16 pixel square
      // Why? We only need the average color, so this makes it much faster
      const resized = resize(frame, {
        scale: { width: 16, height: 16 },
        pixelFormat: "rgb", // Get red, green, blue color values
        dataType: "uint8", // Numbers from 0-255
      });

      // Calculate the average RED color across all pixels
      // Red light shows blood flow best (that's why medical devices use red LEDs)
      let totalRed = 0;
      const numPixels = resized.length / 3; // Divide by 3 because each pixel has R, G, B
      for (let i = 0; i < resized.length; i += 3) {
        // Jump by 3 to get only Red values
        totalRed += resized[i]; // resized[i] is the Red channel
      }
      const avgRed = totalRed / numPixels; // Average red intensity (0-255)

      // Send this average to our processing function
      runOnJsHandler(avgRed);
    },
    [isMonitoring, runOnJsHandler, resize] // Re-create this function if these values change
  );

  // ============================================
  // START MONITORING
  // ============================================
  // Called when user taps "Start Measurement" button
  const startMonitoring = useCallback(async () => {
    // First, check if we have camera permission
    if (!hasPermission) {
      const granted = await requestPermission(); // Ask user for permission
      if (!granted) return; // They said no, so exit
    }

    // Reset everything to start fresh
    filterRef.current.reset(); // Clear the filter
    dataBufferRef.current = []; // Clear all previous readings
    validReadingsRef.current = []; // Clear previous heart rate calculations
    setCurrentBPM(null); // Clear displayed heart rate
    setAdvancedMetrics(null); // Clear metrics
    setFingerDetected(false); // Not detected yet
    detectionPhaseRef.current = "waiting"; // Start in waiting phase
    setIsMonitoring(true); // Turn on the camera and flashlight
  }, [hasPermission, requestPermission]);

  // ============================================
  // STOP MONITORING
  // ============================================
  // Called when user taps "Cancel" button or measurement is complete
  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false); // Turn off camera and flashlight
    setFingerDetected(false); // Reset finger detection
    detectionPhaseRef.current = "waiting"; // Go back to waiting state
    setProgress(0); // Reset progress bar
  }, []);

  // ============================================
  // FINALIZE MEASUREMENT
  // ============================================
  // Called when we have a confident heart rate reading
  // Saves the result to the database and shows it to the user
  const finalizeMeasurement = async (finalBPM: number) => {
    stopMonitoring(); // Turn off camera and flashlight
    setIsSaving(true); // Show saving indicator

    // Try to save the measurement to the database
    const { error } = await addMeasurement(finalBPM);
    setIsSaving(false); // Hide saving indicator

    // Show the result to the user in a popup
    if (error) {
      // Saving failed, but still show the result
      Alert.alert(
        "Recorded",
        `${finalBPM} BPM (Save Failed: ${error.message})`
      );
    } else {
      // Success! Show the heart rate
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

                {/* Advanced Metrics */}
                {advancedMetrics && (
                  <ScrollView
                    style={styles.metricsScroll}
                    showsVerticalScrollIndicator={false}
                  >
                    <View style={styles.metricsGrid}>
                      {/* IBI */}
                      <View style={styles.metricCard}>
                        <Text style={styles.metricLabel}>IBI</Text>
                        <Text style={styles.metricValue}>
                          {advancedMetrics.ibi.toFixed(0)}
                        </Text>
                        <Text style={styles.metricUnit}>ms</Text>
                      </View>

                      {/* HRV - SDNN */}
                      <View style={styles.metricCard}>
                        <Text style={styles.metricLabel}>SDNN</Text>
                        <Text style={styles.metricValue}>
                          {advancedMetrics.hrv.sdnn.toFixed(1)}
                        </Text>
                        <Text style={styles.metricUnit}>ms</Text>
                      </View>

                      {/* HRV - RMSSD */}
                      <View style={styles.metricCard}>
                        <Text style={styles.metricLabel}>RMSSD</Text>
                        <Text style={styles.metricValue}>
                          {advancedMetrics.hrv.rmssd.toFixed(1)}
                        </Text>
                        <Text style={styles.metricUnit}>ms</Text>
                      </View>

                      {/* HRV - pNN50 */}
                      <View style={styles.metricCard}>
                        <Text style={styles.metricLabel}>pNN50</Text>
                        <Text style={styles.metricValue}>
                          {advancedMetrics.hrv.pnn50.toFixed(1)}
                        </Text>
                        <Text style={styles.metricUnit}>%</Text>
                      </View>

                      {/* HRV - LF/HF */}
                      <View style={styles.metricCard}>
                        <Text style={styles.metricLabel}>LF/HF</Text>
                        <Text style={styles.metricValue}>
                          {advancedMetrics.hrv.lfHfRatio.toFixed(2)}
                        </Text>
                        <Text style={styles.metricUnit}>ratio</Text>
                      </View>

                      {/* RR */}
                      <View style={styles.metricCard}>
                        <Text style={styles.metricLabel}>RR</Text>
                        <Text style={styles.metricValue}>
                          {advancedMetrics.rr > 0
                            ? advancedMetrics.rr.toFixed(1)
                            : "--"}
                        </Text>
                        <Text style={styles.metricUnit}>br/min</Text>
                      </View>

                      {/* PI */}
                      <View style={styles.metricCard}>
                        <Text style={styles.metricLabel}>PI</Text>
                        <Text style={styles.metricValue}>
                          {advancedMetrics.pi.toFixed(2)}
                        </Text>
                        <Text style={styles.metricUnit}>%</Text>
                      </View>

                      {/* SNR */}
                      <View style={styles.metricCard}>
                        <Text style={styles.metricLabel}>SNR</Text>
                        <Text style={styles.metricValue}>
                          {advancedMetrics.snr.toFixed(1)}
                        </Text>
                        <Text style={styles.metricUnit}>dB</Text>
                      </View>

                      {/* SQI */}
                      <View style={styles.metricCard}>
                        <Text style={styles.metricLabel}>SQI</Text>
                        <Text style={styles.metricValue}>
                          {advancedMetrics.sqi.toFixed(0)}
                        </Text>
                        <Text style={styles.metricUnit}>%</Text>
                      </View>
                    </View>
                  </ScrollView>
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

  // Metrics display
  metricsScroll: {
    maxHeight: 200,
    width: "100%",
    marginBottom: 16,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    paddingVertical: 8,
  },
  metricCard: {
    backgroundColor: "rgba(233, 69, 96, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(233, 69, 96, 0.2)",
    borderRadius: 12,
    padding: 8,
    minWidth: 70,
    alignItems: "center",
  },
  metricLabel: {
    color: "#920c0cff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metricValue: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  metricUnit: {
    color: "#a0a0a0",
    fontSize: 9,
    fontWeight: "500",
    marginTop: 1,
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
