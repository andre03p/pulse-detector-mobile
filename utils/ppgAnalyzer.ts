import {
  calculateAdvancedSQI,
  calculateHRV,
  calculateIBI,
  calculatePerfusionIndex,
  calculateSNR,
  estimateHeartRateEnsemble,
  type HeartRateEstimate,
  type HRVMetrics,
} from "./heartRateDetection";

import {
  AdaptiveThermalCompensator,
  FlashIntensityMonitor,
  ThermalAwareMeasurementScheduler,
  type ThermalState,
} from "./thermalCompensation";

export interface PPGAnalysisResult {
  heartRate: HeartRateEstimate;
  signalQuality: number;
  perfusionIndex: number;
  snr: number;
  hrv?: HRVMetrics;
  respirationRate?: number;
}

export interface MeasurementConfig {
  targetDuration: number;
  minDuration: number;
  maxDuration: number;
  minQualityThreshold: number;
  minConfidence: number;
  samplingRate: number;
  enableThermalCompensation: boolean;
  enableEnsembleMethod: boolean;
}

export interface MeasurementStatus {
  phase: "idle" | "warmup" | "measuring" | "complete" | "error";
  progress: number;
  heartRate: number;
  confidence: number;
  signalQuality: number;
  thermalState: ThermalState | null;
  message: string;
  canStop: boolean;
  shouldStop: boolean;
  // HRV readiness
  ibiCount: number;
  hrvReady: boolean;
}

export interface FinalResult {
  success: boolean;
  heartRate: number;
  confidence: number;
  signalQuality: number;
  measurementDuration: number;
  thermalInfo: {
    peakTemperature: number;
    driftDetected: boolean;
    compensationApplied: boolean;
  };
  hrv?: HRVMetrics;
  warning?: string;
  recommendation?: string;
}

// Minimum successive IBI differences before RMSSD is considered valid.
// Below this threshold the 95% CI on RMSSD is too wide to be clinically meaningful.
const MIN_IBI_FOR_HRV = 20;

// Maximum IBIs retained in the session buffer (≈ 5 min @ 60 BPM)
const MAX_IBI_BUFFER = 500;

export class ThermalAwarePPGAnalyzer {
  private config: MeasurementConfig;
  private thermalCompensator: AdaptiveThermalCompensator;
  private scheduler: ThermalAwareMeasurementScheduler;
  private flashMonitor: FlashIntensityMonitor;

  private buffer: number[] = [];
  private startTime: number = 0;
  private status: MeasurementStatus;
  private peakTemperature: number = 0;
  private lastGoodResult: PPGAnalysisResult | null = null;

  // Session-wide IBI accumulator — fixed: was recomputed from scratch on each
  // analyzeCurrentBuffer() call with only the current buffer. Now IBIs are
  // accumulated across the full measurement so RMSSD stabilises over time.
  private ibiAccumulator: number[] = [];

  constructor(config: Partial<MeasurementConfig> = {}) {
    this.config = {
      targetDuration: 15,
      minDuration: 10,
      maxDuration: 20,
      minQualityThreshold: 50,
      minConfidence: 0.7,
      samplingRate: 30,
      enableThermalCompensation: true,
      enableEnsembleMethod: true,
      ...config,
    };

    this.thermalCompensator = new AdaptiveThermalCompensator();
    this.scheduler = new ThermalAwareMeasurementScheduler();
    this.flashMonitor = new FlashIntensityMonitor();

    this.status = this.idleStatus();
  }

  private idleStatus(): MeasurementStatus {
    return {
      phase: "idle",
      progress: 0,
      heartRate: 0,
      confidence: 0,
      signalQuality: 0,
      thermalState: null,
      message: "Ready to start",
      canStop: false,
      shouldStop: false,
      ibiCount: 0,
      hrvReady: false,
    };
  }

