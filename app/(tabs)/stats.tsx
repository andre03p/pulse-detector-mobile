import { useAuth } from "@/context/AuthContext";
import { getHeartRateStats } from "@/lib/supabaseQueries";
import Foundation from "@expo/vector-icons/Foundation";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width } = Dimensions.get("window");

export default function Stats() {
  const { authState } = useAuth();
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);

  const [stats, setStats] = useState({
    avgBpm: 0,
    minBpm: 0,
    maxBpm: 0,
    totalReadings: 0,
    weeklyReadings: 0,
  });

  const loadStats = async () => {
    try {
      const { data, error } = await getHeartRateStats();

      if (error) {
        console.error("Error fetching stats:", error);
      } else if (data) {
        setStats(data);
      }
    } catch (error) {
      console.error("Error loading stats:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, []),
  );

  const handleHeartRate = () => {
    if (stats.avgBpm < 60) {
      return "Your average heart rate is quite low, indicating good cardiovascular fitness.";
    } else if (stats.avgBpm <= 100) {
      return "Your average heart rate is within the normal resting range.";
    } else if (stats.avgBpm <= 130) {
      return "Your average heart rate suggests light to moderate activity levels.";
    } else if (stats.avgBpm <= 150) {
      return "Your average heart rate indicates moderate to high activity levels.";
    } else {
      return "Your average heart rate is quite high; consider consulting a healthcare professional.";
    }
  };

  const handleReadingsConsistency = () => {
    if (stats.weeklyReadings >= 5) {
      return "Great job! You're consistently monitoring your heart rate.";
    } else if (stats.weeklyReadings >= 3) {
      return "Good effort! Try to monitor your heart rate a bit more regularly.";
    } else {
      return "Consider monitoring your heart rate more frequently for better insights.";
    }
  };

  const footerHeight = 80 + (insets.bottom || 12);

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <ActivityIndicator size="large" color="#748cab" />
        <Text style={styles.loadingText}>Loading statistics...</Text>
      </View>
    );
  }

  const bpmZones = [
    { label: "Below 60", description: "Resting (Athletic)", color: "#748cab" },
    { label: "60 - 100", description: "Resting (Normal)", color: "#3e5c76" },
    {
      label: "100 - 130",
      description: "Warm Up / Light Effort",
      color: "#4caf50",
    },
    {
      label: "130 - 150",
      description: "Fat Burn / Moderate",
      color: "#fbc02d",
    },
    { label: "150 - 170", description: "Cardio / Hard", color: "#f57c00" },
    { label: "170+", description: "Peak / Max Effort", color: "#d32f2f" },
  ];

  return (
    <ScrollView style={[styles.container, { paddingBottom: footerHeight }]}>
      <LinearGradient
        colors={["#0d1321", "#1d2d44"]}
        style={[styles.header, { paddingTop: insets.top + 16 }]}
      >
        <View style={styles.headerContent}>
          <Ionicons name="stats-chart" size={28} color="#f0ebd8" />
          <Text style={styles.title}>Statistics</Text>
        </View>
        <Text style={styles.subtitle}>Your heart health overview</Text>
      </LinearGradient>

      <View style={[styles.content, { paddingBottom: footerHeight }]}>
        {/* Main Stats Card */}
        <LinearGradient
          colors={["#3e5c76", "#1d2d44"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.mainCard}
        >
          <Text style={styles.cardTitle}>Average Heart Rate</Text>
          <View style={styles.mainStatContainer}>
            <Text style={styles.mainStatValue}>{stats.avgBpm}</Text>
            <Text style={styles.mainStatLabel}>BPM</Text>
          </View>
          <View style={styles.rangeContainer}>
            <View style={styles.rangeItem}>
              <Text style={styles.rangeValue}>↓ {stats.minBpm}</Text>
              <Text style={styles.rangeLabel}>Lowest</Text>
            </View>
            <View style={styles.rangeDivider} />
            <View style={styles.rangeItem}>
              <Text style={styles.rangeValue}>↑ {stats.maxBpm}</Text>
              <Text style={styles.rangeLabel}>Highest</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Grid Stats */}
        <View style={styles.gridContainer}>
          <View style={styles.gridCard}>
            <Ionicons name="stats-chart-outline" size={24} color="#f0ebd8" />
            <Text style={styles.gridValue}>{stats.totalReadings}</Text>
            <Text style={styles.gridLabel}>Total Readings</Text>
          </View>

          <View style={styles.gridCard}>
            <Ionicons name="calendar" size={24} color="#f0ebd8" />
            <Text style={styles.gridValue}>{stats.weeklyReadings}</Text>
            <Text style={styles.gridLabel}>This Week</Text>
          </View>
        </View>

        {/* Insights Card */}
        <View style={styles.insightsCard}>
          <Text style={styles.insightsTitle}>
            <Foundation name="lightbulb" size={20} color="#f0ebd8" />
            Insights
          </Text>
          <View style={styles.insightItem}>
            <View style={styles.insightDot} />
            <Text style={styles.insightText}>{handleHeartRate()}</Text>
          </View>
          <View style={styles.insightItem}>
            <View style={styles.insightDot} />
            <Text style={styles.insightText}>
              {handleReadingsConsistency()}
            </Text>
          </View>
          <View style={styles.insightItem}>
            <View style={styles.insightDot} />
            <Text style={styles.insightText}>
              Keep tracking regularly for better health insights
            </Text>
          </View>
        </View>

        {/* Health Ranges Info */}
        <View>
          <LinearGradient
            colors={["#3e5c76", "#1d2d44"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.infoCard}
          >
            <Text style={styles.infoTitle}>Heart Rate Zones</Text>
            <Text style={styles.infoSubtitle}>Resting vs. Active Levels</Text>

            {bpmZones.map((zone, index) => (
              <View key={index} style={styles.infoRow}>
                <View style={styles.leftContainer}>
                  <View
                    style={[
                      styles.infoIndicator,
                      { backgroundColor: zone.color },
                    ]}
                  />
                  <Text style={styles.rangeText}>{zone.label}</Text>
                </View>
                <Text style={styles.descText}>{zone.description}</Text>
              </View>
            ))}
          </LinearGradient>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050000",
    paddingBottom: 80,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#f0ebd8",
  },
  subtitle: {
    fontSize: 14,
    color: "#748cab",
    textAlign: "center",
  },
  content: {
    padding: 16,
  },
  mainCard: {
    backgroundColor: "#3e5c76",
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    shadowColor: "#0d1321",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  cardTitle: {
    fontSize: 16,
    color: "#f0ebd8",
    marginBottom: 16,
    opacity: 0.9,
  },
  mainStatContainer: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 20,
  },
  mainStatValue: {
    fontSize: 56,
    fontWeight: "bold",
    color: "#f0ebd8",
  },
  mainStatLabel: {
    fontSize: 20,
    color: "#f0ebd8",
    marginLeft: 8,
    opacity: 0.9,
  },
  rangeContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "rgba(240, 235, 216, 0.3)",
  },
  rangeItem: {
    alignItems: "center",
  },
  rangeDivider: {
    width: 1,
    backgroundColor: "rgba(240, 235, 216, 0.3)",
  },
  rangeValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 4,
  },
  rangeLabel: {
    fontSize: 12,
    color: "#f0ebd8",
    opacity: 0.8,
  },
  gridContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  gridCard: {
    backgroundColor: "#0d1321",
    borderRadius: 12,
    padding: 20,
    width: (width - 48) / 2,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3e5c76",
  },
  gridIcon: {
    fontSize: 32,
    marginBottom: 12,
  },
  gridValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 4,
  },
  gridLabel: {
    fontSize: 12,
    color: "#748cab",
    textAlign: "center",
  },
  insightsCard: {
    backgroundColor: "#0d1321",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#3e5c76",
  },
  insightsTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 16,
  },
  insightItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  insightDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#3e5c76",
    marginTop: 6,
    marginRight: 12,
  },
  insightText: {
    flex: 1,
    fontSize: 14,
    color: "#f0ebd8",
    lineHeight: 20,
  },
  infoText: {
    fontSize: 14,
    color: "#f0ebd8",
  },
  infoCard: {
    borderRadius: 16,
    padding: 20,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0e0101ff",
    marginBottom: 4,
  },
  infoSubtitle: {
    fontSize: 14,
    color: "#848181ff",
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  leftContainer: {
    flexDirection: "row",
    alignItems: "center",
    width: 100,
  },
  infoIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  rangeText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fbf7f7ff",
  },
  descText: {
    fontSize: 14,
    color: "#fbf7f7ff",
    flex: 1,
    textAlign: "right",
  },
  loadingText: {
    fontSize: 16,
    color: "#748cab",
    marginTop: 16,
  },
});
