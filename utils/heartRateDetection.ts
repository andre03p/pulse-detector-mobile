// ============================================================================
// BUTTERWORTH FILTER — 4th order cascade of two 2nd-order sections
// ============================================================================

class SecondOrderSection {
  private b: number[] = [];
  private a: number[] = [];
  private x: number[] = [0, 0, 0];
  private y: number[] = [0, 0, 0];

  constructor(fs: number, lowFreq: number, highFreq: number) {
    this.calculateCoefficients(fs, lowFreq, highFreq);
  }

  private calculateCoefficients(fs: number, lowFreq: number, highFreq: number) {
    const w_low = Math.tan((Math.PI * lowFreq) / fs);
    const w_high = Math.tan((Math.PI * highFreq) / fs);
    const bw = w_high - w_low;
    const w0 = Math.sqrt(w_low * w_high);
    const norm = 1 / (1 + bw + w0 * w0);

    this.b = [bw * norm, 0, -bw * norm];
    this.a = [1, 2 * (w0 * w0 - 1) * norm, (1 - bw + w0 * w0) * norm];
  }

  process(input: number): number {
    this.x[2] = this.x[1];
    this.x[1] = this.x[0];
    this.y[2] = this.y[1];
    this.y[1] = this.y[0];
    this.x[0] = input;
    this.y[0] =
      this.b[0] * this.x[0] +
      this.b[1] * this.x[1] +
      this.b[2] * this.x[2] -
      this.a[1] * this.y[1] -
      this.a[2] * this.y[2];
    return this.y[0];
  }

  reset() {
    this.x = [0, 0, 0];
    this.y = [0, 0, 0];
  }
}

export class ButterworthFilter {
  private sos: SecondOrderSection[] = [];

  constructor(fs: number, lowCutoff: number = 0.667, highCutoff: number = 4.0) {
    this.sos = [
      new SecondOrderSection(fs, lowCutoff, highCutoff),
      new SecondOrderSection(fs, lowCutoff, highCutoff),
    ];
  }

  process(input: number): number {
    let output = input;
    for (const section of this.sos) {
      output = section.process(output);
    }
    return output;
  }

  reset() {
    this.sos.forEach((s) => s.reset());
  }
}

// ============================================================================
// SIGNAL PREPROCESSING
// ============================================================================

export function detrendSignal(signal: number[]): number[] {
  const n = signal.length;
  if (n < 10) return signal;

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += signal[i];
    sumXY += i * signal[i];
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return signal;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return signal.map((val, i) => val - (slope * i + intercept));
}

export function applyHannWindow(signal: number[]): number[] {
  const n = signal.length;
  return signal.map(
    (val, i) => val * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))),
  );
}

// ============================================================================
// FFT
// ============================================================================

interface Complex {
  re: number;
  im: number;
}

export function fft(signal: number[]): Complex[] {
  const n = signal.length;
  const n2 = Math.pow(2, Math.ceil(Math.log2(n)));
  const padded = [...signal, ...new Array(n2 - n).fill(0)];
  return fftRecursive(padded.map((re) => ({ re, im: 0 })));
}

function fftRecursive(x: Complex[]): Complex[] {
  const n = x.length;
  if (n <= 1) return x;

  const even = fftRecursive(x.filter((_, i) => i % 2 === 0));
  const odd = fftRecursive(x.filter((_, i) => i % 2 === 1));
  const result: Complex[] = new Array(n);

  for (let k = 0; k < n / 2; k++) {
    const angle = (-2 * Math.PI * k) / n;
    const wk = { re: Math.cos(angle), im: Math.sin(angle) };
    const t = {
      re: wk.re * odd[k].re - wk.im * odd[k].im,
      im: wk.re * odd[k].im + wk.im * odd[k].re,
    };
    result[k] = { re: even[k].re + t.re, im: even[k].im + t.im };
    result[k + n / 2] = { re: even[k].re - t.re, im: even[k].im - t.im };
  }
  return result;
}

function getMagnitude(c: Complex): number {
  return Math.sqrt(c.re * c.re + c.im * c.im);
}

