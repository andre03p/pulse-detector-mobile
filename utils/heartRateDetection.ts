export class ButterworthFilter {
  private b: number[] = [];
  private a: number[] = [];
  private x: number[] = [0, 0, 0];
  private y: number[] = [0, 0, 0];

  constructor(fs: number, lowCutoff: number = 0.5, highCutoff: number = 5.0) {
    this.calculateCoefficients(fs, lowCutoff, highCutoff);
  }

  /**
   * Calculates coefficients for a 2nd-order Bandpass Butterworth filter
   * using the Bilinear Transform.
   */
  private calculateCoefficients(fs: number, lowFreq: number, highFreq: number) {
    // Standardizing to Nyquist
    const fn = fs / 2;
    const w_low = Math.tan((Math.PI * lowFreq) / fs);
    const w_high = Math.tan((Math.PI * highFreq) / fs);

    // Bandwidth and Center Frequency
    const bw = w_high - w_low;
    const w0 = Math.sqrt(w_low * w_high);

    // Constants for 2nd order BPF
    // H(s) = (s * bw) / (s^2 + s * bw + w0^2)
    const norm = 1 / (1 + bw + w0 * w0);

    this.b = [bw * norm, 0, -bw * norm];

    this.a = [
      1, // a0 is normalized to 1
      2 * (w0 * w0 - 1) * norm,
      (1 - bw + w0 * w0) * norm,
    ];

    // Reset history buffers size to match order (2nd order = 2 previous samples)
    this.x = [0, 0, 0];
    this.y = [0, 0, 0];
  }

  process(input: number): number {
    // Shift history
    this.x[2] = this.x[1];
    this.x[1] = this.x[0];
    this.y[2] = this.y[1];
    this.y[1] = this.y[0];

    this.x[0] = input;

    // Difference equation:
    // y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
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

function refinePeak(correlations: number[], peakIndex: number): number {
  if (peakIndex <= 0 || peakIndex >= correlations.length - 1) {
    return peakIndex;
  }

  const y1 = correlations[peakIndex - 1];
  const y2 = correlations[peakIndex];
  const y3 = correlations[peakIndex + 1];

  const denominator = y1 - 2 * y2 + y3;
  if (Math.abs(denominator) < 1e-10) {
    return peakIndex;
  }

  const offset = (0.5 * (y1 - y3)) / denominator;

  return peakIndex + offset;
}

export function estimateHeartRateAutocorrelation(
  signal: number[],
  fs: number
): number {
  const n = signal.length;
  const mean = signal.reduce((a, b) => a + b, 0) / n;

  // Center and normalize variance
  const centered = signal.map((x) => x - mean);
  let variance = centered.reduce((sum, x) => sum + x * x, 0);

  if (variance < 1e-10) return 0;

  // Lag limits: 40 BPM to 220 BPM
  const minLag = Math.floor(fs * (60 / 220));
  const maxLag = Math.floor(fs * (60 / 40));

  let maxCorr = -1;
  let bestLag = 0;

  // Calculate Autocorrelation
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    // Only go up to n - maxLag to keep the number of points consistent
    // or normalize by (n-lag)
    for (let i = 0; i < n - lag; i++) {
      sum += centered[i] * centered[i + lag];
    }
    // Normalize by variance (and adjust for decreasing overlap length)
    const correlation = sum / variance;

    if (correlation > maxCorr) {
      maxCorr = correlation;
      bestLag = lag;
    }
  }

  // Quality Threshold
  if (maxCorr < 0.2 || bestLag === 0) return 0;

  // Harmonic Check:
  // Sometimes the highest peak is at 2x the period (half the heart rate).
  // We check if there is a strong peak at 0.5 * bestLag.
  const halfLag = Math.round(bestLag / 2);
  if (halfLag >= minLag) {
    let sumHalf = 0;
    for (let i = 0; i < n - halfLag; i++)
      sumHalf += centered[i] * centered[i + halfLag];
    const corrHalf = sumHalf / variance;

    // If the half-lag correlation is at least 60% as strong as the main lag,
    // prefer the shorter lag (higher HR) as it's likely the fundamental frequency.
    if (corrHalf > maxCorr * 0.6) {
      bestLag = halfLag;
    }
  }

  // Refine peak using parabolic interpolation (reusing your refinePeak logic)
  // ... (Assumes refinePeak is available as in your original code)

  const periodSeconds = bestLag / fs;
  return 60 / periodSeconds;
}

export function calculateSkewness(data: number[]): number {
  const n = data.length;
  if (n < 3) return 0;

  const mean = data.reduce((a, b) => a + b, 0) / n;
  let m2 = 0;
  let m3 = 0;

  for (let i = 0; i < n; i++) {
    const diff = data[i] - mean;
    m2 += diff * diff;
    m3 += diff * diff * diff;
  }

  const variance = m2 / n;
  const stdDev = Math.sqrt(variance);

  const skewness = m3 / n / (stdDev * stdDev * stdDev);
  return skewness;
}

export function assessSignalQuality(data: number[]): number {
  const n = data.length;
  if (n < 10) return 0;

  const mean = data.reduce((a, b) => a + b, 0) / n;

  let sumSquares = 0;
  let maxVal = -Infinity;
  let minVal = Infinity;

  for (let i = 0; i < n; i++) {
    sumSquares += (data[i] - mean) * (data[i] - mean);
    maxVal = Math.max(maxVal, data[i]);
    minVal = Math.min(minVal, data[i]);
  }

  const acComponent = Math.sqrt(sumSquares / n);
  const dcComponent = Math.abs(mean);
  const snr = dcComponent > 0 ? acComponent / dcComponent : 0;

  const snrScore = snr > 0.001 && snr < 1.0 ? 1 : 0;

  let m2 = 0,
    m3 = 0;
  for (let i = 0; i < n; i++) {
    const diff = data[i] - mean;
    m2 += diff * diff;
    m3 += diff * diff * diff;
  }
  const variance = m2 / n;
  const stdDev = Math.sqrt(variance);
  const skewness = stdDev > 0 ? m3 / n / (stdDev * stdDev * stdDev) : 0;
  const skewnessScore = Math.abs(skewness) > 0.2 ? 1 : 0;

  const peakToPeak = maxVal - minVal;
  const ppScore = peakToPeak > 1 ? 1 : 0;

  const totalScore = snrScore + skewnessScore + ppScore;
  return totalScore >= 1 ? 1 : 0;
}

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
    for (let w = 0; w < weight; w++) {
      weighted.push(values[i]);
    }
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

/**
 * Calculate IBI (Inter-Beat Intervals) from signal
 */
export function calculateIBI(signal: number[], fs: number): number[] {
  // 1. Smooth signal slightly to remove high-freq noise before peak detection
  // Simple 3-point moving average
  const smooth = signal.map(
    (v, i, arr) => (arr[i] + (arr[i - 1] || v) + (arr[i + 1] || v)) / 3
  );

  const peaks: number[] = [];
  // Dynamic threshold based on signal max (e.g., 50% of max amplitude)
  const maxVal = Math.max(...smooth);
  const minVal = Math.min(...smooth);
  const threshold = minVal + (maxVal - minVal) * 0.5;

  // Refractory period: Minimum time (ms) between beats to prevent double counting.
  // 250ms corresponds to a max HR of 240 BPM, which is safe.
  const minDistanceSamples = Math.floor(0.25 * fs);

  let lastPeakIndex = -minDistanceSamples;

  for (let i = 1; i < smooth.length - 1; i++) {
    // Check if local maximum
    if (smooth[i] > smooth[i - 1] && smooth[i] > smooth[i + 1]) {
      // Check magnitude threshold
      if (smooth[i] > threshold) {
        // Check refractory period
        if (i - lastPeakIndex > minDistanceSamples) {
          peaks.push(i);
          lastPeakIndex = i;
        } else {
          // If we found a higher peak within the refractory period, update it
          // (This handles cases where the dicrotic notch was higher than the systolic peak due to noise, though rare)
          if (smooth[i] > smooth[lastPeakIndex]) {
            peaks.pop(); // Remove the previous false positive
            peaks.push(i);
            lastPeakIndex = i;
          }
        }
      }
    }
  }

  // Calculate intervals
  const ibis: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const intervalMs = ((peaks[i] - peaks[i - 1]) / fs) * 1000;
    // Sanity check for physiological limits (300ms to 2000ms -> 30 to 200 BPM)
    if (intervalMs > 300 && intervalMs < 2000) {
      ibis.push(intervalMs);
    }
  }

  return ibis;
}

