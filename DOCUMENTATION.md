# PulseDetector — Fault-Tolerant Structures Analysis
### Technical Documentation | Heart Rate Detection via PPG

---

## Page 1 — Project Motivation and Scope

### 1.1 Why This Project

Cardiovascular disease remains the leading cause of death globally, yet continuous cardiac monitoring has historically required clinical-grade equipment — Holter monitors, ECG electrodes, or dedicated pulse oximeters. The ubiquity of smartphones with high-resolution cameras and LED flashes creates an opportunity to democratize a meaningful subset of that monitoring: resting heart rate measurement and, to a limited extent, heart rate variability (HRV) as a proxy for autonomic nervous system health.

The core insight behind this project is that the **photoplethysmography (PPG)** technique — long used in clinical pulse oximeters — can be reproduced with nothing more than a smartphone camera. When a finger is placed over the camera lens with the flash enabled, blood pulsing through the capillaries of the fingertip modulates the amount of red light that passes through the tissue. This optical signal, captured at 30 frames per second, is the raw material for heart rate estimation.

The motivation is threefold:

1. **Accessibility** — No wearable, no additional hardware, no subscription. Any smartphone user can perform a measurement.
2. **Longitudinal tracking** — Resting heart rate and HRV measured consistently over weeks correlate with training load, recovery, stress, and early illness. A simple mobile app makes this data collectible by anyone.
3. **Signal processing as the core challenge** — The problem is not the hardware; the phone's camera is more than capable. The challenge is extracting a clean physiological signal from a noisy optical channel and making the algorithm robust across the diversity of real-world conditions: different skin tones, movement artifacts, varying ambient temperatures, and the inherent variation in how people hold a phone.

### 1.2 What the App Measures

The app focuses on the **red light intensity** reflected from the fingertip. The choice of red channel is deliberate: oxygenated hemoglobin absorbs most strongly in the green spectrum, but the **DC modulation of the red channel** by pulsatile blood flow is the most stable signal on a typical mobile camera because:

- Red pixels have lower noise than green/blue at lower light levels.
- The flash LED has a broad warm-white spectrum well-represented in the red channel.
- Red penetrates deeper into tissue (~2 mm vs ~0.5 mm for green), averaging over more capillaries.

The final measurements stored are:
- **Heart Rate (BPM)** — primary output
- **SDNN** — standard deviation of normal-to-normal intervals; overall HRV
- **RMSSD** — root mean square of successive differences; parasympathetic tone
- **Respiratory Rate (br/min)** — derived from PPG amplitude modulation

---

## Page 2 — Signal Processing Pipeline

### 2.1 Raw Signal Acquisition

Every frame captured by `react-native-vision-camera` is passed through a worklet on the camera thread. To minimize CPU cost, the frame is immediately downscaled to **16 × 16 pixels** using the `vision-camera-resize-plugin`. The mean of all 256 red channel values yields a single scalar `avgRed` per frame — a point on the PPG time series.

This runs at **30 Hz**, matching the camera's target frame rate. The result is a 1-dimensional time series where values range from 0–255, representing average red intensity per frame.

```
avgRed[t] = mean( R channel of all 256 pixels at frame t )
```

### 2.2 Finger Detection State Machine

Before any signal processing, the component checks whether a finger is actually present. A two-threshold hysteresis scheme prevents rapid toggling:

- **Detected** when `avgRed > 80` (finger blocks ambient light, red from flash reflects strongly)
- **Lost** when `avgRed < 40` (ambient light floods the sensor)

The gap of 40 units between thresholds provides hysteresis stability. Without it, a finger placed at marginal angle would toggle the detector many times per second, resetting the buffer continuously.

### 2.3 Butterworth Bandpass Filter

Every incoming sample is passed through a **4th-order Butterworth bandpass filter** implemented as a cascade of two second-order sections (SOS), using the bilinear transform with frequency prewarping.

- **Lower cutoff:** 0.667 Hz → 40 BPM minimum
- **Upper cutoff:** 4.0 Hz → 240 BPM maximum

The filter operates in **Direct Form II** (transposed), updating two delay lines per section per sample — O(1) per frame. Butterworth was chosen because its maximally flat passband introduces no ripple in the cardiac frequency band, which matters because harmonic content of the PPG waveform at 2× and 3× the fundamental must be preserved accurately for the harmonic rejection logic to function correctly.

The filter is reset at the start of each measurement to avoid transient ringing contaminating the first few seconds of data.

### 2.4 Motion Artifact Rejection

After filtering, consecutive filtered values are compared. If the magnitude change between the latest sample and the previous one exceeds **10 intensity units**, the last 5 buffered samples are discarded and the frame is skipped:

```
if |filtered[t] - filtered[t-1]| > 10:
    discard last 5 samples
    skip this frame
```