  canStart(): { ready: boolean; message: string; cooldownRemaining?: number } {
    const cooldownCheck = this.scheduler.canStartMeasurement();
    if (!cooldownCheck.canStart) {
      return {
        ready: false,
        message: cooldownCheck.recommendation,
        cooldownRemaining: cooldownCheck.cooldownRemaining,
      };
    }
    if (this.status.phase === "measuring") {
      return { ready: false, message: "Measurement already in progress" };
    }
    return { ready: true, message: "Ready to start measurement" };
  }

  start(): boolean {
    const check = this.canStart();
    if (!check.ready) return false;

    this.buffer = [];
    this.ibiAccumulator = [];
    this.startTime = Date.now();
    this.peakTemperature = 0;
    this.lastGoodResult = null;
    this.thermalCompensator.reset();
    this.flashMonitor.reset();

    this.status = {
      phase: "warmup",
      progress: 0,
      message: "Starting measurement...",
      heartRate: 0,
      confidence: 0,
      signalQuality: 0,
      thermalState: null,
      canStop: false,
      shouldStop: false,
      ibiCount: 0,
      hrvReady: false,
    };

    return true;
  }

  processFrame(greenChannelMean: number): MeasurementStatus {
    if (this.status.phase === "idle" || this.status.phase === "complete") {
      return this.status;
    }

    this.buffer.push(greenChannelMean);

    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const bufferSeconds = this.buffer.length / this.config.samplingRate;

    // Warmup phase
    if (bufferSeconds < 5) {
      this.status = {
        ...this.status,
        phase: "warmup",
        progress: (bufferSeconds / 5) * 20,
        message: `Collecting data... ${Math.ceil(5 - bufferSeconds)}s`,
      };
      return this.status;
    }

    // Measuring phase
    if (
      bufferSeconds >= this.config.minDuration ||
      this.buffer.length >= this.config.samplingRate * 8
    ) {
      const result = this.analyzeCurrentBuffer();

      if (result.thermalState) {
        this.peakTemperature = Math.max(
          this.peakTemperature,
          result.thermalState.estimatedTemperature,
        );
      }

      if (
        result.confidence >= this.config.minConfidence &&
        result.signalQuality >= this.config.minQualityThreshold
      ) {
        this.lastGoodResult = {
          heartRate: {
            bpm: result.heartRate,
            confidence: result.confidence,
            method: "ensemble_thermal",
          },
          signalQuality: result.signalQuality,
          perfusionIndex: result.perfusionIndex,
          snr: result.snr,
          hrv:
            this.ibiAccumulator.length >= MIN_IBI_FOR_HRV
              ? calculateHRV(this.ibiAccumulator)
              : undefined,
        };
      }

      const timeProgress = (elapsedSeconds / this.config.targetDuration) * 80;
      const progress = Math.min(100, 20 + timeProgress);

      const canStop =
        result.confidence >= this.config.minConfidence &&
        result.signalQuality >= this.config.minQualityThreshold &&
        bufferSeconds >= this.config.minDuration;

      const shouldStop =
        result.shouldPause ||
        elapsedSeconds >= this.config.maxDuration ||
        this.peakTemperature > 4.5;

      this.status = {
        phase: shouldStop ? "complete" : "measuring",
        progress,
        heartRate: result.heartRate,
        confidence: result.confidence,
        signalQuality: result.signalQuality,
        thermalState: result.thermalState,
        message: result.adaptiveRecommendation,
        canStop,
        shouldStop,
        ibiCount: this.ibiAccumulator.length,
        hrvReady: this.ibiAccumulator.length >= MIN_IBI_FOR_HRV,
      };
    } else {
      const remaining = this.config.minDuration - bufferSeconds;
      this.status = {
        ...this.status,
        phase: "measuring",
        progress: 20 + (bufferSeconds / this.config.minDuration) * 30,
        message: `Measuring... ${Math.ceil(remaining)}s minimum`,
        ibiCount: this.ibiAccumulator.length,
        hrvReady: this.ibiAccumulator.length >= MIN_IBI_FOR_HRV,
      };
    }

    return this.status;
  }