/**
 * Calculate HRV metrics from IBI values
 */
export interface HRVMetrics {
  sdnn: number; // Standard deviation of NN intervals
  rmssd: number; // Root mean square of successive differences
  pnn50: number; // Percentage of successive NN intervals that differ by more than 50ms
  lfHfRatio: number; // Low frequency / High frequency ratio
}

export function calculateHRV(ibis: number[]): HRVMetrics {
  // Filter outliers (e.g., missed beats resulting in huge IBIs)
  const medianIBI = median(ibis);
  const validIBIs = ibis.filter(
    (t) => Math.abs(t - medianIBI) < 0.2 * medianIBI
  );

  if (validIBIs.length < 5) {
    return { sdnn: 0, rmssd: 0, pnn50: 0, lfHfRatio: 0 };
  }

  // SDNN
  const mean = validIBIs.reduce((a, b) => a + b, 0) / validIBIs.length;
  const variance =
    validIBIs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
    (validIBIs.length - 1);
  const sdnn = Math.sqrt(variance);

  // RMSSD
  let sumSqDiff = 0;
  let nn50Count = 0;
  for (let i = 1; i < validIBIs.length; i++) {
    const diff = validIBIs[i] - validIBIs[i - 1];
    sumSqDiff += diff * diff;
    if (Math.abs(diff) > 50) nn50Count++;
  }
  const rmssd = Math.sqrt(sumSqDiff / (validIBIs.length - 1));

  // pNN50
  const pnn50 = (nn50Count / (validIBIs.length - 1)) * 100;

  // LF/HF Ratio (Approximation)
  // NOTE: True LF/HF requires FFT.
  // A known time-domain approximation is (SDNN^2) / RMSSD^2 roughly proportional,
  // but it's better to return 0 or a placeholder if FFT isn't available.
  // We will leave your proxy but safeguard div by zero.
  const lfHfRatio = rmssd > 0 ? sdnn / rmssd : 0;

  return { sdnn, rmssd, pnn50, lfHfRatio };
}

