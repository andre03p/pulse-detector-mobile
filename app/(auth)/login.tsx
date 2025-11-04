import { Text, TextInput, View } from "react-native";
import React, { useEffect, useState } from "react";
import { useAuth, API_URL } from "../../context/AuthContext";
import { StyleSheet } from "react-native";
import { router } from "expo-router";
import axios from "axios";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { onLogin, onRegister } = useAuth();

  const handleLogin = async () => {
    const result = await onLogin!(email, password);
    if (result.success) {
      console.log("Login successful");
      router.replace("/(tabs)/home" as any);
    } else {
      alert("Login failed: " + result.message);
      console.log("Login failed:", result.message);
    }
  };

  const handleRegister = async () => {
    const result = await onRegister!(email, password);
    if (result.success) {
      console.log("Registration successful");
      handleLogin();
    } else {
      alert("Registration failed: " + result.message);
      console.log("Registration failed:", result.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={{ fontSize: 24, marginBottom: 20 }}>
        Welcome to PulseDetector!
      </Text>
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={(text: string) => setEmail(text)}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={(text: string) => setPassword(text)}
          secureTextEntry={true}
        />
      </View>
      <Text onPress={handleLogin} style={{ marginBottom: 10, color: "blue" }}>
        Login
      </Text>
      <Text onPress={handleRegister} style={{ color: "blue" }}>
        Register
      </Text>
      <View style={styles.footer}>
        <Text style={{ fontSize: 24, marginBottom: 20 }}>
          Don't have an account? Sign up!
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 40,
    borderColor: "#0d1321",
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 10,
    borderRadius: 5,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f0ebd8",
  },
  form: {
    width: "80%",
    marginBottom: 20,
  },
  footer: { marginTop: 40 },
});
