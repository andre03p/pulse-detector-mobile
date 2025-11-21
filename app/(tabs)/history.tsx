import { useAuth } from "@/context/AuthContext";
import React, { useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LinearGradient } from "expo-linear-gradient";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// Example data structure - replace with your actual data from Supabase
interface HistoryItem {
  id: string;
  date: string;
  bpm: number;
  time: string;
}

export default function History() {
  const { authState } = useAuth();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    // TODO: Fetch actual history from Supabase
    // Example:
    // const fetchHistory = async () => {
    //   const { data, error } = await supabase
    //     .from('heart_rate_readings')
    //     .select('*')
    //     .order('created_at', { ascending: false });
    //   if (data) setHistory(data);
    // };
    // fetchHistory();

    // Mock data for now
    setHistory([
      { id: "1", date: "2025-11-08", bpm: 72, time: "09:30 AM" },
      { id: "2", date: "2025-11-07", bpm: 68, time: "02:15 PM" },
      { id: "3", date: "2025-11-07", bpm: 75, time: "08:45 AM" },
      { id: "4", date: "2025-11-06", bpm: 70, time: "11:20 AM" },
    ]);
  }, []);

  const getBpmColor = (bpm: number) => {
    if (bpm < 60) return "#748cab"; // Low
    if (bpm > 100) return "#d32f2f"; // High
    return "#3e5c76"; // Normal
  };

  const footerHeight = 80 + (insets.bottom || 12);

  return (
    <View style={[styles.container, { paddingBottom: footerHeight }]}>
      <LinearGradient colors={["#0d1321", "#1d2d44"]} style={styles.header}>
        <Text style={styles.title}>Heart Rate History</Text>
        <Text style={styles.subtitle}>
          {history.length} {history.length === 1 ? "reading" : "readings"}{" "}
          recorded
        </Text>
      </LinearGradient>

      <ScrollView style={styles.scrollView}>
        {history.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyTitle}>No readings yet</Text>
            <Text style={styles.emptySubtitle}>
              Start monitoring your heart rate to see your history
            </Text>
          </View>
        ) : (
          history.map((item) => (
            <TouchableOpacity key={item.id} style={styles.historyCard}>
              <View style={styles.cardLeft}>
                <Text style={styles.cardDate}>{item.date}</Text>
                <Text style={styles.cardTime}>{item.time}</Text>
              </View>
              <View
                style={[
                  styles.bpmBadge,
                  { backgroundColor: getBpmColor(item.bpm) },
                ]}
              >
                <Text style={styles.bpmValue}>{item.bpm}</Text>
                <Text style={styles.bpmLabel}>BPM</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <TouchableOpacity style={styles.exportButton}>
        <Text style={styles.exportButtonText}>Export History</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1d2d44",
  },
  header: {
    padding: 20,
    paddingTop: 40,
    backgroundColor: "#0d1321",
    borderBottomWidth: 1,
    borderBottomColor: "#3e5c76",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 4,
    marginTop: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#748cab",
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  historyCard: {
    backgroundColor: "#0d1321",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3e5c76",
    shadowColor: "#0d1321",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  cardLeft: {
    flex: 1,
  },
  cardDate: {
    fontSize: 16,
    fontWeight: "600",
    color: "#f0ebd8",
    marginBottom: 4,
  },
  cardTime: {
    fontSize: 14,
    color: "#748cab",
  },
  bpmBadge: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    minWidth: 80,
  },
  bpmValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f0ebd8",
  },
  bpmLabel: {
    fontSize: 12,
    color: "#f0ebd8",
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#748cab",
    textAlign: "center",
    paddingHorizontal: 40,
  },
  exportButton: {
    backgroundColor: "#3e5c76",
    borderRadius: 12,
    padding: 16,
    margin: 16,
    alignItems: "center",
    shadowColor: "#0d1321",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  exportButtonText: {
    color: "#f0ebd8",
    fontSize: 16,
    fontWeight: "bold",
  },
});
