// Heart Rate Detection Utilities
// Based on photoplethysmography (PPG) principles

export class BandPassFilter {
  // Simple Moving Average based Bandpass Filter
  // High Pass: Remove DC component (slow changes)
  // Low Pass: Remove high frequency noise
  private history: number[] = [];
  private readonly historySize = 30; // 1 second at 30fps

  processValue(value: number): number {
    this.history.push(value);
    if (this.history.length > this.historySize) {
      this.history.shift();
    }

    // Calculate DC component (average of last 1 second)
    const dc = this.history.reduce((a, b) => a + b, 0) / this.history.length;

    // AC component = Value - DC
    // Invert because higher blood volume = lower light intensity (absorption)
    // But we want a positive peak for a heartbeat.
    // So: (DC - Value) or -(Value - DC)
    return dc - value;
  }

  reset() {
    this.history = [];
  }
}

export class PulseDetector {
  private lastPeakTime = 0;
  private intervals: number[] = [];
  private readonly maxIntervals = 10;
  private lastVal = 0;
  private currentTrend = 0; // 1 for up, -1 for down
  private threshold = 0;
  private signalHistory: number[] = [];
  private readonly signalHistorySize = 30; // 1 second

  addNewValue(newVal: number, time: number): number {
    // Keep a short history to determine dynamic threshold
    this.signalHistory.push(Math.abs(newVal));
    if (this.signalHistory.length > this.signalHistorySize) {
      this.signalHistory.shift();
    }

    // Dynamic threshold: 50% of max amplitude in recent history
    const maxAmp = Math.max(...this.signalHistory);
    this.threshold = maxAmp * 0.4;

    // Peak detection logic
    // We look for a local maximum that is above the threshold
    let isPeak = false;

    if (newVal > this.lastVal && newVal > this.threshold) {
      this.currentTrend = 1; // Going up
    } else if (newVal < this.lastVal && this.currentTrend === 1) {
      // Was going up, now going down -> Peak
      if (this.lastVal > this.threshold) {
        isPeak = true;
      }
      this.currentTrend = -1; // Going down
    }

    this.lastVal = newVal;

    if (isPeak) {
      const now = time;
      if (this.lastPeakTime > 0) {
        const interval = now - this.lastPeakTime;
        // Filter invalid intervals (40-220 BPM => 0.27s - 1.5s)
        if (interval > 0.27 && interval < 1.5) {
          this.intervals.push(interval);
          if (this.intervals.length > this.maxIntervals) {
            this.intervals.shift();
          }
        }
      }
      this.lastPeakTime = now;
      return 1; // Signal a peak
    }

    return 0;
  }

  getAverage(): number {
    if (this.intervals.length < 3) return -1;

    // Calculate average interval
    const sum = this.intervals.reduce((a, b) => a + b, 0);
    const avgInterval = sum / this.intervals.length;

    return avgInterval;
  }

  reset() {
    this.lastPeakTime = 0;
    this.intervals = [];
    this.lastVal = 0;
    this.currentTrend = 0;
    this.signalHistory = [];
  }
}

// Convert RGB to HSV color space
export function rgbToHsv(
  r: number,
  g: number,
  b: number
): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  let h = 0;
  const s = max === 0 ? 0 : diff / max;
  const v = max;

  if (diff !== 0) {
    if (max === r) {
      h = ((g - b) / diff + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      h = ((b - r) / diff + 2) / 6;
    } else {
      h = ((r - g) / diff + 4) / 6;
    }
  }

  return { h, s, v };
}

// Calculate average color from image data
export function calculateAverageColor(
  imageData: Uint8Array,
  width: number,
  height: number
): { r: number; g: number; b: number } {
  let r = 0,
    g = 0,
    b = 0;
  const pixels = width * height;

  for (let i = 0; i < pixels * 4; i += 4) {
    r += imageData[i];
    g += imageData[i + 1];
    b += imageData[i + 2];
  }

  return {
    r: r / pixels,
    g: g / pixels,
    b: b / pixels,
  };
}
