import { useAuth } from "@/context/AuthContext";
import { deleteMeasurement, fetchMeasurements } from "@/lib/supabaseQueries";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface HistoryItem {
  id: number;
  created_at: string;
  heartRate: number;
  timeStamp: string;
  userId: number;
}

export default function History() {
  const { authState } = useAuth();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();

  const loadHistory = async () => {
    try {
      const { data, error } = await fetchMeasurements();

      if (error) {
        Alert.alert("Error", "Failed to load history. Please try again.");
        console.error("Error fetching measurements:", error);
      } else if (data) {
        setHistory(data);
      }
    } catch (error) {
      console.error("Error loading history:", error);
      Alert.alert("Error", "Failed to load history. Please try again.");
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [])
  );

  const handleDelete = async (id: number) => {
    Alert.alert(
      "Delete Measurement",
      "Are you sure you want to delete this measurement?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const { error } = await deleteMeasurement(id);
            if (error) {
              Alert.alert("Error", "Failed to delete measurement.");
            } else {
              // Refresh the list
              loadHistory();
            }
          },
        },
      ]
    );
  };

  const getBpmColor = (bpm: number) => {
    if (bpm < 60) return "#748cab"; // Low
    if (bpm > 100) return "#d32f2f"; // High
    return "#3e5c76"; // Normal
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
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
        <Text style={styles.loadingText}>Loading history...</Text>
      </View>
    );
  }

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
            <Text style={styles.emptyIcon}>
              <Ionicons name="stats-chart-outline" size={24} color="#f0ebd8" />
            </Text>
            <Text style={styles.emptyTitle}>No readings yet</Text>
            <Text style={styles.emptySubtitle}>
              Start monitoring your heart rate to see your history
            </Text>
          </View>
        ) : (
          history.map((item) => (
            <View key={item.id} style={styles.historyCard}>
              <View style={styles.cardLeft}>
                <Text style={styles.cardDate}>
                  {formatDate(item.created_at)}
                </Text>
                <Text style={styles.cardTime}>
                  {formatTime(item.created_at)}
                </Text>
              </View>
              <View
                style={[
                  styles.bpmBadge,
                  { backgroundColor: getBpmColor(item.heartRate) },
                ]}
              >
                <Text style={styles.bpmValue}>{item.heartRate}</Text>
                <Text style={styles.bpmLabel}>BPM</Text>
              </View>
              <TouchableOpacity
                onPress={() => handleDelete(item.id)}
                style={styles.deleteButton}
              >
                <Text style={styles.deleteButtonText}>
                  <MaterialIcons
                    name="delete-forever"
                    size={24}
                    color="#f0ebd8"
                  />
                </Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
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
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#748cab",
    textAlign: "center",
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
  deleteButton: {
    marginLeft: 12,
    padding: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButtonText: {
    fontSize: 24,
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
  loadingText: {
    fontSize: 16,
    color: "#748cab",
    marginTop: 16,
  },
});