This hard threshold assumes that real cardiac pulsation cannot change the average red intensity by more than 10 units between consecutive 33 ms frames. It is a simple but effective first-line defense against gross motion artifacts (e.g., finger lifting and re-placing).

### 2.5 Sliding Buffer

Valid filtered samples accumulate in a circular buffer of **270 samples = 9 seconds at 30 Hz**. Once full, it slides: the oldest sample is dropped and the new one is appended. Analysis runs on the full 270-sample window every 500 ms.

### 2.6 Preprocessing Before Spectral Analysis

Before each FFT or autocorrelation run, the buffered signal passes through two steps:

**Detrending** — A linear least-squares fit is computed on the signal and subtracted. This removes slow baseline drift (camera warming, gradual finger repositioning) without touching frequencies above ~0.1 Hz.

**Hann Window** — The detrended signal is multiplied element-wise by:

```
w[n] = 0.5 * (1 - cos(2πn / (N-1)))
```

This tapers the signal to zero at both ends, suppressing spectral leakage that would otherwise smear the cardiac peak across many frequency bins.

---

## Page 3 — Algorithm Design and Rationale

### 3.1 Method 1: FFT-Based Spectral Analysis

The detrended, windowed signal is zero-padded to the next power of 2 and transformed via a **Cooley-Tukey radix-2 FFT** (O(N log N)). The magnitude spectrum is searched in the physiological range 0.667–3.667 Hz (40–220 BPM).

The peak bin is further refined with **parabolic interpolation** on the three bins surrounding the maximum, achieving sub-bin frequency resolution without longer windows:

```
refinedIdx = peakIdx + (y₁ - y₃) / (2 * (y₁ - 2y₂ + y₃)) * 0.5
```

A **confidence gate** is applied: the peak power must exceed twice the average spectral power in the cardiac band. Below this threshold, the FFT estimate is rejected as too noisy.

**Harmonic rejection:** The code checks whether the power at twice the fundamental (2f₀) is at least 70% of the fundamental power. If so, the detected peak is likely the second harmonic and the true heart rate is f₀/2. This prevents the common PPG pitfall of estimating 120 BPM when the true rate is 60 BPM.

### 3.2 Method 2: Autocorrelation

Autocorrelation operates in the time domain: it computes how similar the signal is to a time-shifted copy of itself. For a periodic cardiac signal, the autocorrelation peaks at the lag equal to one heartbeat period.

The normalized autocorrelation is computed for lags spanning 40–220 BPM. The best lag is similarly refined with parabolic interpolation. Estimates are rejected if the peak correlation is below 0.3 (not periodic enough).

The autocorrelation method is complementary to FFT in two key ways:

- It is inherently robust to **non-stationarity** — it does not assume the signal is perfectly periodic across all 9 seconds, only that it is locally repetitive.
- Its **confidence is transparent** from the peak correlation value, making it easy to gate.

### 3.3 Why Both? The Ensemble Strategy

Neither method alone is reliable under all conditions. FFT is excellent for clean, stationary signals but can be misled by a strong low-frequency component or a single high-amplitude artifact. Autocorrelation handles non-stationarity well but requires a clearly periodic signal and is vulnerable to sub-harmonic aliasing.

The ensemble approach combines both with **differential confidence scoring**: the two estimates are compared, and the confidence is derived from their agreement:

| BPM Difference | Confidence | Interpretation |
|:-:|:-:|:-:|
| < 3 BPM | 0.95 | Strong agreement, high confidence |
| 3–6 BPM | 0.85 | Good agreement |
| 6–12 BPM | 0.65 | Moderate — usable but cautiously |
| > 12 BPM | 0.40 | Disagreement — potentially unreliable |

The final BPM is a weighted average (FFT weight 1.5, autocorrelation 1.2). FFT is slightly favoured because its frequency resolution after interpolation is typically higher with a long clean window. Estimates below confidence 0.4 are discarded entirely.

### 3.4 Temporal Smoothing

The component accumulates valid BPM estimates in a secondary buffer. The displayed value and final measurement use the **median of the last 5 estimates**. Median was chosen over mean because it is robust to the occasional outlier estimate that passes the 0.4 confidence threshold. If one estimate is 95 BPM while the surrounding four are all ~72 BPM, the median is 72; the mean would be distorted.

Measurement is automatically finalized after **12 consecutive valid estimates** (approximately 6 seconds of stable data past buffer fill), giving a total measurement time of roughly 15 seconds.

### 3.5 HRV Metrics

Inter-beat intervals are extracted by a simple **adaptive threshold peak detector** on the smoothed signal. The threshold is set at 50% of the signal range, and a minimum inter-peak distance of 250 ms (hard physiological limit at 240 BPM) prevents double-detection.