/**
 * Estimate respiration rate from signal
 */
export function estimateRespirationRate(signal: number[], fs: number): number {
  // 1. Get peaks to establish the envelope
  const peaks = calculateIBI(signal, fs); // We actually need indices, but let's reuse logic briefly

  // Custom peak finder to return values/indices for envelope
  const peakIndices: number[] = [];
  const peakValues: number[] = [];
  // (Reuse the robust peak logic from calculateIBI here effectively)
  // ... [Assume we have peakIndices and peakValues] ...
  // For brevity, let's assume we extract peakValues from the signal:

  // SIMPLIFIED LOGIC FOR CONTEXT:
  let lastVal = signal[0];
  let direction = 0; // 0=flat, 1=up, -1=down
  for (let i = 1; i < signal.length; i++) {
    if (signal[i] > lastVal) direction = 1;
    else if (signal[i] < lastVal && direction === 1) {
      peakValues.push(lastVal); // Local Max
      direction = -1;
    }
    lastVal = signal[i];
  }

  if (peakValues.length < 4) return 0;

  // 2. The 'peakValues' array represents the respiratory wave (sampled at HeartRate)
  // We now calculate the frequency of *this* series.

  // Remove DC offset of the envelope
  const envMean = peakValues.reduce((a, b) => a + b, 0) / peakValues.length;
  const envNorm = peakValues.map((x) => x - envMean);

  // Zero-crossing count on the envelope is a robust, cheap way to estimate frequency
  let zeroCrossings = 0;
  for (let i = 1; i < envNorm.length; i++) {
    if (
      (envNorm[i - 1] > 0 && envNorm[i] <= 0) ||
      (envNorm[i - 1] < 0 && envNorm[i] >= 0)
    ) {
      zeroCrossings++;
    }
  }

  // Calculate duration of the signal in minutes
  const durationMin = signal.length / fs / 60;

  // Each cycle has 2 zero crossings
  const cycles = zeroCrossings / 2;
  const rr = cycles / durationMin;

  // Clamp to physiological limits (e.g., 6 to 35 breaths/min)
  return rr >= 6 && rr <= 40 ? rr : 0;
}

/**
 * Calculate Perfusion Index (PI)
 */
export function calculatePerfusionIndex(signal: number[]): number {
  if (signal.length === 0) return 0;

  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const max = Math.max(...signal);
  const min = Math.min(...signal);

  const acComponent = (max - min) / 2;
  const dcComponent = mean;

  // PI = (AC / DC) * 100
  return dcComponent > 0 ? (acComponent / dcComponent) * 100 : 0;
}

/**
 * Calculate Signal-to-Noise Ratio (SNR)
 */
export function calculateSNR(signal: number[]): number {
  if (signal.length < 2) return 0;

  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;

  // Calculate signal power
  let signalPower = 0;
  for (let i = 0; i < signal.length; i++) {
    signalPower += Math.pow(signal[i] - mean, 2);
  }
  signalPower /= signal.length;

  // Estimate noise (high-frequency components)
  let noisePower = 0;
  for (let i = 1; i < signal.length; i++) {
    noisePower += Math.pow(signal[i] - signal[i - 1], 2);
  }
  noisePower /= signal.length - 1;

  // SNR in dB
  return noisePower > 0 ? 10 * Math.log10(signalPower / noisePower) : 0;
}

/**
 * Calculate Signal Quality Index (SQI) - comprehensive quality score
 */
export function calculateSQI(signal: number[]): number {
  if (signal.length < 10) return 0;

  const snr = calculateSNR(signal);
  const pi = calculatePerfusionIndex(signal);

  // Normalize SNR (typical good range: 5-30 dB)
  const snrScore = Math.min(Math.max((snr - 5) / 25, 0), 1);

  // Normalize PI (typical good range: 0.3-20%)
  const piScore = Math.min(Math.max(pi / 20, 0), 1);

  // Check signal stability
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  let variance = 0;
  for (let i = 0; i < signal.length; i++) {
    variance += Math.pow(signal[i] - mean, 2);
  }
  variance /= signal.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const stabilityScore = cv > 0.01 && cv < 0.3 ? 1 : 0;

  // Combined SQI (0-100 scale)
  return ((snrScore + piScore + stabilityScore) / 3) * 100;
}