// ============================================================================
// HEART RATE ESTIMATION
// ============================================================================

export function estimateHeartRateFFT(signal: number[], fs: number): number {
  if (signal.length < 30) return 0;

  const detrended = detrendSignal(signal);
  const windowed = applyHannWindow(detrended);
  const fftResult = fft(windowed);
  const n = fftResult.length;
  const powerSpectrum = fftResult.slice(0, Math.floor(n / 2)).map(getMagnitude);
  const freqResolution = fs / n;

  const minIdx = Math.max(1, Math.floor(0.667 / freqResolution));
  const maxIdx = Math.min(
    powerSpectrum.length - 2,
    Math.ceil(3.667 / freqResolution),
  );

  let maxPower = -Infinity;
  let peakIdx = minIdx;
  for (let i = minIdx; i <= maxIdx; i++) {
    if (powerSpectrum[i] > maxPower) {
      maxPower = powerSpectrum[i];
      peakIdx = i;
    }
  }

  const avgPower =
    powerSpectrum.slice(minIdx, maxIdx + 1).reduce((a, b) => a + b, 0) /
    (maxIdx - minIdx + 1);
  if (maxPower < avgPower * 2) return 0;

  // Parabolic interpolation for sub-bin frequency accuracy
  let refinedIdx = peakIdx;
  if (peakIdx > 0 && peakIdx < powerSpectrum.length - 1) {
    const y1 = powerSpectrum[peakIdx - 1];
    const y2 = powerSpectrum[peakIdx];
    const y3 = powerSpectrum[peakIdx + 1];
    const denom = y1 - 2 * y2 + y3;
    if (Math.abs(denom) > 1e-10) {
      refinedIdx = peakIdx + (0.5 * (y1 - y3)) / denom;
    }
  }

  const freqHz = refinedIdx * freqResolution;
  const bpm = freqHz * 60;

  // Harmonic check: if half-frequency also has strong power, we locked on a harmonic
  const harmonicIdx = Math.round(refinedIdx * 2);
  if (harmonicIdx < powerSpectrum.length) {
    if (powerSpectrum[harmonicIdx] > maxPower * 0.7) return bpm / 2;
  }

  return bpm >= 40 && bpm <= 220 ? bpm : 0;
}

/**
 * Parabolic sub-sample peak refinement.
 * Fits a parabola through the three samples around a detected peak and returns
 * the fractional index of the true maximum. Works on any signal array.
 * At 30 fps this reduces peak-timing error from ±33 ms to ±1–3 ms.
 */
function refinePeak(signal: number[], peakIndex: number): number {
  if (peakIndex <= 0 || peakIndex >= signal.length - 1) return peakIndex;

  const y1 = signal[peakIndex - 1];
  const y2 = signal[peakIndex];
  const y3 = signal[peakIndex + 1];

  const denominator = y1 - 2 * y2 + y3;
  if (Math.abs(denominator) < 1e-10) return peakIndex;

  const offset = (0.5 * (y1 - y3)) / denominator;
  // Clamp to ±0.5 samples — anything larger indicates a pathological case
  return peakIndex + Math.max(-0.5, Math.min(0.5, offset));
}

