import AntDesign from "@expo/vector-icons/AntDesign";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Footer() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const menu = [
    {
      name: "Measure",
      icon: "finger-print-outline",
      iconFamily: "Ionicons",
      href: "/(tabs)/home",
    },
    {
      name: "History",
      icon: "history",
      iconFamily: "AntDesign",
      href: "/(tabs)/history",
    },
    {
      name: "Stats",
      icon: "analytics-outline",
      iconFamily: "Ionicons",
      href: "/(tabs)/stats",
    },
    {
      name: "Profile",
      icon: "person",
      iconFamily: "FontAwesome6",
      href: "/(tabs)/profile",
    },
  ];

  const renderIcon = (iconFamily: string, icon: string, isActive: boolean) => {
    const color = isActive ? "#f0ebd8" : "#748cab";
    const size = 24;

    switch (iconFamily) {
      case "Ionicons":
        return <Ionicons name={icon as any} size={size} color={color} />;
      case "AntDesign":
        return <AntDesign name={icon as any} size={size} color={color} />;
      case "FontAwesome6":
        return <FontAwesome6 name={icon as any} size={size} color={color} />;
      default:
        return null;
    }
  };

  // helper: remove route-group segments like "/(tabs)"
  const normalizeHref = (href: string) =>
    href.replace(/\(.*?\)/g, "").replace(/\/\/+/g, "/");

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom || 12 }]}>
      {menu.map((item) => {
        const normalized = normalizeHref(item.href);
        const isActive =
          pathname === normalized || pathname?.startsWith(normalized + "/");

        return (
          <TouchableOpacity
            key={item.name}
            style={styles.button}
            onPress={() => router.push(item.href as any)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.iconContainer,
                isActive && styles.iconContainerActive,
              ]}
            >
              {renderIcon(item.iconFamily, item.icon, isActive)}
            </View>
            <Text
              style={[
                styles.label,
                { color: isActive ? "#f0ebd8" : "#748cab" },
              ]}
            >
              {item.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 4,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    backgroundColor: "#0d1321",
    paddingTop: 12,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: "#3e5c76",
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
  },
  iconContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  iconContainerActive: {
    backgroundColor: "#3e5c76",
    borderRadius: 24,
    width: 34,
    height: 34,
  },
  label: {
    fontSize: 11,
    fontWeight: "500",
  },
});
