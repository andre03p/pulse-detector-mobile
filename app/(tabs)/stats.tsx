import WeeklyBpmChart from "@/components/WeeklyBpmChart";
import { useAuth } from "@/context/AuthContext";
import {
  getHeartRateStats,
  getWeeklyHeartRateSeries,
} from "@/lib/supabaseQueries";
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
  const [weeklySeries, setWeeklySeries] = useState<
    { day: string; avg: number; count: number }[]
  >([]);

  const loadStats = async () => {
    try {
      const [{ data, error }, weekly] = await Promise.all([
        getHeartRateStats(),
        getWeeklyHeartRateSeries(),
      ]);

      if (!error && data) setStats(data);
      if (!weekly.error && weekly.data) setWeeklySeries(weekly.data);
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

  return (
    <ScrollView style={[styles.container, { paddingBottom: footerHeight }]}>
      <LinearGradient
        colors={["#0d1321", "#1d2d44", "#3e5c76"]}
        style={[styles.header, { paddingTop: insets.top + 16 }]}
      >
        <View style={styles.headerContent}>
          <Ionicons name="stats-chart" size={28} color="#f0ebd8" />
          <Text style={styles.title}>Statistics</Text>
        </View>
        <Text style={styles.subtitle}>Your heart rate overview</Text>
      </LinearGradient>

      <View style={[styles.content, { paddingBottom: footerHeight }]}>
        {/* Main Stats Card */}
        <View style={styles.mainCard}>
          <Text style={styles.cardTitle}>Average Heart Rate</Text>
          <View style={styles.mainStatContainer}>
            <Text style={styles.mainStatValue}>{stats.avgBpm}</Text>
            <Text style={styles.mainStatLabel}>BPM</Text>
          </View>
          <View style={styles.rangeContainer}>
            <View style={styles.rangeItem}>
              <Text style={styles.rangeValue}>{stats.minBpm}</Text>
              <Text style={styles.rangeLabel}>Min</Text>
            </View>
            <View style={styles.rangeDivider} />
            <View style={styles.rangeItem}>
              <Text style={styles.rangeValue}>{stats.maxBpm}</Text>
              <Text style={styles.rangeLabel}>Max</Text>
            </View>
          </View>
        </View>

        {/* Quick Info Grid */}
        <View style={styles.gridContainer}>
          <View style={styles.gridCard}>
            <Ionicons name="calendar" size={32} color="#748cab" />
            <Text style={styles.gridValue}>{stats.weeklyReadings}</Text>
            <Text style={styles.gridLabel}>This Week</Text>
          </View>
          <View style={styles.gridCard}>
            <Ionicons name="stats-chart" size={32} color="#748cab" />
            <Text style={styles.gridValue}>{stats.totalReadings}</Text>
            <Text style={styles.gridLabel}>Total Readings</Text>
          </View>
        </View>

        {/* Weekly Chart */}
        {weeklySeries.length > 0 && (
          <View style={styles.chartCard}>
            <Text style={styles.cardTitle}>Weekly Trend</Text>
            <WeeklyBpmChart data={weeklySeries} />
          </View>
        )}

        {/* Heart Rate Zones */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Heart Rate Zones</Text>
          <Text style={styles.infoSubtitle}>Understanding your numbers</Text>
          <View style={styles.zonesContainer}>
            <View style={styles.infoRow}>
              <View style={styles.leftContainer}>
                <View
                  style={[styles.infoIndicator, { backgroundColor: "#4CAF50" }]}
                />
                <Text style={styles.rangeText}>60-100</Text>
              </View>
              <Text style={styles.descText}>Normal resting</Text>
            </View>
            <View style={styles.infoRow}>
              <View style={styles.leftContainer}>
                <View
                  style={[styles.infoIndicator, { backgroundColor: "#2196F3" }]}
                />
                <Text style={styles.rangeText}>&lt; 60</Text>
              </View>
              <Text style={styles.descText}>Athletic</Text>
            </View>
            <View style={styles.infoRow}>
              <View style={styles.leftContainer}>
                <View
                  style={[styles.infoIndicator, { backgroundColor: "#FF9800" }]}
                />
                <Text style={styles.rangeText}>100-130</Text>
              </View>
              <Text style={styles.descText}>Elevated</Text>
            </View>
            <View style={styles.infoRow}>
              <View style={styles.leftContainer}>
                <View
                  style={[styles.infoIndicator, { backgroundColor: "#F44336" }]}
                />
                <Text style={styles.rangeText}>130+</Text>
              </View>
              <Text style={styles.descText}>High</Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050000",
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: "#f0ebd8",
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 15,
    color: "#b8c5d6",
    textAlign: "center",
    fontWeight: "500",
  },
  content: {
    padding: 16,
  },
  mainCard: {
    backgroundColor: "#0d1321",
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    shadowColor: "#3e5c76",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    borderWidth: 1,
    borderColor: "#3e5c76",
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
    backgroundColor: "#050000",
    borderRadius: 12,
    padding: 20,
    width: (width - 48) / 2,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3e5c76",
  },
  gridValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginTop: 12,
    marginBottom: 4,
  },
  gridLabel: {
    fontSize: 12,
    color: "#748cab",
    textAlign: "center",
  },
  chartCard: {
    backgroundColor: "#050000",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#3e5c76",
  },
  infoCard: {
    backgroundColor: "#050000",
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: "#3e5c76",
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 4,
  },
  infoSubtitle: {
    fontSize: 14,
    color: "#748cab",
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
    color: "#f0ebd8",
  },
  descText: {
    fontSize: 14,
    color: "#f0ebd8",
    flex: 1,
    textAlign: "right",
  },
  zonesContainer: {
    gap: 0,
  },

  // Loading
  loadingText: {
    fontSize: 16,
    color: "#748cab",
    marginTop: 16,
    fontWeight: "500",
  },
});
