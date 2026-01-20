import Entypo from "@expo/vector-icons/Entypo";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
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

export default function VerifyEmail() {
  const params = useLocalSearchParams();
  const email = params.email as string;
  const name = params.name as string;
  const password = params.password as string;

  const [verificationCode, setVerificationCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);
  const { onRegister } = useAuth();

  // create account on mount to trigger confirmation email
  React.useEffect(() => {
    const createAccount = async () => {
      if (!email || !name || !password || accountCreated) return;

      try {
        const result = await onRegister!(name, email, password);
        if (result && !result.error) {
          setAccountCreated(true);
          console.log("Account created, email sent");
        } else {
          Alert.alert("Error", result?.msg || "Failed to create account");
          router.back();
        }
      } catch (error: any) {
        console.error("Create account error:", error);
        Alert.alert("Error", "Failed to create account");
        router.back();
      }
    };

    createAccount();
  }, []);

  const handleVerifyEmail = async () => {
    if (!verificationCode) {
      Alert.alert("Error", "Please enter the verification code");
      return;
    }

    if (verificationCode.length !== 6) {
      Alert.alert("Error", "Verification code must be 6 digits");
      return;
    }

    if (!email) {
      Alert.alert(
        "Error",
        "Missing registration information. Please try again.",
      );
      router.replace("/(auth)/register");
      return;
    }

    setLoading(true);

    try {
      // verify the OTP, don't create account again
      const { data, error } =
        await require("../../lib/supabase").supabase.auth.verifyOtp({
          email: email,
          token: verificationCode,
          type: "signup",
        });

      if (error) {
        console.error("OTP verification error:", error);
        Alert.alert("Error", "Invalid verification code. Please try again.");
      } else {
        // sign out after verification
        await require("../../lib/supabase").supabase.auth.signOut();

        Alert.alert(
          "Success",
          "Email verified! You can now log in with your credentials.",
          [
            {
              text: "OK",
              onPress: () => router.replace("/(auth)/login"),
            },
          ],
        );
      }
    } catch (error: any) {
      console.error("Email verification exception:", error);
      Alert.alert("Error", error.message || "Failed to verify email");
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setResending(true);

    try {
      const { data, error } =
        await require("../../lib/supabase").supabase.auth.resend({
          type: "signup",
          email: email,
        });

      if (error) {
        if (
          error.message.includes("40 seconds") ||
          error.message.includes("45 seconds")
        ) {
          Alert.alert(
            "Please Wait",
            "Please wait a moment before requesting another code.",
          );
        } else {
          Alert.alert("Error", error.message || "Failed to resend code");
        }
      } else {
        Alert.alert("Success", "Verification code resent! Check your email.");
      }
    } catch (error: any) {
      console.error("Resend code error:", error);
      Alert.alert("Error", error.message || "Failed to resend code");
    } finally {
      setResending(false);
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
            <Entypo name="mail" size={64} color="#f0ebd8" />
            <Text style={styles.title}>Verify Your Email</Text>
            <Text style={styles.subtitle}>
              {accountCreated
                ? `We've sent a 6-digit code to\n`
                : "Creating your account...\n"}
              <Text style={styles.emailText}>{email}</Text>
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Verification Code</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter 6-digit code"
                placeholderTextColor="#748cab"
                value={verificationCode}
                onChangeText={(text) =>
                  setVerificationCode(text.replace(/[^0-9]/g, ""))
                }
                keyboardType="number-pad"
                maxLength={6}
                editable={!loading && accountCreated}
                autoFocus
                autoCorrect={false}
              />
            </View>

            <TouchableOpacity
              style={[(!accountCreated || loading) && styles.buttonDisabled]}
              onPress={handleVerifyEmail}
              disabled={!accountCreated || loading}
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
                  <Text style={styles.buttonText}>Verify Email</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleResendCode}
              disabled={resending || loading || !accountCreated}
              style={styles.resendButton}
            >
              <Text style={styles.resendButtonText}>
                {resending ? "Sending..." : "Resend Code"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.back()}
              disabled={loading}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>Back to Registration</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              <Entypo name="light-bulb" size={16} color="white" />
              Tip: Check your spam folder if you don't see the email
            </Text>
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
  icon: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: "#748cab",
    textAlign: "center",
    lineHeight: 24,
  },
  emailText: {
    fontWeight: "bold",
    color: "#f0ebd8",
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
    textAlign: "center",
    letterSpacing: 8,
    fontWeight: "bold",
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
  resendButton: {
    marginTop: 20,
    alignItems: "center",
    paddingVertical: 12,
  },
  resendButtonText: {
    color: "#748cab",
    fontSize: 16,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  backButton: {
    marginTop: 8,
    alignItems: "center",
    paddingVertical: 12,
  },
  backButtonText: {
    color: "#748cab",
    fontSize: 14,
  },
  infoBox: {
    marginTop: 32,
    backgroundColor: "rgba(62, 92, 118, 0.2)",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3e5c76",
    maxWidth: 400,
  },
  infoText: {
    color: "#748cab",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
