import { useAuth } from "@/context/AuthContext";
import { fetchMeasurements } from "@/lib/supabaseQueries";
import Entypo from "@expo/vector-icons/Entypo";
import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Home() {
  const { authState } = useAuth();
  const [greeting, setGreeting] = useState("Welcome");
  const [showMonitor, setShowMonitor] = useState(false);
  const [latestBPM, setLatestBPM] = useState<number | null>(null);
  const [totalReadings, setTotalReadings] = useState<number>(0);
  const insets = useSafeAreaInsets();

  // Detect if running in Expo Go or dev client
  const isExpoGo = Constants.appOwnership === "expo";

  // Dynamically import the appropriate component
  const HeartRateMonitor = isExpoGo
    ? require("@/components/HeartRateMonitorPreview").default
    : require("@/components/HeartRateMonitor").default;

  const loadLatestMeasurement = async () => {
    try {
      const { data, error } = await fetchMeasurements();

      if (!error && data && data.length > 0) {
        setLatestBPM(data[0].heartRate);
        setTotalReadings(data.length);
      }
    } catch (error) {
      console.error("Error loading latest measurement:", error);
    }
  };

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) {
      setGreeting("Good Morning");
    } else if (hour < 18) {
      setGreeting("Good Afternoon");
    } else {
      setGreeting("Good Evening");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLatestMeasurement();
    }, [])
  );

  const footerHeight = 80 + (insets.bottom || 12);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: footerHeight }}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={["#0d1321", "#1d2d44"]}
          style={[styles.header, { paddingTop: insets.top + 16 }]}
        >
          <View style={styles.headerContent}>
            <Entypo name="home" size={28} color="#f0ebd8" />
            <Text style={styles.headerTitle}>{greeting}!</Text>
          </View>
          {authState?.user?.email && (
            <Text style={styles.headerSubtitle}>{authState.user.email}</Text>
          )}
        </LinearGradient>

        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Entypo name="heart" size={50} color="#f0ebd8" />
          </View>
          <Text style={styles.title}>Monitor your heart rate</Text>
          <Text style={styles.subtitle}>track your pulse and stay healthy</Text>

          <TouchableOpacity onPress={() => setShowMonitor(true)}>
            <LinearGradient
              colors={["#3e5c76", "#748cab"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Begin Monitoring</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSection}>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Quick Stats</Text>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {latestBPM !== null ? latestBPM : "--"}
                </Text>
                <Text style={styles.statLabel}>Latest BPM</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{totalReadings}</Text>
                <Text style={styles.statLabel}>Total Readings</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={showMonitor}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          setShowMonitor(false);
          loadLatestMeasurement();
        }}
      >
        <View style={styles.modalContainer}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 16 }]}>
            <TouchableOpacity
              onPress={() => {
                setShowMonitor(false);
                loadLatestMeasurement();
              }}
              style={styles.closeButton}
            >
              <Entypo name="cross" size={28} color="#f0ebd8" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Heart Rate Monitor</Text>
          </View>
          <HeartRateMonitor />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050000",
  },
  scrollView: {
    flex: 1,
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
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#f0ebd8",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#748cab",
    textAlign: "center",
  },
  content: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#0d1321",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 3,
    borderColor: "#3e5c76",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f0ebd8",
    textAlign: "center",
    marginBottom: 8,
    marginTop: 10,
  },
  subtitle: {
    fontSize: 16,
    color: "#748cab",
    textAlign: "center",
    marginBottom: 32,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    shadowColor: "#0d1321",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  buttonText: {
    color: "#f0ebd8",
    fontSize: 18,
    fontWeight: "bold",
  },
  bottomSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  infoCard: {
    backgroundColor: "#0d1321",
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: "#3e5c76",
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: "#748cab",
  },
  statValue: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#748cab",
  },
  statLabel: {
    fontSize: 14,
    color: "#748cab",
    marginTop: 4,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#1d2d44",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: "#0d1321",
    borderBottomWidth: 1,
    borderBottomColor: "#3e5c76",
  },
  closeButton: {
    padding: 8,
    marginRight: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#f0ebd8",
  },
});
