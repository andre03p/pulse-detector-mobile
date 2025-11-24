import { LinearGradient } from "expo-linear-gradient";
import { Link, router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../../context/AuthContext";

export default function ResetPass() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const { onResetPassword } = useAuth();

  const validateEmail = (email: string) => {
    const emailRegex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/;
    return emailRegex.test(email);
  };

  const handleResetPassword = async () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      Alert.alert("Error", "Please enter your email");
      return;
    }

    if (!validateEmail(trimmedEmail)) {
      Alert.alert("Error", "Please enter a valid email address");
      return;
    }

    setLoading(true);

    try {
      const result = await onResetPassword!(trimmedEmail);

      if (result && !result.error) {
        router.push({
          pathname: "/(auth)/update-pass",
          params: { email: trimmedEmail },
        });
        console.log("Verification code sent");
      } else {
        Alert.alert("Error", result?.msg || "Failed to send verification code");
        console.log("Password reset failed:", result?.msg);
      }
    } catch (error: any) {
      console.error("Password reset error:", error);
      Alert.alert("Error", error.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={["#0d1321", "#1d2d44", "#3e5c76"]}
      style={styles.gradient}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>
              Enter your email to receive a 6-digit verification code
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor="#748cab"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!loading}
                autoCorrect={false}
              />
            </View>

            <TouchableOpacity
              style={[loading && styles.buttonDisabled]}
              onPress={handleResetPassword}
              disabled={loading}
            >
              <LinearGradient
                colors={["#3e5c76", "#748cab"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.button}
              >
                {loading ? (
                  <ActivityIndicator color="#f0ebd8" />
                ) : (
                  <Text style={styles.buttonText}>Send Verification Code</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Remember your password? </Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity disabled={loading}>
                <Text style={styles.linkText}>Sign In</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  header: {
    width: "100%",
    marginBottom: 40,
    alignItems: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#748cab",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  form: {
    width: "100%",
    maxWidth: 400,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#748cab",
    marginBottom: 8,
  },
  input: {
    height: 50,
    backgroundColor: "#0d1321",
    borderColor: "#3e5c76",
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#f0ebd8",
  },
  button: {
    height: 54,
    backgroundColor: "#3e5c76",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
    shadowColor: "#0d1321",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#f0ebd8",
    fontSize: 18,
    fontWeight: "bold",
  },
  successContainer: {
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    paddingVertical: 20,
  },
  successIcon: {
    fontSize: 64,
    color: "#748cab",
    marginBottom: 20,
  },
  successText: {
    fontSize: 20,
    color: "#f0ebd8",
    marginBottom: 12,
    textAlign: "center",
    fontWeight: "600",
  },
  successSubtext: {
    fontSize: 14,
    color: "#748cab",
    marginBottom: 30,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  successButtonContainer: {
    width: "100%",
  },
  footer: {
    flexDirection: "row",
    marginTop: 32,
    alignItems: "center",
  },
  footerText: {
    fontSize: 16,
    color: "#748cab",
  },
  linkText: {
    fontSize: 16,
    color: "#f0ebd8",
    fontWeight: "bold",
  },
});
