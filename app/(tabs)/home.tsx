import { useAuth } from "@/context/AuthContext";
import Entypo from "@expo/vector-icons/Entypo";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Home() {
  const { authState } = useAuth();
  const [greeting, setGreeting] = useState("Welcome");
  const insets = useSafeAreaInsets();

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

        <TouchableOpacity>
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
              <Text style={styles.statValue}>--</Text>
              <Text style={styles.statLabel}>BPM</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>--</Text>
              <Text style={styles.statLabel}>Reading</Text>
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
    backgroundColor: "#1d2d44",
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
  },
});
