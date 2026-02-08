import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";

type Point = { day: string; avg: number; count: number };

type Props = {
  data: Point[];
};

export default function WeeklyBpmChart({ data }: Props) {
  const max = Math.max(...data.map((d) => d.avg), 1);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Weekly Average BPM</Text>
      <Svg width="100%" height={120}>
        {data.map((d, i) => {
          const barWidth = 20;
          const gap = 12;
          const x = 8 + i * (barWidth + gap);
          const height = (d.avg / max) * 100;
          return (
            <Rect
              key={d.day}
              x={x}
              y={110 - height}
              width={barWidth}
              height={height}
              rx={4}
              fill="#748cab"
            />
          );
        })}
      </Svg>
      <View style={styles.labels}>
        {data.map((d) => (
          <Text key={d.day} style={styles.label}>
            {d.day.slice(5)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#0d1321",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  title: {
    color: "#f0ebd8",
    fontWeight: "600",
    marginBottom: 8,
  },
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: {
    color: "#748cab",
    fontSize: 12,
  },
});
