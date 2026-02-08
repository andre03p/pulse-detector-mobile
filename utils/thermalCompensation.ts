// ============================================================================
// THERMAL DRIFT COMPENSATION FOR CAMERA-BASED PPG
// Mobile-optimized version for React Native
// ============================================================================

/**
 * Thermal effects on PPG measurements:
 *
 * 1. SENSOR HEATING:
 *    - Dark current increases → baseline drift (upward)
 *    - Thermal noise increases → lower SNR
 *    - Typical: +0.5-2°C after 30-60s of continuous flash
 *
 * 2. FLASH/LED HEATING:
 *    - LED efficiency decreases → light output drops
 *    - Typical: -5-15% output after 30s
 *
 * 3. SKIN HEATING:
 *    - Vasodilation → increased perfusion (good)
 *    - But: can cause motion as user becomes uncomfortable
 *    - Typical: +2-5°C local skin temperature
 */

export interface ThermalState {
  driftRate: number; // pixels/second baseline drift
  estimatedTemperature: number; // °C above ambient (estimated)
  heatingTime: number; // seconds since start
  isDrifting: boolean; // significant drift detected
  recommendation: string; // user guidance
}

export class ThermalDriftDetector {
  private baselineHistory: number[] = [];
  private timestamps: number[] = [];
  private startTime: number;
  private readonly maxHistory = 100;

  constructor() {
    this.startTime = Date.now();
  }

  update(dcComponent: number): ThermalState {
    const now = Date.now();
    this.timestamps.push(now);
    this.baselineHistory.push(dcComponent);

    // Maintain sliding window
    if (this.baselineHistory.length > this.maxHistory) {
      this.baselineHistory.shift();
      this.timestamps.shift();
    }

    const heatingTime = (now - this.startTime) / 1000;

    if (this.baselineHistory.length < 10) {
      return {
        driftRate: 0,
        estimatedTemperature: 0,
        heatingTime,
        isDrifting: false,
        recommendation: "Warming up...",
      };
    }

    const driftRate = this.calculateDriftRate();
    const estimatedTempRise = this.estimateTemperatureRise(heatingTime);
    const isDrifting = Math.abs(driftRate) > 0.5;

    let recommendation = "";
    if (heatingTime < 10) {
      recommendation = "Measurement starting...";
    } else if (heatingTime > 45 && estimatedTempRise > 3) {
      recommendation = "Camera heating - consider pausing to cool down";
    } else if (isDrifting && driftRate > 2) {
      recommendation = "Significant thermal drift detected";
    } else if (heatingTime > 20 && heatingTime < 40) {
      recommendation = "Optimal measurement window";
    } else {
      recommendation = "Measuring...";
    }

    return {
      driftRate,
      estimatedTemperature: estimatedTempRise,
      heatingTime,
      isDrifting,
      recommendation,
    };
  }

  private calculateDriftRate(): number {
    const n = this.baselineHistory.length;
    if (n < 2) return 0;

    const timeSeconds = this.timestamps.map(
      (t) => (t - this.timestamps[0]) / 1000,
    );

    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += timeSeconds[i];
      sumY += this.baselineHistory[i];
      sumXY += timeSeconds[i] * this.baselineHistory[i];
      sumX2 += timeSeconds[i] * timeSeconds[i];
    }

    const denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return 0;

    return (n * sumXY - sumX * sumY) / denom;
  }

  private estimateTemperatureRise(timeSeconds: number): number {
    const tauHeat = 20;
    const maxRise = 3.5;
    return maxRise * (1 - Math.exp(-timeSeconds / tauHeat));
  }

  reset() {
    this.baselineHistory = [];
    this.timestamps = [];
    this.startTime = Date.now();
  }
}

export class AdaptiveThermalCompensator {
  private driftDetector: ThermalDriftDetector;
  private compensationEnabled: boolean = true;

  private readonly shortWindowSize = 30; // ~1 second at 30fps
  private readonly longWindowSize = 300; // ~10 seconds at 30fps

  constructor() {
    this.driftDetector = new ThermalDriftDetector();
  }

