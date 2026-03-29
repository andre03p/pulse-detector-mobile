// ============================================================================
// BUTTERWORTH BANDPASS FILTER (4th Order)
// ============================================================================

class SecondOrderSection {
  private b: number[] = [];
  private a: number[] = [];
  private x: number[] = [0, 0, 0];
  private y: number[] = [0, 0, 0];

  constructor(fs: number, lowFreq: number, highFreq: number) {
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
    // 4th-order filter as cascade of two 2nd-order sections
    // 0.667 Hz = 40 BPM, 4.0 Hz = 240 BPM
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
// FFT (Cooley-Tukey)
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

  const windowed = applyHannWindow(detrendSignal(signal));
  const fftResult = fft(windowed);
  const n = fftResult.length;
  const powerSpectrum = fftResult.slice(0, Math.floor(n / 2)).map(getMagnitude);
  const freqRes = fs / n;

  const minIdx = Math.max(1, Math.floor(0.667 / freqRes));
  const maxIdx = Math.min(powerSpectrum.length - 2, Math.ceil(3.667 / freqRes));

  let maxPower = -Infinity;
  let peakIdx = minIdx;
  for (let i = minIdx; i <= maxIdx; i++) {
    if (powerSpectrum[i] > maxPower) {
      maxPower = powerSpectrum[i];
      peakIdx = i;
    }
  }

  // Reject if peak is not prominent
  const avgPower =
    powerSpectrum.slice(minIdx, maxIdx + 1).reduce((a, b) => a + b, 0) /
    (maxIdx - minIdx + 1);
  if (maxPower < avgPower * 2) return 0;

  // Parabolic interpolation for sub-bin accuracy
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

  const bpm = refinedIdx * freqRes * 60;

  // Halve if strong harmonic detected at 2x the frequency
  const harmonicIdx = Math.round(refinedIdx * 2);
  if (
    harmonicIdx < powerSpectrum.length &&
    powerSpectrum[harmonicIdx] > maxPower * 0.7
  ) {
    const halfBpm = bpm / 2;
    return halfBpm >= 40 && halfBpm <= 220 ? halfBpm : 0;
  }

  return bpm >= 40 && bpm <= 220 ? bpm : 0;
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
    for (let i = 0; i < n - lag; i++) {
      sum += centered[i] * centered[i + lag];
    }
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

  // Parabolic interpolation
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

  // Prefer half-lag if its autocorrelation is also strong (harmonic check)
  const halfLag = Math.round(refinedLag / 2);
  if (halfLag >= minLag && halfLag <= maxLag) {
    const halfIdx = halfLag - minLag;
    if (
      halfIdx >= 0 &&
      halfIdx < autocorr.length &&
      autocorr[halfIdx] > maxCorr * 0.7
    ) {
      refinedLag = halfLag;
    }
  }

  const bpm = 60 / (refinedLag / fs);
  return bpm >= 40 && bpm <= 220 ? bpm : 0;
}

export interface HeartRateEstimate {
  bpm: number;
  confidence: number;
  method: string;
}

/**
 * Ensemble: FFT (spectral) + Autocorrelation (temporal).
 * FFT is excellent for stationary signals; autocorrelation handles
 * non-stationarity better. Agreement between the two gives high confidence.
 */
export function estimateHeartRateEnsemble(
  signal: number[],
  fs: number,
): HeartRateEstimate {
  if (signal.length < 30) {
    return { bpm: 0, confidence: 0, method: "insufficient_data" };
  }

  const fftBpm = estimateHeartRateFFT(signal, fs);
  const autocorrBpm = estimateHeartRateAutocorrelation(signal, fs);

  const valid: { bpm: number; weight: number }[] = [];
  if (fftBpm > 0) valid.push({ bpm: fftBpm, weight: 1.5 });
  if (autocorrBpm > 0) valid.push({ bpm: autocorrBpm, weight: 1.2 });

  if (valid.length === 0) {
    return { bpm: 0, confidence: 0, method: "no_valid_estimate" };
  }

  if (valid.length === 1) {
    return { bpm: Math.round(valid[0].bpm), confidence: 0.4, method: "single" };
  }

  // Confidence is based on how closely the two methods agree
  const diff = Math.abs(fftBpm - autocorrBpm);
  let confidence: number;
  if (diff < 3) confidence = 0.95;
  else if (diff < 6) confidence = 0.85;
  else if (diff < 12) confidence = 0.65;
  else confidence = 0.4;

  const totalWeight = valid.reduce((s, e) => s + e.weight, 0);
  const weightedBpm =
    valid.reduce((s, e) => s + e.bpm * e.weight, 0) / totalWeight;

  const method =
    confidence >= 0.85
      ? "ensemble_high"
      : confidence >= 0.65
        ? "ensemble_medium"
        : "ensemble_low";

  return { bpm: Math.round(weightedBpm), confidence, method };
}

// ============================================================================
// IBI AND HRV (SDNN + RMSSD)
// ============================================================================

export function calculateIBI(signal: number[], fs: number): number[] {
  // 3-point smoothing to reduce noise before peak detection
  const smooth = signal.map(
    (v, i, arr) => (arr[i] + (arr[i - 1] ?? v) + (arr[i + 1] ?? v)) / 3,
  );

  const maxVal = Math.max(...smooth);
  const minVal = Math.min(...smooth);
  const threshold = minVal + (maxVal - minVal) * 0.5;
  const minDist = Math.floor(0.25 * fs); // 250 ms minimum IBI → 240 BPM max

  const peaks: number[] = [];
  let lastPeak = -minDist;

  for (let i = 1; i < smooth.length - 1; i++) {
    if (
      smooth[i] > smooth[i - 1] &&
      smooth[i] > smooth[i + 1] &&
      smooth[i] > threshold
    ) {
      if (i - lastPeak > minDist) {
        peaks.push(i);
        lastPeak = i;
      } else if (smooth[i] > smooth[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i;
        lastPeak = i;
      }
    }
  }

  const ibis: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const ms = ((peaks[i] - peaks[i - 1]) / fs) * 1000;
    if (ms > 300 && ms < 2000) ibis.push(ms); // physiological range
  }
  return ibis;
}

export interface HRVMetrics {
  sdnn: number;
  rmssd: number;
}

export function calculateHRV(ibis: number[]): HRVMetrics {
  const med = median(ibis);
  // Ectopic beat rejection: remove IBIs deviating >20% from median
  const valid = ibis.filter((t) => Math.abs(t - med) < 0.2 * med);

  if (valid.length < 5) return { sdnn: 0, rmssd: 0 };

  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;

  const sdnn = Math.sqrt(
    valid.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (valid.length - 1),
  );

  let sumSqDiff = 0;
  for (let i = 1; i < valid.length; i++) {
    sumSqDiff += (valid[i] - valid[i - 1]) ** 2;
  }
  const rmssd = Math.sqrt(sumSqDiff / (valid.length - 1));

  return { sdnn, rmssd };
}

// ============================================================================
// RESPIRATORY RATE — FFT on the low-frequency amplitude envelope
// ============================================================================

/**
 * Extracts respiratory rate from the slow (sub-cardiac) modulation of the
 * PPG signal using spectral analysis.  Heavy moving-average removes the
 * cardiac component; FFT then finds the dominant respiratory frequency.
 */
export function estimateRespirationRate(signal: number[], fs: number): number {
  if (signal.length < fs * 8) return 0; // need ≥ 8 s

  // 2-second moving average suppresses cardiac oscillations (~1 Hz)
  const halfWin = Math.floor(fs); // 1 s each side
  const envelope: number[] = [];
  for (let i = 0; i < signal.length; i++) {
    const start = Math.max(0, i - halfWin);
    const end = Math.min(signal.length, i + halfWin + 1);
    let sum = 0;
    for (let j = start; j < end; j++) sum += signal[j];
    envelope.push(sum / (end - start));
  }

  const windowed = applyHannWindow(detrendSignal(envelope));
  const fftResult = fft(windowed);
  const n = fftResult.length;
  const power = fftResult.slice(0, Math.floor(n / 2)).map(getMagnitude);
  const freqRes = fs / n;

  // Respiratory band: 0.1 – 0.667 Hz (6 – 40 breaths/min)
  const minIdx = Math.max(1, Math.floor(0.1 / freqRes));
  const maxIdx = Math.min(power.length - 1, Math.ceil(0.667 / freqRes));

  let maxPower = -Infinity;
  let peakIdx = minIdx;
  for (let i = minIdx; i <= maxIdx; i++) {
    if (power[i] > maxPower) {
      maxPower = power[i];
      peakIdx = i;
    }
  }

  // Require a clear spectral peak
  const avgPower =
    power.slice(minIdx, maxIdx + 1).reduce((a, b) => a + b, 0) /
    (maxIdx - minIdx + 1);
  if (maxPower < avgPower * 1.5) return 0;

  const rr = peakIdx * freqRes * 60;
  return rr >= 6 && rr <= 40 ? rr : 0;
}

// ============================================================================
// SIGNAL QUALITY CHECK
// ============================================================================

/**
 * Quick sanity check: reject flat or saturated signals before running
 * the expensive estimation algorithms.
 */
export function checkSignalQuality(signal: number[]): boolean {
  if (signal.length < 10) return false;
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const variance =
    signal.reduce((sum, x) => sum + (x - mean) ** 2, 0) / signal.length;
  const range = Math.max(...signal) - Math.min(...signal);
  return variance > 0.5 && range > 1;
}

// ============================================================================
// UTILITIES
// ============================================================================

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
