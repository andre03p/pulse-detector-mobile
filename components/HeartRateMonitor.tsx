import PulseWave from "@/components/PulseWave";
import { addMeasurement } from "@/lib/supabaseQueries";
import {
  ButterworthFilter,
  calculateAdvancedSQI,
  calculateHRV,
  calculateIBI,
  estimateHeartRateEnsemble,
  weightedMedian,
} from "@/utils/heartRateDetection";
import Entypo from "@expo/vector-icons/Entypo";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

interface AdvancedMetrics {
  rmssd: number;
  hrvReady: boolean;
  ibiCount: number;
}

type CaptureMode = "standard" | "minute";

// ─── Constants ────────────────────────────────────────────────────────────────
const SAMPLING_RATE = 30;

// BPM estimation window: 6 s of signal
const WINDOW_SIZE = 180;

const FINGER_DETECTED_THRESHOLD = 80;
const FINGER_LOST_THRESHOLD = 40;

const MIN_VALID_BPM = 30;
const MAX_VALID_BPM = 200;
const MIN_QUALITY_SCORE = 25;

const MIN_VALID_READINGS = 12;
const MIN_IBI_COUNT_FOR_HRV = 20;

// Durate de măsurare
const MAX_MEASUREMENT_DURATION_MS = 45_000; // Pentru modul standard (timeout de siguranță)
const MINUTE_MEASUREMENT_DURATION_MS = 50_000; // Pentru modul continuu de 1 minut

const MAX_IBI_BUFFER = 300;

// ─── Component ────────────────────────────────────────────────────────────────

