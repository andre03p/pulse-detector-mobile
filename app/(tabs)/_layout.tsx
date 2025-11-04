import { Tabs, useRouter } from "expo-router";
import Footer from "../../components/footer";
import { useAuth } from "../../context/AuthContext";
import { Button } from "react-native";

export default function TabsLayout() {
  const { onLogout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await onLogout!();
    router.replace("/(auth)/login" as any);
  };

  return (
    <Tabs
      tabBar={(props) => <Footer />}
      screenOptions={{
        headerShown: true,
        headerTitle: "Pulse Detector",
        headerRight: () => <Button title="Sign Out" onPress={handleLogout} />,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: "Stats",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
        }}
      />
    </Tabs>
  );
}
