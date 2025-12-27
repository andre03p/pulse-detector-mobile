import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../context/AuthContext";

export default function Index() {
  const { authState } = useAuth();

  // Show loading indicator while checking auth state
  if (authState?.token === undefined) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#1d2d44",
        }}
      >
        <ActivityIndicator size="large" color="#748cab" />
      </View>
    );
  }

  if (authState?.authenticated) {
    return <Redirect href="/(tabs)/home" />;
  }

  return <Redirect href="/(auth)/login" />;
}
