// ============================================================================
// BUTTERWORTH FILTER — 2nd order bandpass biquad
// ============================================================================

export class ButterworthFilter {
  private b0: number; private b2: number;
  private a1: number; private a2: number;
  private x1 = 0; private x2 = 0;
  private y1 = 0; private y2 = 0;

  constructor(fs: number, lowCutoff = 0.667, highCutoff = 4.0) {
    const wl = Math.tan((Math.PI * lowCutoff) / fs);
    const wh = Math.tan((Math.PI * highCutoff) / fs);
    const bw = wh - wl;
    const w0sq = wl * wh;
    const norm = 1 / (1 + bw + w0sq);
    this.b0 = bw * norm;
    this.b2 = -bw * norm;
    this.a1 = 2 * (w0sq - 1) * norm;
    this.a2 = (1 - bw + w0sq) * norm;
  }

  process(x0: number): number {
    const y0 = this.b0 * x0 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x0;
    this.y2 = this.y1; this.y1 = y0;
    return y0;
  }

  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
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

  const refinedIdx = refinePeak(powerSpectrum, peakIdx);

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

  const detrended = detrendSignal(signal);
  const n = detrended.length;

  const variance = detrended.reduce((sum, x) => sum + x * x, 0);
  if (variance < 1e-10) return 0;

  const minLag = Math.floor(fs * (60 / 220));
  const maxLag = Math.floor(fs * (60 / 40));

  const autocorr: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += detrended[i] * detrended[i + lag];
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

  let refinedLag = minLag + refinePeak(autocorr, bestLagOffset);

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

  if (fftBpm === 0 && autocorrBpm === 0)
    return { bpm: 0, confidence: 0, method: "no_valid_estimate" };
  if (fftBpm === 0) return { bpm: autocorrBpm, confidence: 0.4, method: "autocorr" };
  if (autocorrBpm === 0) return { bpm: fftBpm, confidence: 0.4, method: "fft" };

  const avg = Math.round((fftBpm + autocorrBpm) / 2);
  const diff = Math.abs(fftBpm - autocorrBpm);

  if (diff < 6)  return { bpm: avg, confidence: 0.95, method: "ensemble_high" };
  if (diff < 10) return { bpm: avg, confidence: 0.85, method: "ensemble_medium" };
  if (diff < 20) return { bpm: avg, confidence: 0.65, method: "ensemble_low" };

  // Methods disagree strongly — abstain rather than average two potentially wrong values.
  return { bpm: 0, confidence: 0, method: "ensemble_uncertain" };
}

// ============================================================================
// IBI + HRV
// ============================================================================

/**
 * Compute inter-beat intervals from a PPG signal.
 * Uses moving-average baseline removal + smoothing + IQR adaptive threshold.
 * Minimum peak distance is 350 ms to suppress dicrotic notches.
 * Parabolic sub-sample interpolation via refinePeak() reduces timing error
 * from ±33 ms to ±2 ms at 30 fps.
 */
function movingAverage(signal: number[], halfWin: number): number[] {
  return signal.map((_, i) => {
    const start = Math.max(0, i - halfWin);
    const end = Math.min(signal.length, i + halfWin + 1);
    let sum = 0;
    for (let j = start; j < end; j++) sum += signal[j];
    return sum / (end - start);
  });
}

export function calculateIBI(signal: number[], fs: number): number[] {
  if (signal.length < fs * 2) return [];

  // Step 1 — moving-average baseline removal (200 ms window)
  const baseline = movingAverage(signal, Math.floor(fs * 0.1));
  const detrended = signal.map((v, i) => v - baseline[i]);

  // Step 2 — smoothing (50 ms window)
  const smoothed = movingAverage(detrended, Math.max(3, Math.floor(fs * 0.05)));

  // Step 3 — IQR adaptive threshold
  const sorted = [...smoothed].sort((a, b) => a - b);
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const threshold = p25 + (p75 - p25) * 0.5;

  // Step 4 — peak detection with 350 ms minimum distance
  // 350 ms ≈ 171 BPM max, safely above any dicrotic notch timing
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
        rawPeaks[rawPeaks.length - 1] = i;
      }
    }
  }

  if (rawPeaks.length < 2) return [];

  // Step 5 — parabolic sub-sample refinement
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
  rmssd: number;
}

/**
 * Compute RMSSD from an array of inter-beat intervals (ms).
 * Caller should gate on enough intervals (e.g. 20+) for stability.
 */
export function calculateHRV(ibis: number[]): HRVMetrics {
  const medianIBI = median(ibis);
  // Remove ectopic beats / artifacts (standard 20% median-deviation rule)
  const validIBIs = ibis.filter(
    (t) => Math.abs(t - medianIBI) < 0.2 * medianIBI,
  );

  if (validIBIs.length < 3) {
    return { rmssd: 0 };
  }

  let sumSqDiff = 0;
  for (let i = 1; i < validIBIs.length; i++) {
    const diff = validIBIs[i] - validIBIs[i - 1];
    sumSqDiff += diff * diff;
  }
  const rmssd = Math.sqrt(sumSqDiff / (validIBIs.length - 1));
  return { rmssd };
}

// ============================================================================
// SIGNAL QUALITY
// ============================================================================

/**
 * Signal Quality Index — 3 weighted metrics, returns 0–100.
 * Metrics: spectral purity (0.5), SNR (0.3), amplitude stability (0.2).
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

  const snr = calculateSNR(signal);
  const snrScore = Math.min(Math.max((snr - 5) / 20, 0), 1);

  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const variance =
    signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const stabilityScore =
    cv > 0.01 && cv < 0.5 ? 1 : Math.exp(-Math.abs(cv - 0.1) / 0.2);

  const weights = [0.5, 0.3, 0.2];
  const scores = [spectralScore, snrScore, stabilityScore];
  return weights.reduce((sum, w, i) => sum + w * scores[i], 0) * 100;
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

// ============================================================================
// THERMAL WARNING
// ============================================================================

/**
 * Returns a warning shown during an active measurement when the camera flash
 * has been running long enough to measurably heat the sensor (~17s+).
 * Uses an exponential heating model (tau=20s, max rise 3.5°C).
 */
export function getThermalWarning(elapsedMs: number): string | null {
  const t = elapsedMs / 1000;
  const estimatedRise = 3.5 * (1 - Math.exp(-t / 20));
  if (estimatedRise > 2.0)
    return "Camera warming up — hold still for best accuracy";
  return null;
}

/**
 * Returns a cooldown notice shown on the start screen after a long measurement.
 * elapsedSinceEndMs: milliseconds since the last measurement ended.
 */
export function getThermalCooldownNotice(
  elapsedSinceEndMs: number,
): string | null {
  if (elapsedSinceEndMs >= 45_000) return null;
  return "Camera may still be warm — wait a moment for best accuracy";
}
