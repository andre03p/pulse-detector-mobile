import HeartRateMonitor from "@/components/HeartRateMonitor";
import { useAuth } from "@/context/AuthContext";
import { fetchMeasurements } from "@/lib/supabaseQueries";
import Entypo from "@expo/vector-icons/Entypo";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Home() {
  const { authState } = useAuth();
  const [greeting, setGreeting] = useState("Welcome");
  const [showMonitor, setShowMonitor] = useState(false);
  const [latestBPM, setLatestBPM] = useState<number | null>(null);
  const [totalReadings, setTotalReadings] = useState<number>(0);
  const insets = useSafeAreaInsets();

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
    <View style={[styles.container, { paddingBottom: footerHeight }]}>
      <LinearGradient colors={["#0d1321", "#1d2d44"]} style={styles.header}>
        <Text style={styles.greeting}>{greeting}!</Text>
        {authState?.user?.email && (
          <Text style={styles.email}>{authState.user.email}</Text>
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
          <View style={styles.modalHeader}>
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
  },
  greeting: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 4,
    marginTop: 4,
  },
  email: {
    fontSize: 14,
    color: "#748cab",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#0d1321",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
    borderWidth: 3,
    borderColor: "#3e5c76",
  },
  icon: {
    fontSize: 50,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f0ebd8",
    textAlign: "center",
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 16,
    color: "#748cab",
    textAlign: "center",
    marginBottom: 32,
  },
  button: {
    backgroundColor: "#3e5c76",
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
  infoCard: {
    backgroundColor: "#0d1321",
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: "#3e5c76",
    marginBottom: 40,
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
  bottomSection: {
    paddingHorizontal: 20,
    paddingBottom: 30,
    marginTop: 40,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#1d2d44",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    paddingTop: 50,
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