  private analyzeCurrentBuffer(): ThermalAwarePPGResult {
    let processedSignal = this.buffer;
    let thermalState: ThermalState | null = null;

    if (this.config.enableThermalCompensation) {
      const result = this.thermalCompensator.process(this.buffer);
      processedSignal = result.compensated;
      thermalState = result.thermalState;
    }

    const analysis = this.analyzePPGSignal(
      processedSignal,
      this.config.samplingRate,
    );

    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const shouldPause = this.shouldPauseMeasurement(
      elapsedSeconds,
      thermalState,
    );
    const recommendation = this.generateRecommendation(
      elapsedSeconds,
      thermalState,
      analysis.heartRate.confidence,
      analysis.signalQuality,
    );

    return {
      heartRate: analysis.heartRate.bpm,
      confidence: analysis.heartRate.confidence,
      signalQuality: analysis.signalQuality,
      perfusionIndex: analysis.perfusionIndex,
      snr: analysis.snr,
      thermalState,
      shouldPause,
      adaptiveRecommendation: recommendation,
    };
  }

  private analyzePPGSignal(signal: number[], fs: number): PPGAnalysisResult {
    const signalQuality = calculateAdvancedSQI(signal, fs);
    const perfusionIndex = calculatePerfusionIndex(signal);
    const snr = calculateSNR(signal);

    if (signalQuality < this.config.minQualityThreshold) {
      return {
        heartRate: { bpm: 0, confidence: 0, method: "low_quality" },
        signalQuality,
        perfusionIndex,
        snr,
      };
    }

    // Ensemble HR (FFT + autocorrelation + peaks) — unchanged, already good
    const heartRate = this.config.enableEnsembleMethod
      ? estimateHeartRateEnsemble(signal, fs)
      : { bpm: 0, confidence: 0, method: "ensemble_disabled" };

    // IBI accumulation — fixed: append new IBIs to the session buffer rather
    // than recomputing HRV from scratch on a fixed short window each call.
    // calculateIBI now uses parabolic interpolation + 350 ms min distance.
    if (signal.length >= fs * 5) {
      const newIbis = calculateIBI(signal.slice(-fs * 15), fs);
      if (newIbis.length > 0) {
        this.ibiAccumulator = [...this.ibiAccumulator, ...newIbis].slice(
          -MAX_IBI_BUFFER,
        );
      }
    }

    // Compute HRV only when the session buffer has enough differences
    let hrv: HRVMetrics | undefined;
    if (this.ibiAccumulator.length >= MIN_IBI_FOR_HRV) {
      hrv = calculateHRV(this.ibiAccumulator);
    }

    return { heartRate, signalQuality, perfusionIndex, snr, hrv };
  }

  private shouldPauseMeasurement(
    elapsedTime: number,
    thermal: ThermalState | null,
  ): boolean {
    if (elapsedTime > this.config.maxDuration) return true;
    if (thermal && thermal.estimatedTemperature > 4.5) return true;
    if (thermal && Math.abs(thermal.driftRate) > 3.0) return true;
    return false;
  }

  private generateRecommendation(
    elapsedTime: number,
    thermal: ThermalState | null,
    confidence: number,
    quality: number,
  ): string {
    if (thermal && thermal.estimatedTemperature > 4.5)
      return "🔥 Camera very hot - pause to cool down";
    if (thermal && Math.abs(thermal.driftRate) > 3.0)
      return "⚠️ Excessive thermal drift - pause to reset";
    if (elapsedTime < this.config.minDuration) {
      if (quality < 50) return "📍 Adjust finger position for better signal";
      return `⏱️ Measuring... ${Math.ceil(this.config.minDuration - elapsedTime)}s remaining`;
    }
    if (
      elapsedTime >= this.config.minDuration &&
      elapsedTime <= this.config.maxDuration * 0.75
    ) {
      if (confidence > 0.7 && quality > 60)
        return "✅ Good measurement - you can stop now";
      return "📊 Continue measuring for better accuracy";
    }
    if (thermal && thermal.estimatedTemperature > 3.0)
      return "🌡️ Camera warming - complete measurement soon";
    if (quality < 30) return "❌ Poor signal quality - check finger placement";
    return "📊 Measuring...";
  }

