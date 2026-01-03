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
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
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

  // Corrected export functions with proper dependency checks

  const escapeCsvValue = (value: string) => {
    const needsQuotes =
      value.includes(",") || value.includes("\n") || value.includes('"');
    const escaped = value.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  };

  const shareFile = async (uri: string) => {
    // Try expo-sharing first (better UX on mobile)
    try {
      const Sharing = await import("expo-sharing");
      if (
        Sharing?.isAvailableAsync &&
        typeof Sharing.isAvailableAsync === "function"
      ) {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare && Sharing.shareAsync) {
          await Sharing.shareAsync(uri);
          return;
        }
      }
    } catch (err) {
      console.log("expo-sharing not available");
    }

    // Fallback to React Native Share
    try {
      if (Platform.OS === "ios") {
        await Share.share({ url: uri });
      } else {
        await Share.share({ message: `File saved at: ${uri}`, url: uri });
      }
    } catch (error) {
      console.error("Share error:", error);
      Alert.alert("Export successful", `File saved to: ${uri}`);
    }
  };

  const exportAsJson = async () => {
    try {
      const { File, Paths } = await import("expo-file-system");

      const payload = history.map((h) => ({
        id: h.id,
        created_at: h.created_at,
        heartRate: h.heartRate,
      }));

      const fileName = `pulse_history_${Date.now()}.json`;
      const file = new File(Paths.document, fileName);

      await file.write(JSON.stringify(payload, null, 2));

      await shareFile(file.uri);
      Alert.alert("Success", "JSON file exported successfully");
    } catch (error) {
      console.error("Export JSON error:", error);
      Alert.alert("Export failed", "Could not export data as JSON");
    }
  };

  const exportAsCsv = async () => {
    try {
      const { File, Paths } = await import("expo-file-system");

      const header = ["id", "created_at", "heartRate"].join(",");
      const rows = history.map((h) =>
        [
          String(h.id),
          escapeCsvValue(new Date(h.created_at).toISOString()),
          String(h.heartRate),
        ].join(",")
      );
      const csv = [header, ...rows].join("\n");

      const fileName = `pulse_history_${Date.now()}.csv`;
      const file = new File(Paths.document, fileName);

      await file.write(csv);

      await shareFile(file.uri);
      Alert.alert("Success", "CSV file exported successfully");
    } catch (error) {
      console.error("Export CSV error:", error);
      Alert.alert("Export failed", "Could not export data as CSV");
    }
  };

  const exportAsPdf = async () => {
    try {
      const Print = await import("expo-print");

      // Check if expo-print is properly installed
      if (
        !Print?.printToFileAsync ||
        typeof Print.printToFileAsync !== "function"
      ) {
        Alert.alert(
          "PDF Export Unavailable",
          "The expo-print package is not installed. Please run:\n\nnpx expo install expo-print\n\nThen rebuild your app.",
          [{ text: "OK" }]
        );
        return;
      }

      const rowsHtml = history
        .map((h) => {
          const date = new Date(h.created_at);
          return `
          <tr>
            <td>${date.toLocaleString()}</td>
            <td style="text-align:right;">${h.heartRate}</td>
          </tr>
        `;
        })
        .join("");

      const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; 
              padding: 20px; 
              margin: 0;
            }
            h1 { 
              font-size: 24px; 
              margin: 0 0 8px 0; 
              color: #0d1321;
            }
            p { 
              margin: 0 0 16px 0; 
              color: #666; 
              font-size: 14px; 
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin-top: 8px;
            }
            th, td { 
              border-bottom: 1px solid #ddd; 
              padding: 12px 8px; 
              font-size: 13px; 
            }
            th { 
              text-align: left; 
              background-color: #f5f5f5;
              font-weight: 600;
              color: #0d1321;
            }
            tr:hover {
              background-color: #f9f9f9;
            }
          </style>
        </head>
        <body>
          <h1>Heart Rate History</h1>
          <p>Exported on ${new Date().toLocaleString()}</p>
          <p>Total readings: ${history.length}</p>
          <table>
            <thead>
              <tr>
                <th>Date/Time</th>
                <th style="text-align:right;">BPM</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </body>
      </html>
    `;

      const { uri } = await Print.printToFileAsync({
        html,
        base64: false,
      });

      await shareFile(uri);
      Alert.alert("Success", "PDF file exported successfully");
    } catch (error) {
      console.error("Export PDF error:", error);
      Alert.alert(
        "Export failed",
        "Could not export data as PDF. Make sure expo-print is installed:\n\nnpx expo install expo-print"
      );
    }
  };

  const handleExport = async () => {
    if (Platform.OS === "web") {
      Alert.alert(
        "Export not supported",
        "Exporting files is not supported on web for this app. Please use Android/iOS."
      );
      return;
    }
    if (history.length === 0) {
      Alert.alert("Nothing to export", "No readings available yet.");
      return;
    }

    Alert.alert("Export data", "Choose a format:", [
      { text: "CSV", onPress: () => void exportAsCsv() },
      { text: "JSON", onPress: () => void exportAsJson() },
      { text: "PDF", onPress: () => void exportAsPdf() },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const renderRightActions = (id: number) => {
    return (
      <View style={styles.swipeActions}>
        <View style={styles.swipeDeleteAction}>
          <MaterialIcons
            name="delete-forever"
            size={28}
            color="#f0ebd8"
            onPress={() => handleDelete(id)}
          />
          <Text style={styles.swipeDeleteText} onPress={() => handleDelete(id)}>
            Delete
          </Text>
        </View>
      </View>
    );
  };

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

        <TouchableOpacity style={styles.exportButton} onPress={handleExport}>
          <MaterialIcons name="file-download" size={18} color="#f0ebd8" />
          <Text style={styles.exportButtonText}>Export data</Text>
        </TouchableOpacity>
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
            <Swipeable
              key={item.id}
              overshootRight={false}
              renderRightActions={() => renderRightActions(item.id)}
            >
              <View style={styles.historyCard}>
                <View style={styles.cardLeft}>
                  <Text style={styles.cardDate}>
                    {formatDate(item.created_at)}
                  </Text>
                  <Text style={styles.cardTime}>
                    {formatTime(item.created_at)}
                  </Text>
                </View>
                <LinearGradient
                  colors={["#3e5c76", "#748cab"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.bpmBadge}
                >
                  <Text style={styles.bpmValue}>{item.heartRate}</Text>
                  <Text style={styles.bpmLabel}>BPM</Text>
                </LinearGradient>
              </View>
            </Swipeable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050000",
  },
  header: {
    padding: 20,
    paddingTop: 40,
    backgroundColor: "#050000",
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
  exportButton: {
    marginTop: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3e5c76",
    backgroundColor: "#0d1321",
  },
  exportButtonText: {
    color: "#f0ebd8",
    fontSize: 14,
    fontWeight: "600",
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  historyCard: {
    backgroundColor: "#0d1321",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
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
    borderRadius: 50,
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
  swipeActions: {
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  swipeDeleteAction: {
    width: 96,
    height: "100%",
    backgroundColor: "#920c0cff",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#28080eff",
  },
  swipeDeleteText: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: "#f0ebd8",
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
