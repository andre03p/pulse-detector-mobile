// 2nd-order bandpass biquad

export class ButterworthFilter {
  private b0: number;
  private b2: number;
  private a1: number;
  private a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(fs: number, lowCutoff = 0.6, highCutoff = 3.8) {
    const warpedLow = Math.tan((Math.PI * lowCutoff) / fs);
    const warpedHigh = Math.tan((Math.PI * highCutoff) / fs);
    const bandwidth = warpedHigh - warpedLow;
    const centerSq = warpedLow * warpedHigh;
    const norm = 1 / (1 + bandwidth + centerSq);
    this.b0 = bandwidth * norm;
    this.b2 = -bandwidth * norm;
    this.a1 = 2 * (centerSq - 1) * norm;
    this.a2 = (1 - bandwidth + centerSq) * norm;
  }

  process(x0: number): number {
    const y0 =
      this.b0 * x0 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x0;
    this.y2 = this.y1;
    this.y1 = y0;
    return y0;
  }

  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

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

// Physiologically plausible heart-rate range — single source of truth shared
// by both estimators and the UI acceptance check.
export const MIN_BPM = 40;
export const MAX_BPM = 200;

export interface PowerSpectrum {
  powerSpectrum: number[];
  freqResolution: number;
}

/**
 * Detrend -> Hann window -> FFT -> half-spectrum magnitudes.
 * Computed once per window and shared between the FFT estimator and the
 * signal-quality index, which would otherwise each run their own FFT.
 */
export function computePowerSpectrum(
  signal: number[],
  fs: number,
): PowerSpectrum {
  const detrended = detrendSignal(signal);
  const windowed = applyHannWindow(detrended);
  const fftResult = fft(windowed);
  const n = fftResult.length;
  const powerSpectrum = fftResult.slice(0, Math.floor(n / 2)).map(getMagnitude);
  return { powerSpectrum, freqResolution: fs / n };
}

export function estimateHeartRateFFT(
  signal: number[],
  fs: number,
  spectrum?: PowerSpectrum,
): number {
  if (signal.length < 30) return 0;

  const { powerSpectrum, freqResolution } =
    spectrum ?? computePowerSpectrum(signal, fs);

  const minIndex = Math.max(1, Math.floor(0.6 / freqResolution));
  const maxIndex = Math.min(
    powerSpectrum.length - 2,
    Math.ceil(3.8 / freqResolution),
  );

  let maxPower = -Infinity;
  let peakIndex = minIndex;
  for (let i = minIndex; i <= maxIndex; i++) {
    if (powerSpectrum[i] > maxPower) {
      maxPower = powerSpectrum[i];
      peakIndex = i;
    }
  }

  const avgPower =
    powerSpectrum.slice(minIndex, maxIndex + 1).reduce((a, b) => a + b, 0) /
    (maxIndex - minIndex + 1);
  if (maxPower < avgPower * 2) return 0;

  const refinedIndex = refinePeak(powerSpectrum, peakIndex);

  const freqHz = refinedIndex * freqResolution;
  const bpm = freqHz * 60;

  const harmonicIndex = Math.round(refinedIndex / 2);
  if (harmonicIndex < powerSpectrum.length) {
    if (powerSpectrum[harmonicIndex] > maxPower * 0.7) return bpm / 2;
  }

  return bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : 0;
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

  return peakIndex + Math.max(-0.5, Math.min(0.5, offset));
}

export function estimateBpmFromAutocorrelation(
  signal: number[],
  fs: number,
): number {
  if (signal.length < 30) return 0;

  const detrended = detrendSignal(signal);
  const n = detrended.length;

  const variance = detrended.reduce((sum, x) => sum + x * x, 0);
  if (variance < 1e-10) return 0;

  const minLag = Math.floor((fs * 60) / MAX_BPM);
  const maxLag = Math.floor((fs * 60) / MIN_BPM);

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
    const halfLagIndex = halfLag - minLag;
    if (halfLagIndex >= 0 && halfLagIndex < autocorr.length) {
      if (autocorr[halfLagIndex] > maxCorr * 0.7) refinedLag = halfLag;
    }
  }

  const bpm = 60 / (refinedLag / fs);
  return bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : 0;
}

// Methods disagreeing by more than this (BPM) means one likely locked onto a
// harmonic, so we abstain instead of averaging two inconsistent values.
const MAX_METHOD_DISAGREEMENT = 15;

/**
 * Combined estimate from FFT + autocorrelation. Returns 0 when there is no
 * usable estimate (no peak found, or the two methods disagree strongly).
 */
export function estimateBpm(
  signal: number[],
  fs: number,
  spectrum?: PowerSpectrum,
): number {
  if (signal.length < 30) return 0;

  const fftBpm = estimateHeartRateFFT(signal, fs, spectrum);
  const autocorrBpm = estimateBpmFromAutocorrelation(signal, fs);

  if (fftBpm === 0 && autocorrBpm === 0) return 0;
  if (fftBpm === 0) return autocorrBpm;
  if (autocorrBpm === 0) return fftBpm;

  if (Math.abs(fftBpm - autocorrBpm) >= MAX_METHOD_DISAGREEMENT) return 0;

  return Math.round((fftBpm + autocorrBpm) / 2);
}

export function calculateSignalQuality(
  signal: number[],
  fs: number,
  rawSignal: number[],
  spectrum?: PowerSpectrum,
): number {
  if (signal.length < 30) return 0;

  const { powerSpectrum, freqResolution } =
    spectrum ?? computePowerSpectrum(signal, fs);

  const minIndex = Math.floor(0.6 / freqResolution);
  const maxIndex = Math.ceil(3.8 / freqResolution);
  const cardiacBand = powerSpectrum.slice(minIndex, maxIndex + 1);
  const maxPower = Math.max(...cardiacBand);
  const totalPower = cardiacBand.reduce((a, b) => a + b, 0);
  const spectralPurity = totalPower > 0 ? maxPower / totalPower : 0;
  const spectralScore = Math.min(spectralPurity / 0.4, 1);

  const snr = calculateSNR(signal);
  const snrScore = Math.min(Math.max((snr - 5) / 20, 0), 1);

  const mean = rawSignal.reduce((a, b) => a + b, 0) / rawSignal.length;
  const variance =
    rawSignal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rawSignal.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const stabilityScore =
    cv > 0.01 && cv < 0.5 ? 1 : Math.exp(-Math.abs(cv - 0.1) / 0.2);

  const weights = [0.5, 0.3, 0.2];
  const scores = [spectralScore, snrScore, stabilityScore];
  return weights.reduce((sum, w, i) => sum + w * scores[i], 0) * 100;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Arithmetic mean. Used for the 1-minute mode to report the average heart rate
 * over the whole window — matching how the Empatica EmbracePlus aggregates its
 * per-minute pulse rate (average over the minute, never the peak).
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
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
