import PulseWave from "@/components/PulseWave";
import { addMeasurement } from "@/lib/supabaseQueries";
import {
  ButterworthFilter,
  calculateHRV,
  calculateIBI,
  checkSignalQuality,
  estimateHeartRateEnsemble,
  estimateRespirationRate,
  HRVMetrics,
  median,
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

interface Metrics {
  hrv: HRVMetrics;
  rr: number;
}

const SAMPLING_RATE = 30;
const WINDOW_SIZE = 270; // 9 s of signal at 30 fps — enough for RR (needs 8 s) and good FFT resolution
const FINGER_DETECTED_THRESHOLD = 80;
const FINGER_LOST_THRESHOLD = 40;
const MIN_VALID_BPM = 30;
const MAX_VALID_BPM = 200;

export default function HeartRateMonitor() {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [currentBPM, setCurrentBPM] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [fingerDetected, setFingerDetected] = useState(false);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

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
  const lastWaveUpdateRef = useRef<number>(0);
  const metricsRef = useRef<Metrics | null>(null);

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

      const filtered = filterRef.current.process(avgRed);

      // Reject frames with sudden large jumps (motion artifact)
      if (dataBufferRef.current.length > 5) {
        const last = dataBufferRef.current[dataBufferRef.current.length - 1];
        if (Math.abs(filtered - last) > 10) {
          dataBufferRef.current = dataBufferRef.current.slice(0, -5);
          return;
        }
      }

      dataBufferRef.current.push(filtered);
      if (dataBufferRef.current.length > WINDOW_SIZE) {
        dataBufferRef.current.shift();
      }

      // Throttle waveform updates to ~8 fps
      if (now - lastWaveUpdateRef.current > 120) {
        lastWaveUpdateRef.current = now;
        setWaveform(dataBufferRef.current.slice(-120));
      }

      setProgress(Math.min(dataBufferRef.current.length / WINDOW_SIZE, 1));

      // Run analysis every 500 ms once buffer is full
      if (
        dataBufferRef.current.length === WINDOW_SIZE &&
        now - lastProcessTimeRef.current > 500
      ) {
        lastProcessTimeRef.current = now;

        if (!checkSignalQuality(dataBufferRef.current)) return;

        // Ensemble HR: FFT + autocorrelation
        const estimate = estimateHeartRateEnsemble(
          dataBufferRef.current,
          SAMPLING_RATE,
        );

        if (
          estimate.bpm >= MIN_VALID_BPM &&
          estimate.bpm <= MAX_VALID_BPM &&
          estimate.confidence >= 0.4
        ) {
          validReadingsRef.current.push(estimate.bpm);

          // Smooth over last 5 estimates
          const smoothed = median(validReadingsRef.current.slice(-5));
          setCurrentBPM(Math.round(smoothed));

          // HRV
          const ibis = calculateIBI(dataBufferRef.current, SAMPLING_RATE);
          const hrv = calculateHRV(ibis);

          // Respiratory rate (needs ≥ 8 s of data)
          const rr = estimateRespirationRate(dataBufferRef.current, SAMPLING_RATE);

          metricsRef.current = { hrv, rr };
          setMetrics({ hrv, rr });

          if (validReadingsRef.current.length >= 12) {
            finalizeMeasurement(Math.round(smoothed));
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

      const resized = resize(frame, {
        scale: { width: 16, height: 16 },
        pixelFormat: "rgb",
        dataType: "uint8",
      });

      let totalRed = 0;
      const numPixels = resized.length / 3;
      for (let i = 0; i < resized.length; i += 3) {
        totalRed += resized[i];
      }
      runOnJsHandler(totalRed / numPixels);
    },
    [isMonitoring, runOnJsHandler, resize],
  );

  const startMonitoring = useCallback(async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) return;
    }
    filterRef.current.reset();
    dataBufferRef.current = [];
    validReadingsRef.current = [];
    metricsRef.current = null;
    setCurrentBPM(null);
    setMetrics(null);
    setWaveform([]);
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
    const finalMetrics = metricsRef.current;
    stopMonitoring();
    const { error } = await addMeasurement(finalBPM);

    const lines: string[] = [`Heart Rate: ${finalBPM} BPM`];
    if (finalMetrics) {
      if (finalMetrics.hrv.sdnn > 0) {
        lines.push(`SDNN: ${finalMetrics.hrv.sdnn.toFixed(1)} ms`);
        lines.push(`RMSSD: ${finalMetrics.hrv.rmssd.toFixed(1)} ms`);
      }
      if (finalMetrics.rr > 0) {
        lines.push(`Respiration: ${finalMetrics.rr.toFixed(1)} br/min`);
      }
    }
    if (error) lines.push(`(Save failed: ${error.message})`);

    Alert.alert("Measurement Complete", lines.join("\n"));
  };

  if (!device || !hasPermission)
    return (
      <LinearGradient colors={["#3e5c76", "#748cab"]} style={styles.container}>
        <View style={styles.permissionContainer}>
          <Entypo name="camera" size={60} colors={["#28080eff", "#920c0cff"]} />
          <Text style={styles.permissionText}>Camera Access Required</Text>
          <TouchableOpacity onPress={requestPermission} style={styles.permissionBtn}>
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

                <PulseWave data={waveform} height={80} />

                {metrics && (
                  <View style={styles.metricsRow}>
                    <View style={styles.metricCard}>
                      <Text style={styles.metricLabel}>SDNN</Text>
                      <Text style={styles.metricValue}>
                        {metrics.hrv.sdnn > 0 ? metrics.hrv.sdnn.toFixed(1) : "--"}
                      </Text>
                      <Text style={styles.metricUnit}>ms</Text>
                    </View>

                    <View style={styles.metricCard}>
                      <Text style={styles.metricLabel}>RMSSD</Text>
                      <Text style={styles.metricValue}>
                        {metrics.hrv.rmssd > 0 ? metrics.hrv.rmssd.toFixed(1) : "--"}
                      </Text>
                      <Text style={styles.metricUnit}>ms</Text>
                    </View>

                    <View style={styles.metricCard}>
                      <Text style={styles.metricLabel}>RR</Text>
                      <Text style={styles.metricValue}>
                        {metrics.rr > 0 ? metrics.rr.toFixed(1) : "--"}
                      </Text>
                      <Text style={styles.metricUnit}>br/min</Text>
                    </View>
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

  metricsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
    marginTop: 8,
  },
  metricCard: {
    backgroundColor: "rgba(233, 69, 96, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(233, 69, 96, 0.2)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    minWidth: 78,
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
