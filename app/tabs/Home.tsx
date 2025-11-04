import { Text, View } from "react-native";
import React from "react";
import Footer from "../../components/Footer";

export default function Home() {
  return (
    <View className="flex-1 justify-center items-center px-4">
      <Text className="text-2xl text-center text-[#0d1321] font-semibold">
        Start monitoring your heart rate ☺
      </Text>
      <Footer />
    </View>
  );
}
