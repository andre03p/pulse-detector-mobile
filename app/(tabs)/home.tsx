import { Text, View } from "react-native";
import React, { useEffect } from "react";
import { API_URL } from "@/context/AuthContext";
import axios from "axios";

export default function Home() {
  useEffect(() => {
    const testCall = async () => {
      const result = await axios.get(`${API_URL}/health-check`);
      console.log("Test API call result:", result.data);
    };
    testCall();
  }, []);
  return (
    <View className="flex-1 justify-center items-center px-4">
      <Text className="text-2xl text-center text-[#0d1321] font-semibold">
        Start monitoring your heart rate ☺
      </Text>
    </View>
  );
}
