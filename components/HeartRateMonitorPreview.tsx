import Entypo from "@expo/vector-icons/Entypo";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// Mock component for Expo Go - shows UI without camera functionality
export default function HeartRateMonitorPreview() {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [currentBPM, setCurrentBPM] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [fingerDetected, setFingerDetected] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (fingerDetected && currentBPM) {
      const interval = 60000 / currentBPM;
      const pulse = Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: interval / 3,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: interval / 3,
          useNativeDriver: true,
        }),
      ]);
      Animated.loop(pulse).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [fingerDetected, currentBPM]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: isMonitoring ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isMonitoring]);

  // Mock monitoring simulation
  const startMonitoring = () => {
    setIsMonitoring(true);
    setFingerDetected(false);
    setProgress(0);
    setCurrentBPM(null);

    // Simulate finger detection after 1 second
    setTimeout(() => {
      setFingerDetected(true);
      simulateHeartRateReading();
    }, 1000);
  };

  const simulateHeartRateReading = () => {
    let progressValue = 0;
    const interval = setInterval(() => {
      progressValue += 0.01;
      setProgress(progressValue);

      // Simulate random BPM between 60-80
      const mockBPM = Math.floor(Math.random() * 20) + 60;
      setCurrentBPM(mockBPM);

      if (progressValue >= 1) {
        clearInterval(interval);
        // Final reading
        setCurrentBPM(72);
      }
    }, 100);
  };

  const stopMonitoring = () => {
    setIsMonitoring(false);
    setFingerDetected(false);
    setProgress(0);
  };

  const resetMeasurement = () => {
    setCurrentBPM(null);
    setProgress(0);
    startMonitoring();
  };

  return (
    <View style={styles.container}>
      {/* Preview mode banner */}
      <View style={styles.previewBanner}>
        <Text style={styles.previewText}>
          📱 Expo Go Preview Mode - Camera not available
        </Text>
      </View>

      <View style={styles.monitorContainer}>
        {!isMonitoring ? (
          <View style={styles.instructionsContainer}>
            <Entypo name="info" size={48} color="#748cab" />
            <Text style={styles.instructionsTitle}>How to measure</Text>
            <Text style={styles.instructionsText}>
              1. Tap the Start button below{"\n"}
              2. Place your fingertip over the back camera{"\n"}
              3. Cover the camera and flash completely{"\n"}
              4. Hold still for 6 seconds{"\n"}
              5. Keep your finger steady until complete
            </Text>
            <TouchableOpacity onPress={startMonitoring}>
              <LinearGradient
                colors={["#3e5c76", "#748cab"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.startButton}
              >
                <Text style={styles.startButtonText}>Start Measuring</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <Animated.View
            style={[styles.measurementContainer, { opacity: fadeAnim }]}
          >
            {/* Status Section */}
            <View style={styles.statusSection}>
              <View style={styles.statusCard}>
                {fingerDetected ? (
                  <>
                    <Entypo name="check" size={32} color="#4ade80" />
                    <Text style={styles.statusText}>Finger Detected</Text>
                    <Text style={styles.statusSubtext}>Keep still...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="finger-print" size={32} color="#fbbf24" />
                    <Text style={styles.statusText}>Place Finger</Text>
                    <Text style={styles.statusSubtext}>
                      Cover camera & flash
                    </Text>
                  </>
                )}
              </View>
            </View>

            {/* Progress Bar */}
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View
                  style={[styles.progressFill, { width: `${progress * 100}%` }]}
                />
              </View>
              <Text style={styles.progressText}>
                {Math.round(progress * 100)}%
              </Text>
            </View>

            {/* Heart Rate Display */}
            <View style={styles.bpmContainer}>
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <Entypo name="heart" size={60} color="#f87171" />
              </Animated.View>
              <Text style={styles.bpmValue}>
                {currentBPM !== null ? currentBPM : "--"}
              </Text>
              <Text style={styles.bpmLabel}>BPM</Text>
            </View>

            {/* Mock Advanced Metrics */}
            {progress >= 1 && (
              <ScrollView style={styles.metricsScroll}>
                <View style={styles.metricsContainer}>
                  <Text style={styles.metricsTitle}>Advanced Metrics</Text>

                  <View style={styles.metricRow}>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>IBI</Text>
                      <Text style={styles.metricValue}>833ms</Text>
                      <Text style={styles.metricDescription}>
                        Inter-Beat Interval
                      </Text>
                    </View>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>HRV</Text>
                      <Text style={styles.metricValue}>45ms</Text>
                      <Text style={styles.metricDescription}>
                        Heart Rate Variability
                      </Text>
                    </View>
                  </View>

                  <View style={styles.metricRow}>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>RR</Text>
                      <Text style={styles.metricValue}>16</Text>
                      <Text style={styles.metricDescription}>
                        Respiration Rate
                      </Text>
                    </View>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>PI</Text>
                      <Text style={styles.metricValue}>5.2%</Text>
                      <Text style={styles.metricDescription}>
                        Perfusion Index
                      </Text>
                    </View>
                  </View>

                  <View style={styles.metricRow}>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>SNR</Text>
                      <Text style={styles.metricValue}>12.5dB</Text>
                      <Text style={styles.metricDescription}>
                        Signal-to-Noise
                      </Text>
                    </View>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>SQI</Text>
                      <Text style={styles.metricValue}>85%</Text>
                      <Text style={styles.metricDescription}>
                        Signal Quality
                      </Text>
                    </View>
                  </View>
                </View>
              </ScrollView>
            )}

            {/* Action Buttons */}
            <View style={styles.buttonContainer}>
              {progress >= 1 ? (
                <>
                  <TouchableOpacity
                    onPress={resetMeasurement}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryButtonText}>
                      Measure Again
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={stopMonitoring}
                    style={styles.primaryButton}
                  >
                    <LinearGradient
                      colors={["#3e5c76", "#748cab"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.gradientButton}
                    >
                      <Text style={styles.primaryButtonText}>Save & Close</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  onPress={stopMonitoring}
                  style={styles.cancelButton}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1d2d44",
  },
  previewBanner: {
    backgroundColor: "#fbbf24",
    padding: 12,
    alignItems: "center",
  },
  previewText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "600",
  },
  monitorContainer: {
    flex: 1,
    padding: 20,
  },
  instructionsContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  instructionsTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginTop: 20,
    marginBottom: 12,
  },
  instructionsText: {
    fontSize: 16,
    color: "#748cab",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
  },
  startButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
  },
  startButtonText: {
    color: "#f0ebd8",
    fontSize: 18,
    fontWeight: "bold",
  },
  measurementContainer: {
    flex: 1,
  },
  statusSection: {
    alignItems: "center",
    marginBottom: 20,
  },
  statusCard: {
    backgroundColor: "#0d1321",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#3e5c76",
    minWidth: 200,
  },
  statusText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginTop: 8,
  },
  statusSubtext: {
    fontSize: 14,
    color: "#748cab",
    marginTop: 4,
  },
  progressContainer: {
    marginBottom: 30,
  },
  progressBar: {
    height: 8,
    backgroundColor: "#0d1321",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#748cab",
  },
  progressText: {
    textAlign: "center",
    color: "#748cab",
    fontSize: 14,
  },
  bpmContainer: {
    alignItems: "center",
    marginVertical: 30,
  },
  bpmValue: {
    fontSize: 72,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginTop: 16,
  },
  bpmLabel: {
    fontSize: 24,
    color: "#748cab",
    marginTop: 8,
  },
  metricsScroll: {
    maxHeight: 300,
  },
  metricsContainer: {
    backgroundColor: "#0d1321",
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: "#3e5c76",
    marginBottom: 20,
  },
  metricsTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 16,
  },
  metricRow: {
    flexDirection: "row",
    marginBottom: 16,
  },
  metricItem: {
    flex: 1,
    alignItems: "center",
  },
  metricLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#748cab",
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 4,
  },
  metricDescription: {
    fontSize: 12,
    color: "#748cab",
    textAlign: "center",
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  primaryButton: {
    flex: 1,
  },
  gradientButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#f0ebd8",
    fontSize: 16,
    fontWeight: "bold",
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: "#0d1321",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#3e5c76",
  },
  secondaryButtonText: {
    color: "#748cab",
    fontSize: 16,
    fontWeight: "bold",
  },
  cancelButton: {
    backgroundColor: "#0d1321",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#3e5c76",
  },
  cancelButtonText: {
    color: "#748cab",
    fontSize: 16,
    fontWeight: "bold",
  },
});
