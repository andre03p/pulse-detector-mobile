import PulseWave from "@/components/PulseWave";
import { addMeasurement } from "@/lib/supabaseQueries";
import {
  ButterworthFilter,
  calculateAdvancedSQI,
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
  Modal,
  StyleSheet,
  Text,
  TextInput,
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

// Measurement durations
const MAX_MEASUREMENT_DURATION_MS = 45_000; // Standard mode (safety timeout)
const MINUTE_MEASUREMENT_DURATION_MS = 50_000; // Continuous 1-minute mode

export const PRESET_TAGS = ["Rest", "Low effort", "High effort"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function HeartRateMonitor() {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [currentBPM, setCurrentBPM] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [fingerDetected, setFingerDetected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [waveform, setWaveform] = useState<number[]>([]);

  const [mode, setMode] = useState<CaptureMode>("standard");

  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [pendingBPM, setPendingBPM] = useState<number | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [customTag, setCustomTag] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const format = useCameraFormat(device, [{ fps: SAMPLING_RATE }]);
  const { resize } = useResizePlugin();

  const filterRef = useRef(new ButterworthFilter(SAMPLING_RATE));
  const dataBufferRef = useRef<number[]>([]);
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
      currentProgress = Math.min(elapsedMs / MINUTE_MEASUREMENT_DURATION_MS, 1);
    } else {
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

          // ── Finalize measurement ────────────────────────────────────────────
          const hasEnoughBpm =
            validReadingsRef.current.length >= MIN_VALID_READINGS;

          if (modeRef.current === "minute") {
            if (elapsedMs >= MINUTE_MEASUREMENT_DURATION_MS) {
              finalizeMeasurement(Math.round(smoothed));
            }
          } else {
            const timedOut = elapsedMs >= MAX_MEASUREMENT_DURATION_MS;
            if (hasEnoughBpm || timedOut) {
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
    measurementStartMsRef.current = null;
    rollingMeanRef.current = 0;
    rollingM2Ref.current = 0;
    rollingCountRef.current = 0;
    setCurrentBPM(null);
    setWaveform([]);
    setFingerDetected(false);
    detectionPhaseRef.current = "waiting";

    modeRef.current = mode;
    setIsMonitoring(true);
  }, [hasPermission, requestPermission, mode]);

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    setFingerDetected(false);
    detectionPhaseRef.current = "waiting";
    measurementStartMsRef.current = null;
    setProgress(0);
  }, []);

  const finalizeMeasurement = (finalBPM: number) => {
    stopMonitoring();
    setPendingBPM(finalBPM);
    setSelectedTag(null);
    setCustomTag("");
    setShowCustomInput(false);
    setTagModalVisible(true);
  };

  const persistMeasurement = async (tagToSave: string | null) => {
    if (pendingBPM === null) return;
    setIsSaving(true);
    const { error } = await addMeasurement(pendingBPM, tagToSave);
    setIsSaving(false);
    setTagModalVisible(false);
    const finalBPM = pendingBPM;
    setPendingBPM(null);
    if (error) {
      Alert.alert(
        "Saved",
        `${finalBPM} BPM${tagToSave ? `\nTag: ${tagToSave}` : ""} (Save failed: ${error.message})`,
      );
    } else {
      Alert.alert(
        "Success",
        `${finalBPM} BPM${tagToSave ? `\nTag: ${tagToSave}` : ""}`,
      );
    }
  };

  const handleSaveWithTag = () => {
    let tag: string | null = null;
    if (showCustomInput) {
      const trimmed = customTag.trim();
      if (trimmed.length > 0) tag = trimmed;
    } else if (selectedTag) {
      tag = selectedTag;
    }
    void persistMeasurement(tag);
  };

  const handleSkipTag = () => {
    void persistMeasurement(null);
  };

  // ─── Permission / device guard ──────────────────────────────────────────────

  if (!device || !hasPermission)
    return (
      <LinearGradient colors={["#3e5c76", "#748cab"]} style={styles.container}>
        <View style={styles.permissionContainer}>
          <Entypo name="camera" size={60} color="#fff" />
          <Text style={styles.permissionText}>
            Camera access is required
          </Text>
          <TouchableOpacity
            onPress={requestPermission}
            style={styles.permissionBtn}
          >
            <Text style={styles.permissionBtnText}>Grant Access</Text>
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
                <Text style={styles.instructionTitle}>Place Your Finger</Text>
                <Text style={styles.instructionSubtitle}>
                  Fully cover the camera and flash
                </Text>
                <View style={styles.tipContainer}>
                  <Text style={styles.tipText}>Keep your hand still</Text>
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
                {isSaving ? "Saving..." : "Cancel"}
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
                  ? "Quick measurement (about 15 seconds)"
                  : "Continuous measurement for 60 seconds"}
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
                  1 Minute
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
                <Text style={styles.startText}>Start Measurement</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── Tag selection modal ── */}
      <Modal
        visible={tagModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleSkipTag}
      >
        <View style={tagStyles.overlay}>
          <View style={tagStyles.sheet}>
            <Text style={tagStyles.title}>Measurement complete</Text>
            <View style={tagStyles.bpmRow}>
              <Text style={tagStyles.bpmBig}>{pendingBPM ?? "--"}</Text>
              <Text style={tagStyles.bpmUnit}>BPM</Text>
            </View>

            <Text style={tagStyles.subtitle}>Add a tag (optional)</Text>

            {!showCustomInput ? (
              <>
                <View style={tagStyles.chipsWrap}>
                  {PRESET_TAGS.map((t) => {
                    const active = selectedTag === t;
                    return (
                      <TouchableOpacity
                        key={t}
                        onPress={() =>
                          setSelectedTag(active ? null : t)
                        }
                        style={[
                          tagStyles.chip,
                          active && tagStyles.chipActive,
                        ]}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            tagStyles.chipText,
                            active && tagStyles.chipTextActive,
                          ]}
                        >
                          {t}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    onPress={() => {
                      setShowCustomInput(true);
                      setSelectedTag(null);
                    }}
                    style={[tagStyles.chip, tagStyles.chipCustom]}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="add" size={14} color="#f0ebd8" />
                    <Text style={tagStyles.chipText}>Custom</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={tagStyles.customWrap}>
                <TextInput
                  value={customTag}
                  onChangeText={setCustomTag}
                  placeholder="Type a tag..."
                  placeholderTextColor="#748cab"
                  style={tagStyles.input}
                  maxLength={40}
                  autoFocus
                />
                <TouchableOpacity
                  onPress={() => {
                    setShowCustomInput(false);
                    setCustomTag("");
                  }}
                  style={tagStyles.backBtn}
                >
                  <Ionicons name="arrow-back" size={16} color="#748cab" />
                  <Text style={tagStyles.backBtnText}>Back to suggestions</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={tagStyles.actions}>
              <TouchableOpacity
                onPress={handleSkipTag}
                style={tagStyles.skipBtn}
                disabled={isSaving}
                activeOpacity={0.7}
              >
                <Text style={tagStyles.skipText}>
                  {isSaving ? "..." : "Skip"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveWithTag}
                style={[
                  tagStyles.saveBtn,
                  (isSaving ||
                    (!selectedTag &&
                      (!showCustomInput || customTag.trim().length === 0))) &&
                    tagStyles.saveBtnDisabled,
                ]}
                disabled={
                  isSaving ||
                  (!selectedTag &&
                    (!showCustomInput || customTag.trim().length === 0))
                }
                activeOpacity={0.8}
              >
                <Text style={tagStyles.saveText}>
                  {isSaving ? "Saving..." : "Save"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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

  progressContainer: { width: "100%", alignItems: "center", gap: 8, marginTop: 8 },
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

const tagStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#0d1321",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "#3e5c76",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f0ebd8",
    textAlign: "center",
    marginBottom: 12,
  },
  bpmRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "baseline",
    marginBottom: 18,
  },
  bpmBig: {
    color: "#f0ebd8",
    fontSize: 48,
    fontWeight: "800",
    letterSpacing: -1,
  },
  bpmUnit: {
    color: "#748cab",
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#b8c5d6",
    textAlign: "center",
    marginBottom: 14,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    marginBottom: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3e5c76",
    backgroundColor: "#050000",
  },
  chipActive: {
    backgroundColor: "#3e5c76",
    borderColor: "#748cab",
  },
  chipCustom: {
    borderStyle: "dashed",
  },
  chipText: {
    color: "#f0ebd8",
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: "#f0ebd8",
    fontWeight: "700",
  },
  customWrap: {
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#050000",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3e5c76",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#f0ebd8",
    fontSize: 15,
    marginBottom: 8,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  backBtnText: {
    color: "#748cab",
    fontSize: 13,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#3e5c76",
    alignItems: "center",
  },
  skipText: {
    color: "#748cab",
    fontSize: 15,
    fontWeight: "600",
  },
  saveBtn: {
    flex: 1.4,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#920c0cff",
    alignItems: "center",
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveText: {
    color: "#f0ebd8",
    fontSize: 15,
    fontWeight: "700",
  },
});