export default function HeartRateMonitor() {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [currentBPM, setCurrentBPM] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [fingerDetected, setFingerDetected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [advancedMetrics, setAdvancedMetrics] =
    useState<AdvancedMetrics | null>(null);

  const [mode, setMode] = useState<CaptureMode>("standard");

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const format = useCameraFormat(device, [{ fps: SAMPLING_RATE }]);
  const { resize } = useResizePlugin();

  const filterRef = useRef(new ButterworthFilter(SAMPLING_RATE));
  const dataBufferRef = useRef<number[]>([]);
  const allIBIsRef = useRef<number[]>([]);
  const measurementStartMsRef = useRef<number | null>(null);

  const modeRef = useRef<CaptureMode>("standard");
  const detectionPhaseRef = useRef<"waiting" | "measuring">("waiting");
  const validReadingsRef = useRef<number[]>([]);
  const lastProcessTimeRef = useRef<number>(0);
  const lastWaveUpdateRef = useRef<number>(0);

  const rollingMeanRef = useRef<number>(0);
  const rollingM2Ref = useRef<number>(0);
  const rollingCountRef = useRef<number>(0);

  // ─── Animations ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (fingerDetected && currentBPM) {
      const interval = 50000 / currentBPM;
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

  // ─── Frame processing (JS side) ─────────────────────────────────────────────

  const processFrameData = useCallback((avgRed: number) => {
    const now = Date.now();

    // ── Finger detection phase ──────────────────────────────────────────────
    if (detectionPhaseRef.current === "waiting") {
      if (avgRed > FINGER_DETECTED_THRESHOLD) {
        setFingerDetected(true);
        detectionPhaseRef.current = "measuring";
        measurementStartMsRef.current = now;
        dataBufferRef.current = [];
        validReadingsRef.current = [];
        allIBIsRef.current = [];
        filterRef.current.reset();
        rollingMeanRef.current = 0;
        rollingM2Ref.current = 0;
        rollingCountRef.current = 0;
        setProgress(0);
      } else {
        setFingerDetected(false);
      }
      return;
    }

    // ── Measuring phase ─────────────────────────────────────────────────────
    if (avgRed < FINGER_LOST_THRESHOLD) {
      setFingerDetected(false);
      detectionPhaseRef.current = "waiting";
      measurementStartMsRef.current = null;
      setProgress(0);
      return;
    }

    const filteredValue = filterRef.current.process(avgRed);

    rollingCountRef.current += 1;
    const delta = filteredValue - rollingMeanRef.current;
    rollingMeanRef.current += delta / rollingCountRef.current;
    const delta2 = filteredValue - rollingMeanRef.current;
    rollingM2Ref.current += delta * delta2;

    if (rollingCountRef.current > 30) {
      const rollingStd = Math.sqrt(
        rollingM2Ref.current / rollingCountRef.current,
      );
      const deviation = Math.abs(filteredValue - rollingMeanRef.current);
      if (rollingStd > 0 && deviation > 4 * rollingStd) {
        return; // Skip artifact
      }
    }

    dataBufferRef.current.push(filteredValue);
    if (dataBufferRef.current.length > WINDOW_SIZE) {
      dataBufferRef.current.shift();
    }

    // ── Update progress ───────────────────────────────────────────────────────
    const elapsedMs =
      measurementStartMsRef.current !== null
        ? now - measurementStartMsRef.current
        : 0;

    let currentProgress = 0;
    if (modeRef.current === "minute") {
      // Progresul reflectă cele 50 de secunde
      currentProgress = Math.min(elapsedMs / MINUTE_MEASUREMENT_DURATION_MS, 1);
    } else {
      // Progresul vizual se umple doar pentru mărimea buffer-ului inițial (6s)
      currentProgress = Math.min(dataBufferRef.current.length / WINDOW_SIZE, 1);
    }
    setProgress(currentProgress);

    // ── Waveform display (throttled to ~8 Hz) ───────────────────────────────
    if (now - lastWaveUpdateRef.current > 120) {
      lastWaveUpdateRef.current = now;
      setWaveform(dataBufferRef.current.slice(-120));
    }

    // ── Analysis every 500 ms once the window is full ───────────────────────
    if (
      dataBufferRef.current.length === WINDOW_SIZE &&
      now - lastProcessTimeRef.current > 500
    ) {
      lastProcessTimeRef.current = now;

      const quality = calculateAdvancedSQI(
        dataBufferRef.current,
        SAMPLING_RATE,
      );

      if (quality >= MIN_QUALITY_SCORE) {
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
          const smoothed = weightedMedian(validReadingsRef.current.slice(-7));
          setCurrentBPM(Math.round(smoothed));

          const newIbis = calculateIBI(dataBufferRef.current, SAMPLING_RATE);

          if (newIbis.length > 0) {
            allIBIsRef.current = [...allIBIsRef.current, ...newIbis].slice(
              -MAX_IBI_BUFFER,
            );

            const ibiCount = allIBIsRef.current.length;

            if (ibiCount >= MIN_IBI_COUNT_FOR_HRV) {
              const hrv = calculateHRV(allIBIsRef.current);
              setAdvancedMetrics({
                rmssd: hrv.rmssd,
                hrvReady: true,
                ibiCount,
              });
            } else {
              setAdvancedMetrics({ rmssd: 0, hrvReady: false, ibiCount });
            }
          }

          // ── Finalizare Măsurătoare ──────────────────────────────────────────
          const hasEnoughBpm =
            validReadingsRef.current.length >= MIN_VALID_READINGS;
          const hasEnoughIbi =
            allIBIsRef.current.length >= MIN_IBI_COUNT_FOR_HRV;

          if (modeRef.current === "minute") {
            // Așteptăm exact 50 de secunde
            if (elapsedMs >= MINUTE_MEASUREMENT_DURATION_MS) {
              finalizeMeasurement(Math.round(smoothed));
            }
          } else {
            // Modul standard
            const timedOut = elapsedMs >= MAX_MEASUREMENT_DURATION_MS;
            if (hasEnoughBpm && (hasEnoughIbi || timedOut)) {
              finalizeMeasurement(Math.round(smoothed));
            }
          }
        }
      }
    }
  }, []);

  // ─── Worklet bridge ─────────────────────────────────────────────────────────
  const runOnJsHandler = useMemo(
    () => Worklets.createRunOnJS(processFrameData),
    [processFrameData],
  );

  // ─── Frame processor ────────────────────────────────────────────────────────
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

  // ─── Controls ───────────────────────────────────────────────────────────────

  const startMonitoring = useCallback(async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) return;
    }

    filterRef.current.reset();
    dataBufferRef.current = [];
    validReadingsRef.current = [];
    allIBIsRef.current = [];
    measurementStartMsRef.current = null;
    rollingMeanRef.current = 0;
    rollingM2Ref.current = 0;
    rollingCountRef.current = 0;
    setCurrentBPM(null);
    setAdvancedMetrics(null);
    setWaveform([]);
    setFingerDetected(false);
    detectionPhaseRef.current = "waiting";

    modeRef.current = mode; // Sync state to ref for worklet access
    setIsMonitoring(true);
  }, [hasPermission, requestPermission, mode]);

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    setFingerDetected(false);
    detectionPhaseRef.current = "waiting";
    measurementStartMsRef.current = null;
    setProgress(0);
  }, []);

  const finalizeMeasurement = async (finalBPM: number) => {
    stopMonitoring();
    setIsSaving(true);
    let rmssdToSave: number | null = null;
    if (allIBIsRef.current.length >= MIN_IBI_COUNT_FOR_HRV) {
      const { rmssd } = calculateHRV(allIBIsRef.current);
      if (Number.isFinite(rmssd) && rmssd > 0) {
        rmssdToSave = rmssd;
      }
    }
    const { error } = await addMeasurement(finalBPM, rmssdToSave);
    setIsSaving(false);
    if (error) {
      Alert.alert(
        "Înregistrat",
        `${finalBPM} BPM${rmssdToSave !== null ? `\nRMSSD: ${Math.round(rmssdToSave)} ms` : ""} (Salvare eșuată: ${error.message})`,
      );
    } else {
      Alert.alert(
        "Succes",
        `${finalBPM} BPM${rmssdToSave !== null ? `\nRMSSD: ${Math.round(rmssdToSave)} ms` : ""}`,
      );
    }
  };

  // ─── Permission / device guard ──────────────────────────────────────────────

  if (!device || !hasPermission)
    return (
      <LinearGradient colors={["#3e5c76", "#748cab"]} style={styles.container}>
        <View style={styles.permissionContainer}>
          <Entypo name="camera" size={60} color="#fff" />
          <Text style={styles.permissionText}>
            Acesul la cameră este necesar
          </Text>
          <TouchableOpacity
            onPress={requestPermission}
            style={styles.permissionBtn}
          >
            <Text style={styles.permissionBtnText}>Permite Accesul</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );

  // ─── Render ─────────────────────────────────────────────────────────────────

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
                <Text style={styles.instructionTitle}>Plasează Degetul</Text>
                <Text style={styles.instructionSubtitle}>
                  Acoperă complet camera și blițul
                </Text>
                <View style={styles.tipContainer}>
                  <Text style={styles.tipText}>Ține mâna nemișcată</Text>
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
                    <Text style={styles.statusText}>Măsurare...</Text>
                  </View>
                )}

                <PulseWave data={waveform} height={80} />

                <View style={styles.metricsGrid}>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>HRV-RMSSD</Text>
                    {advancedMetrics?.hrvReady ? (
                      <>
                        <Text style={styles.metricValue}>
                          {advancedMetrics.rmssd.toFixed(1)}
                        </Text>
                        <Text style={styles.metricUnit}>ms</Text>
                      </>
                    ) : (
                      <>
                        <Text
                          style={[styles.metricValue, styles.metricComputing]}
                        >
                          {advancedMetrics
                            ? `${advancedMetrics.ibiCount}/${MIN_IBI_COUNT_FOR_HRV}`
                            : "--"}
                        </Text>
                        <Text style={styles.metricUnit}>bătăi</Text>
                      </>
                    )}
                  </View>
                </View>

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
              disabled={isSaving}
            >
              <Text style={styles.cancelText}>
                {isSaving ? "Se salvează..." : "Anulează"}
              </Text>
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
                {mode === "standard"
                  ? "Măsoară pulsul rapid (aprox. 15 secunde)"
                  : "Măsurătoare continuă timp de 60 de secunde"}
              </Text>
            </View>

            <View style={styles.modeToggle}>
              <TouchableOpacity
                onPress={() => setMode("standard")}
                style={[
                  styles.modeBtn,
                  mode === "standard" && styles.modeBtnActive,
                ]}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.modeBtnText,
                    mode === "standard" && styles.modeBtnTextActive,
                  ]}
                >
                  Standard
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMode("minute")}
                style={[
                  styles.modeBtn,
                  mode === "minute" && styles.modeBtnActive,
                ]}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.modeBtnText,
                    mode === "minute" && styles.modeBtnTextActive,
                  ]}
                >
                  1 Minut
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={startMonitoring} activeOpacity={0.8}>
              <LinearGradient
                colors={["#28080eff", "#ed0909ff"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.startBtn}
              >
                <Entypo name="controller-play" size={24} color="#fff" />
                <Text style={styles.startText}>Start Măsurare</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
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
  permissionBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },

  card: {
    backgroundColor: "rgba(40,8,14,0.95)",
    padding: 20,
    borderRadius: 30,
    alignItems: "center",
    width: "90%",
    maxWidth: 400,
    borderWidth: 1,
    borderColor: "rgba(233,69,96,0.3)",
    shadowColor: "#e94560",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },

  startContainer: { alignItems: "center", width: "100%" },
  welcomeContainer: { alignItems: "center", marginBottom: 24 },

  modeToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 999,
    padding: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(233,69,96,0.25)",
  },
  modeBtn: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 999,
  },
  modeBtnActive: {
    backgroundColor: "#920c0cff",
  },
  modeBtnText: {
    color: "#a0a0a0",
    fontSize: 14,
    fontWeight: "600",
  },
  modeBtnTextActive: {
    color: "#fff",
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
    paddingHorizontal: 10,
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
  startText: { color: "#fff", fontSize: 18, fontWeight: "700" },

  waitingContainer: { alignItems: "center", width: "100%" },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(233,69,96,0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
    borderWidth: 2,
    borderColor: "rgba(233,69,96,0.3)",
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
    backgroundColor: "rgba(233,69,96,0.1)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(233,69,96,0.2)",
  },
  tipText: { color: "#e0e0e0", fontSize: 14 },

  measuringContainer: { alignItems: "center", width: "100%" },
  heartIconContainer: { marginBottom: 12 },
  heartGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#e94560",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  bpmContainer: { alignItems: "center", marginBottom: 8 },
  bpmText: {
    color: "#fff",
    fontSize: 58,
    fontWeight: "800",
    lineHeight: 64,
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
    backgroundColor: "rgba(233,69,96,0.15)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(233,69,96,0.3)",
  },
  pulseIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#12b07cff",
  },
  statusText: { color: "#e0e0e0", fontSize: 14, fontWeight: "600" },

  progressContainer: { width: "100%", alignItems: "center", gap: 8 },
  progressBarWrapper: {
    width: "100%",
    height: 8,
    backgroundColor: "rgba(233,69,96,0.15)",
    borderRadius: 4,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(233,69,96,0.2)",
  },
  progressFill: { height: "100%", borderRadius: 4 },
  progressText: { color: "#a0a0a0", fontSize: 13, fontWeight: "600" },

  metricsGrid: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 8,
  },
  metricCard: {
    backgroundColor: "rgba(233,69,96,0.1)",
    borderWidth: 1,
    borderColor: "rgba(233,69,96,0.2)",
    borderRadius: 12,
    padding: 8,
    minWidth: 80,
    alignItems: "center",
  },
  metricLabel: {
    color: "#920c0cff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metricValue: { color: "#fff", fontSize: 18, fontWeight: "700" },
  metricComputing: { color: "#a0a0a0", fontSize: 14 },
  metricUnit: {
    color: "#a0a0a0",
    fontSize: 9,
    fontWeight: "500",
    marginTop: 1,
  },

  cancelBtn: {
    marginTop: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  cancelText: { color: "#a0a0a0", fontSize: 16, fontWeight: "600" },
});