**SDNN** (total variability) and **RMSSD** (short-term parasympathetic variability) are computed from the validated IBI sequence after filtering out ectopic beats (IBIs more than 20% from the median).

### 3.6 Respiratory Rate

Breathing modulates the PPG waveform's amplitude at 0.1–0.667 Hz (6–40 br/min). The signal's low-frequency envelope is extracted with a 2-second moving average — slow enough to suppress the cardiac component (~1 Hz) while passing respiratory modulation — then processed through the same FFT pipeline as heart rate estimation.

---

## Page 4 — Known Limitations and Fault Scenarios

### 4.1 Skin Tone and Melanin Absorption

This is the most significant and systematically underaddressed limitation of red-channel PPG on mobile cameras.

**The problem:** Melanin absorbs broadly across the visible spectrum, including the red channel. In individuals with darker skin tones, more of the flash light is absorbed in the epidermis before reaching the vascular layer, reducing the AC amplitude of the PPG signal. The DC level of `avgRed` will be lower.

**Consequence in this implementation:** The finger detection threshold is `avgRed > 80`. On devices with certain camera sensors or with darker skin tones, a properly placed finger may produce `avgRed` values in the range 50–75 — well below the threshold. The measurement would never start.

Even if detection succeeds, the signal amplitude is lower, making it more likely to fail the signal quality check (`variance > 0.5`, `range > 1`) or for the FFT confidence to fall below the 2× noise floor requirement.

**What would help:** An adaptive detection threshold calibrated in the first 2 seconds, measuring the baseline `avgRed` without a finger and setting the detection threshold dynamically relative to that baseline, or normalizing by the DC component rather than using raw intensity.

### 4.2 Flash LED Thermal Drift

The LED flash heats up during continuous illumination. As the sensor warms, it changes its spectral response slightly and the LED output colour temperature drifts. This introduces a **slow rising baseline in `avgRed`** unrelated to blood flow.

The app includes a thermal compensation module (`thermalCompensation.ts`) using a two-timescale moving average difference (1-second vs 10-second windows) to subtract the drift. However, this system is **not wired into the main `HeartRateMonitor.tsx` flow** — the active component uses only the Butterworth filter and linear detrending. The `ThermalAwarePPGAnalyzer` class in `ppgAnalyzer.ts` is implemented but not invoked by the active UI.

As a result, measurements taken immediately after a previous measurement (when the flash is already warm) may produce systematically biased readings. The detrending step partially compensates, but only if the drift is linear within the 9-second window — it may not be, particularly in the first few seconds.

### 4.3 Motion and Pressure Artifacts

The hard-threshold motion rejection (`|Δfiltered| > 10`) is effective for gross movements but may let through:

- **Slow motion** — Gradual repositioning of the finger changes pressure on the capillaries over several seconds, causing a slow amplitude drift that is neither a single large jump nor cleanly addressed by detrending.
- **Respiratory motion** — Regular hand motion from breathing can alias into the cardiac band if large enough.
- **Micro-tremor** — Users with essential tremor or high physiological tremor produce high-frequency motion noise that passes the bandpass filter because tremor frequency (~4–10 Hz) partially overlaps the filter's upper cutoff at 4 Hz.

### 4.4 Ambient Light Contamination

The algorithm assumes only flash light reaches the sensor. In practice, if the finger does not fully cover the lens — especially with smaller phones or thicker fingers — ambient light leaks around the edges. Fluorescent and LED ambient lighting pulsates at 50 or 60 Hz (electrical grid frequency), which is well above the cardiac band and filtered out. However:

- Sunlight (direct outdoor use) contains no 50/60 Hz component but adds a large DC offset, potentially saturating the sensor.
- Flickering screens nearby can introduce periodic noise.
- The 16×16 downsampled average will be dominated by the bright saturated pixels at the edge leak, reducing signal modulation depth.

### 4.5 Limitations of the IBI/HRV Calculation

The adaptive threshold peak detector is a simple amplitude-based method. It will fail or produce clinically incorrect results in:

- **Low amplitude signals** — When signal amplitude is near the threshold, missed beats or phantom peaks produce artificially long or short IBIs.
- **Irregular rhythms** — Patients with atrial fibrillation, frequent premature contractions, or second-degree AV block will have IBI sequences that the ectopic beat filter (±20% from median) may over-aggressively clean, discarding real irregularity.
- **Short windows** — 9 seconds gives at most ~10–15 IBIs at a resting heart rate of 60–70 BPM. This is below the standard minimum of 300 seconds for SDNN to be clinically meaningful. The values shown are indicative only.

### 4.6 Respiratory Rate Reliability