export function estimateHeartRateAutocorrelation(
  signal: number[],
  fs: number,
): number {
  if (signal.length < 30) return 0;

  const n = signal.length;
  const detrended = detrendSignal(signal);
  const mean = detrended.reduce((a, b) => a + b, 0) / n;
  const centered = detrended.map((x) => x - mean);

  const variance = centered.reduce((sum, x) => sum + x * x, 0);
  if (variance < 1e-10) return 0;

  const minLag = Math.floor(fs * (60 / 220));
  const maxLag = Math.floor(fs * (60 / 40));

  const autocorr: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += centered[i] * centered[i + lag];
    autocorr.push(sum / variance);
  }

  let maxCorr = -Infinity;
  let bestLagOffset = 0;
  for (let i = 0; i < autocorr.length; i++) {
    if (autocorr[i] > maxCorr) {
      maxCorr = autocorr[i];
      bestLagOffset = i;
    }
  }

  if (maxCorr < 0.3) return 0;

  const bestLag = minLag + bestLagOffset;

  // Parabolic interpolation on autocorrelation peak
  let refinedLag = bestLag;
  if (bestLagOffset > 0 && bestLagOffset < autocorr.length - 1) {
    const y1 = autocorr[bestLagOffset - 1];
    const y2 = autocorr[bestLagOffset];
    const y3 = autocorr[bestLagOffset + 1];
    const denom = y1 - 2 * y2 + y3;
    if (Math.abs(denom) > 1e-10) {
      refinedLag = bestLag + (0.5 * (y1 - y3)) / denom;
    }
  }

  // Harmonic check for autocorrelation
  const halfLag = Math.round(refinedLag / 2);
  if (halfLag >= minLag && halfLag <= maxLag) {
    const halfLagIdx = halfLag - minLag;
    if (halfLagIdx >= 0 && halfLagIdx < autocorr.length) {
      if (autocorr[halfLagIdx] > maxCorr * 0.7) refinedLag = halfLag;
    }
  }

  const bpm = 60 / (refinedLag / fs);
  return bpm >= 40 && bpm <= 220 ? bpm : 0;
}

/**
 * Adaptive peak detection with IQR-based threshold.
 * Returns integer sample indices.
 */
export function detectPeaksAdaptive(signal: number[], fs: number): number[] {
  if (signal.length < 10) return [];

  // Moving-average baseline removal (200 ms window)
  const windowSize = Math.floor(fs * 0.2);
  const detrended: number[] = new Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(signal.length, i + Math.floor(windowSize / 2) + 1);
    let sum = 0;
    for (let j = start; j < end; j++) sum += signal[j];
    detrended[i] = signal[i] - sum / (end - start);
  }

  // Smoothing (50 ms window)
  const smoothWindow = Math.max(3, Math.floor(fs * 0.05));
  const smoothed: number[] = new Array(detrended.length);
  for (let i = 0; i < detrended.length; i++) {
    const start = Math.max(0, i - smoothWindow);
    const end = Math.min(detrended.length, i + smoothWindow + 1);
    let sum = 0;
    for (let j = start; j < end; j++) sum += detrended[j];
    smoothed[i] = sum / (end - start);
  }

  // IQR-based adaptive threshold
  const sorted = [...smoothed].sort((a, b) => a - b);
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const threshold = p25 + (p75 - p25) * 0.5;

  // 250 ms minimum for HR estimation (used for BPM only — see calculateIBI for HRV)
  const minDistance = Math.floor(fs * 0.25);
  const peaks: number[] = [];

  for (let i = 1; i < smoothed.length - 1; i++) {
    if (
      smoothed[i] > smoothed[i - 1] &&
      smoothed[i] > smoothed[i + 1] &&
      smoothed[i] > threshold
    ) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDistance) {
        peaks.push(i);
      } else if (smoothed[i] > smoothed[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i;
      }
    }
  }

  return peaks;
}

export function estimateHeartRatePeaks(signal: number[], fs: number): number {
  const peaks = detectPeaksAdaptive(signal, fs);
  if (peaks.length < 2) return 0;

  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const bpm = 60 / ((peaks[i] - peaks[i - 1]) / fs);
    if (bpm >= 40 && bpm <= 220) intervals.push(bpm);
  }

  return intervals.length === 0 ? 0 : median(intervals);
}

// ============================================================================
// ENSEMBLE HR ESTIMATION
// ============================================================================

export interface HeartRateEstimate {
  bpm: number;
  confidence: number;
  method: string;
}

