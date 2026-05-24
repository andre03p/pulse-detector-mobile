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
  Platform,
  Share,
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

interface AdvancedMetrics {
  rmssd: number;
  hrvReady: boolean; // false while accumulating < MIN_IBI_COUNT IBIs
  ibiCount: number; // how many intervals have been accumulated
}

// One BPM sample per completed 1-minute window (Empatica-compatible).
interface PerMinuteSample {
  unix: number; // seconds since epoch at start of the minute window
  iso: string; // ISO-8601 timestamp at start of the minute window
  bpm: number; // mean of valid BPM estimates collected during that minute
}

type CaptureMode = "single" | "compare";

// Length of the rolling per-minute window used in compare mode.
const COMPARE_WINDOW_MS = 60_000;

// ─── Constants ────────────────────────────────────────────────────────────────
const SAMPLING_RATE = 30;

// BPM estimation window: 6 s of signal — kept short so HR updates quickly
const WINDOW_SIZE = 180;

// Minimum red channel mean indicating a finger is present
const FINGER_DETECTED_THRESHOLD = 80;
const FINGER_LOST_THRESHOLD = 40;

const MIN_VALID_BPM = 30;
const MAX_VALID_BPM = 200;

// Advanced SQI threshold (0–100 scale). 25 compensates for removing the kurtosis
// metric (which acted as a hidden floor in the old 5-metric formula).
const MIN_QUALITY_SCORE = 25;

// How many BPM estimates before we finalise
const MIN_VALID_READINGS = 12;

// Minimum successive IBI differences needed before displaying RMSSD.
// Below this the confidence interval on RMSSD is too wide to be useful.
const MIN_IBI_COUNT_FOR_HRV = 20;

// Safety stop: if we can't reach MIN_IBI_COUNT_FOR_HRV (poor signal / low HR),
// don't keep the user stuck measuring forever.
const MAX_MEASUREMENT_DURATION_MS = 45_000;