The respiratory rate estimate requires at least 8 seconds of clean data and depends on RSA (respiratory sinus arrhythmia) — the heart rate modulation driven by breathing. This modulation:

- Decreases with age and cardiovascular disease.
- Is substantially suppressed during exercise or stress.
- Can be absent in some individuals regardless of health status.

The 1.5× confidence threshold for the respiratory FFT peak is relatively permissive. In practice, a large motion artifact in the low-frequency envelope could easily exceed this threshold and produce a plausible-looking but incorrect respiratory rate reading.

---

## Page 5 — Structural Weaknesses and Improvement Vectors

### 5.1 Summary of Fault Risk by Component

| Component | Risk Level | Main Failure Mode |
|:--|:--:|:--|
| Finger detection threshold | **High** | Fixed threshold fails for dark skin or dim flash |
| Butterworth filter transient | **Medium** | First ~0.5 s of data after detection is filtered incorrectly |
| Motion artifact rejection | **Medium** | Slow motion passes; high-frequency tremor passes filter edge |
| FFT harmonic rejection | **Medium** | 70% power heuristic can misfire on unusual waveform shapes |
| IBI peak detection | **High** | Amplitude threshold fails at low signal amplitude |
| HRV clinical validity | **High** | 9-second window too short for standard SDNN/RMSSD interpretation |
| Thermal compensation | **High** | Implemented but disconnected from the active measurement path |
| Respiratory rate estimate | **Medium** | RSA-dependent; fails when RSA is weak |
| Ensemble confidence gating | **Low** | Conservative thresholds generally work; may reject valid data in noisy users |

### 5.2 The Core Accuracy Problem: PPG Is Not ECG

The gold standard for all of SDNN, RMSSD, and accurate HRV analysis is the R–R interval derived from an ECG. PPG-derived IBIs (from peak detection on a smoothed optical waveform) are systematically noisier because:

1. The PPG peak is broader and less sharply defined than the ECG R-wave.
2. The PPG waveform shape changes with pulse pressure, vascular tone, and finger pressure.
3. Motion artifacts create false peaks that are amplitude-equivalent to real beats.

This means HRV metrics from this app should be interpreted as **trends**, not clinical values.

### 5.3 Cross-Device Variability

The camera sensor, lens aperture, flash power, and color filter array differ significantly between phone models. A threshold of `avgRed > 80` may work perfectly on an iPhone 14 but be too high or too low on a budget Android device with a different sensor. The app has no device-specific calibration layer.

Similarly, the Butterworth filter coefficients are hardcoded for 30 Hz. Many devices cannot sustain exactly 30 FPS under computational load, causing the actual sampling rate to vary between ~25 and 33 FPS. A variable sampling rate means the filter cutoffs drift from design values — the cardiac fundamental at 1 Hz (60 BPM) could be attenuated if the effective cutoff drifts below 1 Hz. The frame processor does not timestamp frames or compensate for variable framerate.

### 5.4 Thread and Timing Architecture

The frame processor runs in a **worklet** on the camera thread (VisionCamera's JS runtime). The result is handed off to the React JS thread via `Worklets.createRunOnJS`. This cross-thread call introduces variable latency: under load, the JS thread may be busy with a React re-render, causing the `processFrameData` call to be queued. If frames arrive faster than the JS thread processes them, calls stack up — effectively jittering the timing of the signal samples. This is not critical for the heart rate estimate (which uses a 9-second window) but could affect the IBI timing precision needed for accurate HRV.

### 5.5 What Would Make the App More Robust

1. **Adaptive finger detection**: Replace the fixed `avgRed > 80` threshold with a dynamic one based on the 2-second moving median of recent frames, detecting the step change caused by finger placement rather than an absolute intensity level. This would make detection work across all skin tones.

2. **Frame timestamping**: Use the frame's hardware timestamp instead of `Date.now()` to correct for variable frame intervals before buffering. This would fix the sampling rate assumption for Butterworth and FFT alike.

3. **Green channel cross-check**: The green channel shows stronger cardiac signal in lighter skin and cleaner SNR in well-lit conditions. A dual-channel approach — using red when green is saturated, green otherwise — would extend the working envelope.

4. **Activate thermal compensation**: Wire the existing `ThermalAwarePPGAnalyzer` into `HeartRateMonitor.tsx` to remove flash-induced baseline drift from consecutive measurements.

5. **Minimum IBI count enforcement**: Only display SDNN and RMSSD if at least 20 IBIs were detected, preventing clinically misleading values from 5-IBI estimates.

6. **Confidence-weighted display**: Rather than showing a single BPM value, show the BPM alongside the ensemble confidence tier (High / Medium / Low) so the user has context for measurement reliability.

---

*Documentation produced for PulseDetector v1.0 | Stack: React Native · Expo · VisionCamera · Supabase*