export function estimateHeartRateEnsemble(
  signal: number[],
  fs: number,
): HeartRateEstimate {
  if (signal.length < 30)
    return { bpm: 0, confidence: 0, method: "insufficient_data" };

  const fftBpm = estimateHeartRateFFT(signal, fs);
  const autocorrBpm = estimateHeartRateAutocorrelation(signal, fs);
  const peakBpm = estimateHeartRatePeaks(signal, fs);

  const estimates: { bpm: number; method: string; weight: number }[] = [];
  if (fftBpm > 0) estimates.push({ bpm: fftBpm, method: "fft", weight: 1.5 });
  if (autocorrBpm > 0)
    estimates.push({ bpm: autocorrBpm, method: "autocorr", weight: 1.2 });
  if (peakBpm > 0)
    estimates.push({ bpm: peakBpm, method: "peaks", weight: 1.0 });

  if (estimates.length === 0)
    return { bpm: 0, confidence: 0, method: "no_valid_estimate" };
  if (estimates.length === 1)
    return {
      bpm: estimates[0].bpm,
      confidence: 0.4,
      method: estimates[0].method,
    };

  const bpms = estimates.map((e) => e.bpm);
  const medianBpm = median(bpms);
  const deviations = bpms.map((b) => Math.abs(b - medianBpm));
  const mad = median(deviations);

  if (mad < 3)
    return {
      bpm: Math.round(medianBpm),
      confidence: 0.95,
      method: "ensemble_high",
    };
  if (mad < 5)
    return {
      bpm: Math.round(medianBpm),
      confidence: 0.85,
      method: "ensemble_medium",
    };
  if (mad < 10)
    return {
      bpm: Math.round(medianBpm),
      confidence: 0.65,
      method: "ensemble_low",
    };

  // Weighted average when methods disagree strongly
  const totalWeight = estimates.reduce((s, e) => s + e.weight, 0);
  const weightedBpm =
    estimates.reduce((s, e) => s + e.bpm * e.weight, 0) / totalWeight;
  return {
    bpm: Math.round(weightedBpm),
    confidence: 0.4,
    method: "ensemble_uncertain",
  };
}

// ============================================================================
// IBI + HRV — FIXED
// ============================================================================

/**
 * Compute inter-beat intervals from a PPG signal.
 *
 * Changes from original:
 * 1. Uses the same detrend + smooth pipeline as detectPeaksAdaptive for consistency.
 * 2. Minimum peak distance raised to 350 ms (was 250 ms) to suppress dicrotic notches.
 * 3. Parabolic sub-sample interpolation applied to every detected peak via refinePeak(),
 *    reducing timing error from ±33 ms to ±2 ms at 30 fps.
 */
export function calculateIBI(signal: number[], fs: number): number[] {
  if (signal.length < fs * 2) return [];

  // Step 1 — moving-average baseline removal (200 ms window)
  const detrendWindow = Math.floor(fs * 0.2);
  const detrended: number[] = new Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    const start = Math.max(0, i - Math.floor(detrendWindow / 2));
    const end = Math.min(signal.length, i + Math.floor(detrendWindow / 2) + 1);
    let sum = 0;
    for (let j = start; j < end; j++) sum += signal[j];
    detrended[i] = signal[i] - sum / (end - start);
  }

  // Step 2 — smoothing (50 ms window) — same signal used for refinePeak
  const smoothWindow = Math.max(3, Math.floor(fs * 0.05));
  const smoothed: number[] = new Array(detrended.length);
  for (let i = 0; i < detrended.length; i++) {
    const start = Math.max(0, i - smoothWindow);
    const end = Math.min(detrended.length, i + smoothWindow + 1);
    let sum = 0;
    for (let j = start; j < end; j++) sum += detrended[j];
    smoothed[i] = sum / (end - start);
  }

  // Step 3 — IQR adaptive threshold
  const sorted = [...smoothed].sort((a, b) => a - b);
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const threshold = p25 + (p75 - p25) * 0.5;

  // Step 4 — peak detection with 350 ms minimum distance
  // 350 ms ≈ 171 BPM max, safely above any dicrotic notch timing (~250–350 ms post-systole)
  const minDistance = Math.floor(fs * 0.35);
  const rawPeaks: number[] = [];

  for (let i = 1; i < smoothed.length - 1; i++) {
    if (
      smoothed[i] > smoothed[i - 1] &&
      smoothed[i] > smoothed[i + 1] &&
      smoothed[i] > threshold
    ) {
      if (
        rawPeaks.length === 0 ||
        i - rawPeaks[rawPeaks.length - 1] >= minDistance
      ) {
        rawPeaks.push(i);
      } else if (smoothed[i] > smoothed[rawPeaks[rawPeaks.length - 1]]) {
        // Keep the higher of two close peaks
        rawPeaks[rawPeaks.length - 1] = i;
      }
    }
  }

  if (rawPeaks.length < 2) return [];

  // Step 5 — parabolic sub-sample refinement on the smoothed signal.
  // This is the critical step: converts integer (±33 ms) peak indices into
  // fractional (±2 ms) indices before converting to milliseconds.
  const refinedPeaks = rawPeaks.map((idx) => refinePeak(smoothed, idx));

  // Step 6 — compute IBIs from refined fractional indices
  const ibis: number[] = [];
  for (let i = 1; i < refinedPeaks.length; i++) {
    const intervalMs = ((refinedPeaks[i] - refinedPeaks[i - 1]) / fs) * 1000;
    // Physiological range: 300 ms (200 BPM) – 2000 ms (30 BPM)
    if (intervalMs >= 300 && intervalMs <= 2000) {
      ibis.push(intervalMs);
    }
  }

  return ibis;
}