  complete(): FinalResult {
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;

    let finalResult: PPGAnalysisResult;

    if (this.lastGoodResult) {
      // Use best saved result, but attach the latest (and most complete) HRV
      finalResult = {
        ...this.lastGoodResult,
        hrv:
          this.ibiAccumulator.length >= MIN_IBI_FOR_HRV
            ? calculateHRV(this.ibiAccumulator)
            : undefined,
      };
    } else if (this.buffer.length >= this.config.samplingRate * 5) {
      const analysis = this.analyzeCurrentBuffer();
      finalResult = {
        heartRate: {
          bpm: analysis.heartRate,
          confidence: analysis.confidence,
          method: "thermal_aware",
        },
        signalQuality: analysis.signalQuality,
        perfusionIndex: analysis.perfusionIndex,
        snr: analysis.snr,
        hrv:
          this.ibiAccumulator.length >= MIN_IBI_FOR_HRV
            ? calculateHRV(this.ibiAccumulator)
            : undefined,
      };
    } else {
      this.status = {
        ...this.status,
        phase: "error",
        message: "Insufficient data collected",
      };
      return {
        success: false,
        heartRate: 0,
        confidence: 0,
        signalQuality: 0,
        measurementDuration: elapsedSeconds,
        thermalInfo: {
          peakTemperature: this.peakTemperature,
          driftDetected: false,
          compensationApplied: false,
        },
        warning: "Measurement failed - insufficient data",
      };
    }

    this.scheduler.recordMeasurementEnd();

    const success =
      finalResult.heartRate.confidence >= this.config.minConfidence * 0.8 &&
      finalResult.signalQuality >= this.config.minQualityThreshold * 0.8;

    let warning: string | undefined;
    let recommendation: string | undefined;

    if (!success) {
      warning = "Low confidence measurement";
      recommendation = "Consider retrying with better finger placement";
    } else if (this.peakTemperature > 3.5) {
      warning = "Camera heated during measurement";
      recommendation = "Wait 60s before next measurement for best accuracy";
    }

    if (finalResult.hrv === undefined) {
      const hrvWarning = `HRV not computed — only ${this.ibiAccumulator.length} beats collected (need ${MIN_IBI_FOR_HRV})`;
      warning = warning ? `${warning}. ${hrvWarning}` : hrvWarning;
    }

    this.status = {
      ...this.status,
      phase: "complete",
      progress: 100,
      message: success
        ? "Measurement complete"
        : "Measurement complete (low confidence)",
    };

    return {
      success,
      heartRate: finalResult.heartRate.bpm,
      confidence: finalResult.heartRate.confidence,
      signalQuality: finalResult.signalQuality,
      measurementDuration: elapsedSeconds,
      thermalInfo: {
        peakTemperature: this.peakTemperature,
        driftDetected: this.peakTemperature > 2.0,
        compensationApplied: this.config.enableThermalCompensation,
      },
      hrv: finalResult.hrv,
      warning,
      recommendation,
    };
  }

  stop(): FinalResult {
    return this.complete();
  }

  reset() {
    this.buffer = [];
    this.ibiAccumulator = [];
    this.startTime = 0;
    this.peakTemperature = 0;
    this.lastGoodResult = null;
    this.thermalCompensator.reset();
    this.flashMonitor.reset();
    this.status = this.idleStatus();
  }

  getStatus(): MeasurementStatus {
    return { ...this.status };
  }
}

export interface ThermalAwarePPGResult {
  heartRate: number;
  confidence: number;
  signalQuality: number;
  perfusionIndex: number;
  snr: number;
  thermalState: ThermalState | null;
  shouldPause: boolean;
  adaptiveRecommendation: string;
}
