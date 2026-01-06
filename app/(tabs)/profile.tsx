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
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>
              {authState?.user?.email?.charAt(0).toUpperCase() || "U"}
            </Text>
          </View>
          <Text style={styles.name}>
            {authState?.user?.user_metadata?.display_name
              ? `Hello, ${authState.user.user_metadata.display_name}!`
              : "Welcome!"}
          </Text>
          <Text style={styles.email}>{authState?.user?.email}</Text>
        </LinearGradient>

        <View style={styles.content}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account Information</Text>

            <View style={styles.infoCard}>
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
                  {authState?.user?.email_confirmed_at
                    ? "Yes ✓"
                    : "Not verified"}
                </Text>
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutButtonText}>Logout</Text>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>PulseDetector v1.0.0</Text>
          </View>
        </View>
      </ScrollView>
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
    paddingBottom: 30,
    alignItems: "center",
  },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#3e5c76",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#748cab",
    marginBottom: 16,
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
    marginBottom: 8,
    textAlign: "center",
  },
  email: {
    fontSize: 14,
    color: "#748cab",
    textAlign: "center",
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginTop: 24,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 16,
  },
  infoCard: {
    backgroundColor: "#0d1321",
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: "#3e5c76",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  infoLabel: {
    fontSize: 15,
    color: "#748cab",
    fontWeight: "500",
  },
  infoValue: {
    fontSize: 15,
    color: "#f0ebd8",
    fontWeight: "600",
    flex: 1,
    textAlign: "right",
    marginLeft: 16,
  },
  divider: {
    height: 1,
    backgroundColor: "#3e5c76",
    opacity: 0.5,
  },
  logoutButton: {
    backgroundColor: "#3e5c76",
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#748cab",
    shadowColor: "#000",
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
    paddingVertical: 40,
    marginTop: 20,
  },
  footerText: {
    fontSize: 12,
    color: "#748cab",
    opacity: 0.6,
  },
});