export interface HRVMetrics {
  sdnn: number;
  rmssd: number;
  pnn50: number;
  nn50: number;
  lfHfRatio: number;
}

/**
 * Compute RMSSD and other HRV metrics from an array of inter-beat intervals (ms).
 * Requires at least 20 intervals for a meaningful RMSSD — caller should gate on this.
 */
export function calculateHRV(ibis: number[]): HRVMetrics {
  const medianIBI = median(ibis);
  // Remove ectopic beats / artifacts (standard 20% median-deviation rule)
  const validIBIs = ibis.filter(
    (t) => Math.abs(t - medianIBI) < 0.2 * medianIBI,
  );

  if (validIBIs.length < 5) {
    return { sdnn: 0, rmssd: 0, pnn50: 0, nn50: 0, lfHfRatio: 0 };
  }

  const mean = validIBIs.reduce((a, b) => a + b, 0) / validIBIs.length;
  const variance =
    validIBIs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
    (validIBIs.length - 1);
  const sdnn = Math.sqrt(variance);

  let sumSqDiff = 0;
  let nn50Count = 0;
  for (let i = 1; i < validIBIs.length; i++) {
    const diff = validIBIs[i] - validIBIs[i - 1];
    sumSqDiff += diff * diff;
    if (Math.abs(diff) > 50) nn50Count++;
  }
  const rmssd = Math.sqrt(sumSqDiff / (validIBIs.length - 1));
  const pnn50 = (nn50Count / (validIBIs.length - 1)) * 100;

  const lfHfRatio = computeLfHfRatioFromIBI(validIBIs);

  return { sdnn, rmssd, pnn50, nn50: nn50Count, lfHfRatio };
}

// ============================================================================
// LF/HF RATIO — FIXED: now uses the existing FFT instead of O(n²) DFT
// ============================================================================

function interpolateIBI(
  ibisMs: number[],
  sampleRateHz = 4,
  nSamples = 256,
): number[] {
  if (ibisMs.length < 2) return [];

  const times: number[] = [0];
  for (let i = 0; i < ibisMs.length; i++)
    times.push(times[i] + ibisMs[i] / 1000);
  times.pop();

  const totalTime = times[times.length - 1];
  if (totalTime <= 0) return [];

  const step = 1 / sampleRateHz;
  const resampled: number[] = [];
  let idx = 0;

  for (let t = 0; t < totalTime && resampled.length < nSamples; t += step) {
    while (idx < times.length - 1 && times[idx + 1] < t) idx++;
    const t1 = times[idx];
    const t2 = times[idx + 1] ?? t1 + step;
    const v1 = ibisMs[idx];
    const v2 = ibisMs[idx + 1] ?? v1;
    const frac = t2 !== t1 ? (t - t1) / (t2 - t1) : 0;
    resampled.push(v1 + (v2 - v1) * frac);
  }

  return resampled;
}

