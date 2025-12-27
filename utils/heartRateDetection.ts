export class ButterworthFilter {
  private readonly b = [0.0722, 0, -0.1444, 0, 0.0722];
  private readonly a = [1.0, -2.2872, 2.3805, -1.1895, 0.2782];

  private x = [0, 0, 0, 0, 0];
  private y = [0, 0, 0, 0, 0];

  constructor(fs: number) {}

  process(input: number): number {
    for (let i = 4; i > 0; i--) {
      this.x[i] = this.x[i - 1];
      this.y[i] = this.y[i - 1];
    }
    this.x[0] = input;

    this.y[0] =
      this.b[0] * this.x[0] +
      this.b[1] * this.x[1] +
      this.b[2] * this.x[2] +
      this.b[3] * this.x[3] +
      this.b[4] * this.x[4] -
      this.a[1] * this.y[1] -
      this.a[2] * this.y[2] -
      this.a[3] * this.y[3] -
      this.a[4] * this.y[4];

    return this.y[0];
  }

  reset() {
    this.x = [0, 0, 0, 0, 0];
    this.y = [0, 0, 0, 0, 0];
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
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const normalized = signal.map((x) => x - mean);

  let variance = 0;
  for (let i = 0; i < normalized.length; i++) {
    variance += normalized[i] * normalized[i];
  }

  if (variance < 1e-10) return 0;

  const minLag = Math.floor(fs * (60 / 180));
  const maxLag = Math.floor(fs * (60 / 50));

  const correlations: number[] = [];
  let maxCorr = -Infinity;
  let bestLagIndex = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const n = normalized.length - lag;

    for (let i = 0; i < n; i++) {
      sum += normalized[i] * normalized[i + lag];
    }

    const correlation = sum / variance;
    correlations.push(correlation);

    if (correlation > maxCorr) {
      maxCorr = correlation;
      bestLagIndex = lag - minLag;
    }
  }

  if (maxCorr < 0.15 || bestLagIndex === 0) {
    return 0;
  }

  const refinedLagOffset = refinePeak(correlations, bestLagIndex);
  const refinedLag = minLag + refinedLagOffset;

  const periodSeconds = refinedLag / fs;
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
