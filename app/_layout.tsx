import { Stack } from "expo-router";
import { useEffect } from "react";
import { Linking } from "react-native";
import { AuthProvider } from "../context/AuthContext";
import "../global.css";

export default function RootLayout() {
  useEffect(() => {
    // Handle deep links for password reset
    const handleDeepLink = (event: { url: string }) => {
      console.log("Deep link received:", event.url);
    };

    // Add listener for deep links
    const subscription = Linking.addEventListener("url", handleDeepLink);

    // Check if app was opened via a deep link
    Linking.getInitialURL().then((url) => {
      if (url) {
        console.log("Initial URL:", url);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </AuthProvider>
  );
}