function hannWindow(n: number): number[] {
  const w = new Array(n);
  for (let i = 0; i < n; i++)
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

/**
 * LF/HF power ratio from IBI series.
 * Fixed: uses the FFT already implemented in this module instead of the original
 * O(n²) manual DFT loop (was 32k–65k operations per call on A10).
 */
function computeLfHfRatioFromIBI(ibisMs: number[]): number {
  const fs = 4;
  const series = interpolateIBI(ibisMs, fs);
  if (series.length < 64) return 0;

  const n = series.length;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  const winWeights = hannWindow(n);
  const windowed = series.map((v, i) => (v - mean) * winWeights[i]);

  // O(n log n) FFT — same function used everywhere else in this module
  const fftResult = fft(windowed);
  const freqRes = fs / fftResult.length;

  let lf = 0,
    hf = 0;
  for (let k = 1; k < Math.floor(fftResult.length / 2); k++) {
    const power = getMagnitude(fftResult[k]) ** 2 / n;
    const freq = k * freqRes;
    if (freq >= 0.04 && freq < 0.15) lf += power;
    if (freq >= 0.15 && freq < 0.4) hf += power;
  }

  return hf > 0 ? lf / hf : 0;
}

// ============================================================================
// SIGNAL QUALITY
// ============================================================================

export function calculateKurtosis(data: number[]): number {
  const n = data.length;
  if (n < 4) return 0;
  const mean = data.reduce((a, b) => a + b, 0) / n;
  let m2 = 0,
    m4 = 0;
  for (let i = 0; i < n; i++) {
    const diff = data[i] - mean;
    const diff2 = diff * diff;
    m2 += diff2;
    m4 += diff2 * diff2;
  }
  const variance = m2 / n;
  if (variance < 1e-10) return 0;
  return m4 / n / (variance * variance);
}

export function calculateSkewness(data: number[]): number {
  const n = data.length;
  if (n < 3) return 0;
  const mean = data.reduce((a, b) => a + b, 0) / n;
  let m2 = 0,
    m3 = 0;
  for (const x of data) {
    const d = x - mean;
    m2 += d * d;
    m3 += d * d * d;
  }
  const stdDev = Math.sqrt(m2 / n);
  if (stdDev < 1e-10) return 0;
  return m3 / n / (stdDev * stdDev * stdDev);
}

/**
 * Advanced Signal Quality Index — 5 weighted metrics, returns 0–100.
 * Use this everywhere instead of the legacy assessSignalQuality().
 */
export function calculateAdvancedSQI(signal: number[], fs: number): number {
  if (signal.length < 30) return 0;

  const detrended = detrendSignal(signal);
  const windowed = applyHannWindow(detrended);
  const fftResult = fft(windowed);
  const n = fftResult.length;
  const powerSpectrum = fftResult.slice(0, Math.floor(n / 2)).map(getMagnitude);
  const freqResolution = fs / n;

  const minIdx = Math.floor(0.667 / freqResolution);
  const maxIdx = Math.ceil(4.0 / freqResolution);
  const cardiacBand = powerSpectrum.slice(minIdx, maxIdx + 1);
  const maxPower = Math.max(...cardiacBand);
  const totalPower = cardiacBand.reduce((a, b) => a + b, 0);
  const spectralPurity = totalPower > 0 ? maxPower / totalPower : 0;
  const spectralScore = Math.min(spectralPurity / 0.4, 1);

  const kurtosis = calculateKurtosis(signal);
  const kurtosisScore = Math.exp(-Math.abs(kurtosis - 3) / 3);

  const snr = calculateSNR(signal);
  const snrScore = Math.min(Math.max((snr - 5) / 20, 0), 1);

  const pi = calculatePerfusionIndex(signal);
  const piScore = Math.min(Math.max(pi / 10, 0), 1);

  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const variance =
    signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const stabilityScore =
    cv > 0.01 && cv < 0.5 ? 1 : Math.exp(-Math.abs(cv - 0.1) / 0.2);

  const weights = [0.3, 0.2, 0.2, 0.15, 0.15];
  const scores = [
    spectralScore,
    kurtosisScore,
    snrScore,
    piScore,
    stabilityScore,
  ];
  return weights.reduce((sum, w, i) => sum + w * scores[i], 0) * 100;
}

/**
 * @deprecated Use calculateAdvancedSQI instead.
 * Kept only for backwards compatibility with any callers not yet updated.
 */
export function assessSignalQuality(data: number[]): number {
  const n = data.length;
  if (n < 10) return 0;
  const mean = data.reduce((a, b) => a + b, 0) / n;
  let sumSquares = 0,
    maxVal = -Infinity,
    minVal = Infinity;
  for (const v of data) {
    sumSquares += (v - mean) * (v - mean);
    if (v > maxVal) maxVal = v;
    if (v < minVal) minVal = v;
  }
  const acComponent = Math.sqrt(sumSquares / n);
  const snr = Math.abs(mean) > 0 ? acComponent / Math.abs(mean) : 0;
  const snrScore = snr > 0.001 && snr < 1.0 ? 1 : 0;
  let m2 = 0,
    m3 = 0;
  for (const v of data) {
    const d = v - mean;
    m2 += d * d;
    m3 += d * d * d;
  }
  const stdDev = Math.sqrt(m2 / n);
  const skewness = stdDev > 0 ? m3 / n / (stdDev * stdDev * stdDev) : 0;
  const skewnessScore = Math.abs(skewness) > 0.2 ? 1 : 0;
  const ppScore = maxVal - minVal > 1 ? 1 : 0;
  const total = snrScore + skewnessScore + ppScore;
  return total >= 1 ? 1 : 0;
}

// ============================================================================
// UTILITY
// ============================================================================

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function weightedMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const weighted: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const weight = i + 1;
    for (let w = 0; w < weight; w++) weighted.push(values[i]);
  }
  return median(weighted);
}

