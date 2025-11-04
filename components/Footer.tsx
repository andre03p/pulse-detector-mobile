import { View, TouchableOpacity, Text } from "react-native";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import Ionicons from "@expo/vector-icons/Ionicons";
import AntDesign from "@expo/vector-icons/AntDesign";
import React from "react";
import { usePathname, useRouter } from "expo-router";

export default function Footer() {
  const router = useRouter();
  const pathname = usePathname();

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
    const size = 28;

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

  return (
    <View className="flex-row justify-around items-center bg-[#1d2d44] py-4 px-4 border-t-2 border-[#3e5c76]">
      {menu.map((item) => {
        const isActive = pathname === item.href;
        return (
          <TouchableOpacity
            key={item.name}
            className={`flex items-center justify-center flex-1 ${
              isActive ? "bg-[#3e5c76] rounded-xl p-2" : ""
            }`}
            onPress={() => router.push(item.href as any)}
          >
            {renderIcon(item.iconFamily, item.icon, isActive)}
            <Text
              className={`text-xs mt-1 font-medium ${
                isActive ? "text-[#f0ebd8]" : "text-[#748cab]"
              }`}
            >
              {item.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