  process(signal: number[]): {
    compensated: number[];
    thermalState: ThermalState;
  } {
    if (signal.length === 0) {
      return {
        compensated: [],
        thermalState: {
          driftRate: 0,
          estimatedTemperature: 0,
          heatingTime: 0,
          isDrifting: false,
          recommendation: "No data",
        },
      };
    }

    const dcComponent = signal.reduce((a, b) => a + b, 0) / signal.length;
    const thermalState = this.driftDetector.update(dcComponent);

    let compensated = signal;

    if (this.compensationEnabled && thermalState.isDrifting) {
      compensated = this.compensateDrift(signal, thermalState);
    }

    return { compensated, thermalState };
  }

  private compensateDrift(signal: number[], state: ThermalState): number[] {
    const n = signal.length;
    if (n < this.shortWindowSize) return signal;

    const compensated: number[] = [];

    for (let i = 0; i < n; i++) {
      const shortStart = Math.max(0, i - Math.floor(this.shortWindowSize / 2));
      const shortEnd = Math.min(
        n,
        i + Math.floor(this.shortWindowSize / 2) + 1,
      );
      let shortSum = 0;
      for (let j = shortStart; j < shortEnd; j++) {
        shortSum += signal[j];
      }
      const shortMA = shortSum / (shortEnd - shortStart);

      const longStart = Math.max(0, i - Math.floor(this.longWindowSize / 2));
      const longEnd = Math.min(n, i + Math.floor(this.longWindowSize / 2) + 1);
      let longSum = 0;
      for (let j = longStart; j < longEnd; j++) {
        longSum += signal[j];
      }
      const longMA = longSum / (longEnd - longStart);

      const driftEstimate = longMA - shortMA;
      compensated.push(signal[i] - driftEstimate);
    }

    return compensated;
  }

  enableCompensation(enable: boolean) {
    this.compensationEnabled = enable;
  }

  reset() {
    this.driftDetector.reset();
  }
}

export class ThermalAwareMeasurementScheduler {
  private lastMeasurementEndTime: number = 0;
  private readonly minCooldownTime = 30;
  private readonly idealCooldownTime = 60;

  canStartMeasurement(): {
    canStart: boolean;
    cooldownRemaining: number;
    recommendation: string;
  } {
    if (this.lastMeasurementEndTime === 0) {
      return {
        canStart: true,
        cooldownRemaining: 0,
        recommendation: "Ready to start measurement",
      };
    }

    const timeSinceLastMeasurement =
      (Date.now() - this.lastMeasurementEndTime) / 1000;

    if (timeSinceLastMeasurement >= this.idealCooldownTime) {
      return {
        canStart: true,
        cooldownRemaining: 0,
        recommendation: "Fully cooled - optimal conditions",
      };
    }

    if (timeSinceLastMeasurement >= this.minCooldownTime) {
      const remaining = Math.ceil(
        this.idealCooldownTime - timeSinceLastMeasurement,
      );
      return {
        canStart: true,
        cooldownRemaining: 0,
        recommendation: `Can start, but waiting ${remaining}s more would be ideal`,
      };
    }

    const remaining = Math.ceil(
      this.minCooldownTime - timeSinceLastMeasurement,
    );
    return {
      canStart: false,
      cooldownRemaining: remaining,
      recommendation: `Please wait ${remaining}s for camera to cool`,
    };
  }

  recordMeasurementEnd() {
    this.lastMeasurementEndTime = Date.now();
  }

  reset() {
    this.lastMeasurementEndTime = 0;
  }
}

export class FlashIntensityMonitor {
  private initialIntensity: number | null = null;
  private currentIntensity: number = 0;
  private readonly decayRate = 0.01;

  update(
    measuredIntensity: number,
    elapsedSeconds: number,
  ): {
    intensityDrop: number;
    isSignificant: boolean;
    compensation: number;
  } {
    if (this.initialIntensity === null) {
      this.initialIntensity = measuredIntensity;
    }

    this.currentIntensity = measuredIntensity;

    const expectedDrop = this.decayRate * elapsedSeconds * 100;
    const actualDrop =
      ((this.initialIntensity - this.currentIntensity) /
        this.initialIntensity) *
      100;
    const compensation = this.initialIntensity / this.currentIntensity;

    return {
      intensityDrop: Math.max(0, actualDrop),
      isSignificant: actualDrop > 10,
      compensation: compensation,
    };
  }

  reset() {
    this.initialIntensity = null;
    this.currentIntensity = 0;
  }
}