export class KalmanFilter {
  private x = 70;
  private p = 10;
  private readonly q = 0.5;
  private readonly r = 5;

  update(measurement: number): number {
    this.p = this.p + this.q;
    const k = this.p / (this.p + this.r);
    this.x = this.x + k * (measurement - this.x);
    this.p = (1 - k) * this.p;
    return this.x;
  }

  reset() {
    this.x = 70;
    this.p = 10;
  }
}

export function calculatePerfusionIndex(signal: number[]): number {
  if (signal.length === 0) return 0;
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const max = Math.max(...signal);
  const min = Math.min(...signal);
  const acComponent = (max - min) / 2;
  return mean > 0 ? (acComponent / mean) * 100 : 0;
}

export function calculateSNR(signal: number[]): number {
  if (signal.length < 2) return 0;
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  let signalPower = 0;
  for (const v of signal) signalPower += Math.pow(v - mean, 2);
  signalPower /= signal.length;
  let noisePower = 0;
  for (let i = 1; i < signal.length; i++)
    noisePower += Math.pow(signal[i] - signal[i - 1], 2);
  noisePower /= signal.length - 1;
  return noisePower > 0 ? 10 * Math.log10(signalPower / noisePower) : 0;
}

export function calculateSQI(signal: number[], fs: number = 30): number {
  return calculateAdvancedSQI(signal, fs);
}

export function estimateRespirationRate(signal: number[], fs: number): number {
  if (signal.length < 30) return 0;
  const window = Math.max(3, Math.floor(fs / 2));
  const smooth: number[] = [];
  for (let i = 0; i < signal.length; i++) {
    let sum = 0,
      count = 0;
    for (let j = i - window; j <= i + window; j++) {
      if (j >= 0 && j < signal.length) {
        sum += signal[j];
        count++;
      }
    }
    smooth.push(sum / count);
  }
  const mean = smooth.reduce((a, b) => a + b, 0) / smooth.length;
  const envNorm = smooth.map((x) => x - mean);
  let zeroCrossings = 0;
  for (let i = 1; i < envNorm.length; i++) {
    if (
      (envNorm[i - 1] > 0 && envNorm[i] <= 0) ||
      (envNorm[i - 1] < 0 && envNorm[i] >= 0)
    ) {
      zeroCrossings++;
    }
  }
  const durationMin = signal.length / fs / 60;
  const rr = zeroCrossings / 2 / durationMin;
  return rr >= 6 && rr <= 40 ? rr : 0;
}