// Maximum accumulated IBIs kept in memory (≈300 s @ 60 BPM)
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

  // ─── Compare-mode state ─────────────────────────────────────────────────────
  // Compare mode: continuous capture until the user presses Stop & Export.
  // For each completed 60 s window we store one BPM sample (mean of valid
  // ensemble estimates in that minute), then export them as CSV with the same
  // 1-value-per-minute granularity as the Empatica EmbracePlus pulse-rate
  // digital biomarker. The CSV is directly comparable: same time grid, same
  // unit (BPM), same minute-level smoothing.
  const [mode, setMode] = useState<CaptureMode>("single");
  const [perMinuteSamples, setPerMinuteSamples] = useState<PerMinuteSample[]>(
    [],
  );
  const [partialMinuteCount, setPartialMinuteCount] = useState(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const format = useCameraFormat(device, [{ fps: SAMPLING_RATE }]);
  const { resize } = useResizePlugin();

  const filterRef = useRef(new ButterworthFilter(SAMPLING_RATE));
  const dataBufferRef = useRef<number[]>([]);

  // Session-wide IBI accumulator — survives across WINDOW_SIZE epochs.
  // This is what gives valid RMSSD: we need 20+ differences, meaning
  // 20+ successive beats, which takes ≥ 20 s at 60 BPM.
  const allIBIsRef = useRef<number[]>([]);

  const measurementStartMsRef = useRef<number | null>(null);

  // ─── Compare-mode refs ──────────────────────────────────────────────────────
  // Current minute window: epoch-aligned to floor(start / 60s) so each sample's
  // timestamp lands on a clean minute boundary just like the Empatica export.
  const modeRef = useRef<CaptureMode>("single");
  const minuteStartMsRef = useRef<number | null>(null);
  const currentMinuteBpmsRef = useRef<number[]>([]);
  const perMinuteSamplesRef = useRef<PerMinuteSample[]>([]);

  const detectionPhaseRef = useRef<"waiting" | "measuring">("waiting");
  const validReadingsRef = useRef<number[]>([]);
  const lastProcessTimeRef = useRef<number>(0);
  const lastWaveUpdateRef = useRef<number>(0);

  // Rolling statistics for adaptive motion rejection (Welford online algorithm)
  const rollingMeanRef = useRef<number>(0);
  const rollingM2Ref = useRef<number>(0);
  const rollingCountRef = useRef<number>(0);

  // ─── Animations ─────────────────────────────────────────────────────────────

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

    // ── Adaptive motion rejection (Welford online std dev) ──────────────────
    // Updates rolling mean and variance in O(1). Rejects the new sample if it
    // deviates more than 4 standard deviations from the running mean.
    // This replaces the previous "change > 10" magic-number check which
    // (a) used a scale-dependent constant and (b) mutated already-accepted data.
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
        // Skip artifact — do not modify the existing buffer or reset filter state
        return;
      }
    }

    dataBufferRef.current.push(filteredValue);
    if (dataBufferRef.current.length > WINDOW_SIZE)
      dataBufferRef.current.shift();

    // ── Waveform display (throttled to ~8 Hz) ───────────────────────────────
    if (now - lastWaveUpdateRef.current > 120) {
      lastWaveUpdateRef.current = now;
      setWaveform(dataBufferRef.current.slice(-120));
      const elapsed =
        measurementStartMsRef.current !== null
          ? now - measurementStartMsRef.current
          : 0;
    }

    const currentProgress = Math.min(
      dataBufferRef.current.length / WINDOW_SIZE,
      1,
    );
    setProgress(currentProgress);

    // ── Analysis every 500 ms once the window is full ───────────────────────
    if (
      dataBufferRef.current.length === WINDOW_SIZE &&
      now - lastProcessTimeRef.current > 500
    ) {
      lastProcessTimeRef.current = now;

      // Use advanced SQI (0–100) — replaces the old binary assessSignalQuality()
      const quality = calculateAdvancedSQI(
        dataBufferRef.current,
        SAMPLING_RATE,
      );

      if (quality >= MIN_QUALITY_SCORE) {
        // Ensemble HR: FFT + autocorrelation + peaks with MAD-based confidence
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

          // ── IBI + HRV: session-wide accumulation ──────────────────────────
          // calculateIBI now uses:
          //   • detectPeaksAdaptive (IQR threshold + 350 ms min distance)
          //   • refinePeak (parabolic sub-sample timing)
          // This produces IBIs accurate to ±2 ms instead of ±33 ms.
          const newIbis = calculateIBI(dataBufferRef.current, SAMPLING_RATE);

          if (newIbis.length > 0) {
            // Append to session buffer, capped to avoid unbounded growth
            allIBIsRef.current = [...allIBIsRef.current, ...newIbis].slice(
              -MAX_IBI_BUFFER,
            );

            const ibiCount = allIBIsRef.current.length;

            if (ibiCount >= MIN_IBI_COUNT_FOR_HRV) {
              // RMSSD is meaningful only once we have enough successive differences
              const hrv = calculateHRV(allIBIsRef.current);
              setAdvancedMetrics({
                rmssd: hrv.rmssd,
                hrvReady: true,
                ibiCount,
              });
            } else {
              // Show accumulation progress so the user knows HRV is computing
              setAdvancedMetrics({ rmssd: 0, hrvReady: false, ibiCount });
            }
          }

          // ── Compare mode: bucket BPMs into 1-minute windows ───────────────
          if (modeRef.current === "compare") {
            if (minuteStartMsRef.current === null) {
              minuteStartMsRef.current = now;
            }
            currentMinuteBpmsRef.current.push(estimate.bpm);

            // Close the window when ≥ 60s have elapsed since the window opened
            const windowElapsed = now - minuteStartMsRef.current;
            if (windowElapsed >= COMPARE_WINDOW_MS) {
              const bpms = currentMinuteBpmsRef.current;
              if (bpms.length > 0) {
                const meanBpm =
                  bpms.reduce((a, b) => a + b, 0) / bpms.length;
                // Align stamp to the START of the minute window
                const startMs = minuteStartMsRef.current;
                const sample: PerMinuteSample = {
                  unix: Math.floor(startMs / 1000),
                  iso: new Date(startMs).toISOString(),
                  bpm: Math.round(meanBpm * 10) / 10, // 0.1 BPM precision
                };
                perMinuteSamplesRef.current = [
                  ...perMinuteSamplesRef.current,
                  sample,
                ];
                setPerMinuteSamples(perMinuteSamplesRef.current);
              }
              currentMinuteBpmsRef.current = [];
              minuteStartMsRef.current = now;
              setPartialMinuteCount(0);
            } else {
              setPartialMinuteCount(currentMinuteBpmsRef.current.length);
            }
            // Compare mode never auto-finalizes — user controls stop.
            return;
          }

          const hasEnoughBpm =
            validReadingsRef.current.length >= MIN_VALID_READINGS;
          const hasEnoughIbi =
            allIBIsRef.current.length >= MIN_IBI_COUNT_FOR_HRV;
          const elapsedMs =
            measurementStartMsRef.current !== null
              ? now - measurementStartMsRef.current
              : 0;
          const timedOut = elapsedMs >= MAX_MEASUREMENT_DURATION_MS;

          // We only finalise once we have stable BPM estimates and (ideally)
          // enough IBIs to compute a meaningful RMSSD.
          if (hasEnoughBpm && (hasEnoughIbi || timedOut)) {
            finalizeMeasurement(Math.round(smoothed));
          }
        }
      }
    }
  }, []);


  // ─── Worklet bridge ─────────────────────────────────────────────────────────
  // Memoized so it is not recreated on every render (waveform / BPM state updates
  // happen at 8 Hz — without useMemo each update would rebuild the worklet closure
  // and potentially cause dropped frames or stale references on the Vision Camera
  // worklet thread).
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

    // Compare-mode reset — keep the ref in sync with state so the worklet
    // callback (which closes over modeRef, not the `mode` state) sees the
    // correct value from frame 1.
    modeRef.current = mode;
    minuteStartMsRef.current = null;
    currentMinuteBpmsRef.current = [];
    perMinuteSamplesRef.current = [];
    setPerMinuteSamples([]);
    setPartialMinuteCount(0);

    setIsMonitoring(true);
  }, [hasPermission, requestPermission, mode]);

  const stopMonitoring = useCallback(() => {
    setIsMonitoring(false);
    setFingerDetected(false);
    detectionPhaseRef.current = "waiting";
    measurementStartMsRef.current = null;
    setProgress(0);
  }, []);

  // ─── Compare-mode export ────────────────────────────────────────────────────
  // Writes a CSV with one row per completed 1-minute window in the same
  // shape as the Empatica EmbracePlus pulse-rate digital biomarker, plus an
  // ISO timestamp column for human readability:
  //
  //   timestamp_unix,timestamp_iso,pulse_rate_bpm
  //   1700000000,2023-11-14T22:13:20.000Z,72.3
  //
  // Per-minute BPM = arithmetic mean of all valid ensemble estimates produced
  // during that minute (≈ up to 120 estimates at one every 500 ms).
  const shareFile = async (uri: string) => {
    try {
      const SharingModule = await import("expo-sharing");
      const Sharing = (SharingModule as any)?.default ?? SharingModule;
      if (
        Sharing?.isAvailableAsync &&
        typeof Sharing.isAvailableAsync === "function"
      ) {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare && Sharing.shareAsync) {
          await Sharing.shareAsync(uri);
          return;
        }
      }
    } catch {
      console.log("expo-sharing not available");
    }
    try {
      if (Platform.OS === "ios") {
        await Share.share({ url: uri });
      } else {
        await Share.share({ message: `File saved at: ${uri}`, url: uri });
      }
    } catch (error) {
      console.error("Share error:", error);
      Alert.alert("Export saved", `File saved to: ${uri}`);
    }
  };

  const exportCompareCsv = async (samples: PerMinuteSample[]) => {
    if (samples.length === 0) {
      Alert.alert(
        "Nothing to export",
        "No completed 1-minute windows were recorded. Keep your finger on the camera for at least 60 s.",
      );
      return;
    }
    try {
      const FileSystemModule = await import("expo-file-system");
      const FileSystem = (FileSystemModule as any)?.default ?? FileSystemModule;
      const File = (FileSystem as any)?.File ?? (FileSystemModule as any)?.File;
      const Paths =
        (FileSystem as any)?.Paths ?? (FileSystemModule as any)?.Paths;
      if (!File || !Paths?.document) {
        throw new Error("expo-file-system File/Paths API not available");
      }

      const header = "timestamp_unix,timestamp_iso,pulse_rate_bpm";
      const rows = samples.map(
        (s) => `${s.unix},${s.iso},${s.bpm.toFixed(1)}`,
      );
      const fileName = `pulse_compare_${Date.now()}.csv`;
      const file = new File(Paths.document, fileName);
      file.write([header, ...rows].join("\n"), { encoding: "utf8" });
      await shareFile(file.uri);
      Alert.alert(
        "Exported",
        `${samples.length} per-minute sample${samples.length !== 1 ? "s" : ""} exported`,
      );
    } catch (error) {
      console.error("Export compare CSV error:", error);
      const message =
        error instanceof Error ? error.message : "Could not export CSV";
      Alert.alert("Export failed", message);
    }
  };

  const stopAndExportCompare = useCallback(async () => {
    // Flush a partial window only if it has a reasonable amount of data
    // (≥ 30 s worth of estimates ≈ 60 samples). Otherwise the value would be
    // a noisy outlier inconsistent with the rest of the per-minute series.
    if (
      modeRef.current === "compare" &&
      minuteStartMsRef.current !== null &&
      currentMinuteBpmsRef.current.length >= 60
    ) {
      const bpms = currentMinuteBpmsRef.current;
      const meanBpm = bpms.reduce((a, b) => a + b, 0) / bpms.length;
      const startMs = minuteStartMsRef.current;
      perMinuteSamplesRef.current = [
        ...perMinuteSamplesRef.current,
        {
          unix: Math.floor(startMs / 1000),
          iso: new Date(startMs).toISOString(),
          bpm: Math.round(meanBpm * 10) / 10,
        },
      ];
    }

    const samplesSnapshot = perMinuteSamplesRef.current;
    stopMonitoring();
    await exportCompareCsv(samplesSnapshot);
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
        "Recorded",
        `${finalBPM} BPM${rmssdToSave !== null ? `\nRMSSD: ${Math.round(rmssdToSave)} ms` : ""} (Save Failed: ${error.message})`,
      );
    } else {
      Alert.alert(
        "Success",
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

                {/* HRV metric — shows "computing" state while accumulating IBIs */}
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
                        <Text style={styles.metricUnit}>beats</Text>
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

                {mode === "compare" && (
                  <View style={styles.compareStatusBox}>
                    <Text style={styles.compareStatusTitle}>
                      PER-MINUTE SAMPLES
                    </Text>
                    <Text style={styles.compareStatusValue}>
                      {perMinuteSamples.length} complete
                    </Text>
                    <Text style={styles.compareStatusSub}>
                      {partialMinuteCount} estimates buffered for next minute
                    </Text>
                    {perMinuteSamples.length > 0 && (
                      <Text style={styles.compareStatusSub}>
                        last: {perMinuteSamples[perMinuteSamples.length - 1].bpm.toFixed(1)} BPM
                      </Text>
                    )}
                  </View>
                )}

              </View>
            )}

            {mode === "compare" ? (
              <TouchableOpacity
                onPress={stopAndExportCompare}
                style={styles.stopExportBtn}
                activeOpacity={0.8}
                disabled={isSaving}
              >
                <Entypo name="export" size={18} color="#fff" />
                <Text style={styles.stopExportText}>
                  {isSaving ? "Exporting..." : "Stop & Export CSV"}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={stopMonitoring}
                style={styles.cancelBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            )}
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
                {mode === "single"
                  ? "Measure your pulse in 15 seconds"
                  : "Continuous capture — 1 BPM per minute, exported as CSV"}
              </Text>
            </View>

            {/* Mode toggle: Single shot vs Empatica-compare continuous capture */}
            <View style={styles.modeToggle}>
              <TouchableOpacity
                onPress={() => setMode("single")}
                style={[
                  styles.modeBtn,
                  mode === "single" && styles.modeBtnActive,
                ]}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.modeBtnText,
                    mode === "single" && styles.modeBtnTextActive,
                  ]}
                >
                  Single
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMode("compare")}
                style={[
                  styles.modeBtn,
                  mode === "compare" && styles.modeBtnActive,
                ]}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.modeBtnText,
                    mode === "compare" && styles.modeBtnTextActive,
                  ]}
                >
                  Compare (CSV)
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
                <Text style={styles.startText}>
                  {mode === "single" ? "Start Measurement" : "Start Capture"}
                </Text>
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

  // Compare/single mode toggle
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

  // Compare-mode HUD
  compareStatusBox: {
    backgroundColor: "rgba(233,69,96,0.08)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(233,69,96,0.25)",
    alignItems: "center",
    width: "100%",
  },
  compareStatusTitle: {
    color: "#920c0cff",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  compareStatusValue: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  compareStatusSub: {
    color: "#a0a0a0",
    fontSize: 11,
    marginTop: 2,
  },
  stopExportBtn: {
    marginTop: 14,
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 26,
    backgroundColor: "#920c0cff",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stopExportText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
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
  welcomeSubtitle: { color: "#a0a0a0", fontSize: 16, textAlign: "center" },
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
