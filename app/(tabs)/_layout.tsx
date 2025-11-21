import { Tabs } from "expo-router";
import Footer from "../../components/footer";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <Footer />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="stats" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
