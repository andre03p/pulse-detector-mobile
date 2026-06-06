import { Tabs } from "expo-router";
import Footer from "../../components/Footer";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={() => <Footer />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="stats" />
      <Tabs.Screen name="alarms" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
