import { useAuth } from "@/context/AuthContext";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Profile() {
  const { authState, onLogout } = useAuth();
  const insets = useSafeAreaInsets();

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          const result = await onLogout!();
          if (!result?.error) {
            router.replace("/(auth)/login" as any);
          }
        },
      },
    ]);
  };

  const footerHeight = 80 + (insets.bottom || 12);

  return (
    <ScrollView style={[styles.container, { paddingBottom: footerHeight }]}>
      <LinearGradient colors={["#0d1321", "#1d2d44"]} style={styles.header}>
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>
            {authState?.user?.email?.charAt(0).toUpperCase() || "U"}
          </Text>
        </View>
        <Text style={styles.name}>
          {" "}
          Hello{", "}
          {authState?.user?.user_metadata?.display_name ||
            "No username found for this user."}
          {"!"}
        </Text>
        {/* <Text style={styles.userId}>
          User ID: {authState?.user?.id?.slice(0, 8)}...
        </Text> */}
      </LinearGradient>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account Information</Text>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{authState?.user?.email}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Account Created</Text>
            <Text style={styles.infoValue}>
              {authState?.user?.created_at
                ? new Date(authState.user.created_at).toLocaleDateString()
                : "N/A"}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email Verified</Text>
            <Text style={styles.infoValue}>
              {authState?.user?.email_confirmed_at ? "Yes ✓" : "Not verified"}
            </Text>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutButtonText}>Logout</Text>
      </TouchableOpacity>

      <View style={[styles.footer, { paddingBottom: footerHeight }]}>
        <Text style={styles.footerText}>PulseDetector v1.0.0</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1d2d44",
    paddingBottom: 80,
  },
  header: {
    alignItems: "center",
    paddingVertical: 40,
    backgroundColor: "#0d1321",
    borderBottomWidth: 1,
    borderBottomColor: "#3e5c76",
  },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#3e5c76",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    marginTop: 20,
    borderWidth: 3,
    borderColor: "#1d2d44",
  },
  avatarText: {
    fontSize: 40,
    fontWeight: "bold",
    color: "#f0ebd8",
  },
  name: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 4,
  },
  email: {
    fontSize: 18,
    fontWeight: "600",
    color: "#f0ebd8",
    marginBottom: 4,
  },
  userId: {
    fontSize: 12,
    color: "#748cab",
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 16,
    textAlign: "center",
  },
  infoCard: {
    backgroundColor: "#0d1321",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#3e5c76",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: "#748cab",
    fontWeight: "500",
  },
  infoValue: {
    fontSize: 14,
    color: "#f0ebd8",
    fontWeight: "600",
    flex: 1,
    textAlign: "right",
  },
  divider: {
    height: 1,
    backgroundColor: "#3e5c76",
  },
  logoutButton: {
    backgroundColor: "#3e5c76",
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginTop: 40,
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
  logoutButtonText: {
    color: "#f0ebd8",
    fontSize: 16,
    fontWeight: "bold",
  },
  footer: {
    alignItems: "center",
    paddingVertical: 30,
  },
  footerText: {
    fontSize: 12,
    color: "#748cab",
    bottom: 30,
    position: "absolute",
  },
});
