import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Line,
  Polygon,
  Polyline,
  Text as SvgText,
} from "react-native-svg";

type Point = { day: string; avg: number; count: number };

type Props = {
  data: Point[];
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const VB_W = 320;
const VB_H = 150;
const PAD_L = 16;
const PAD_R = 30;
const PAD_T = 26;
const PAD_B = 24;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

function weekdayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

export default function WeeklyBpmChart({ data }: Props) {
  if (data.length === 0) return null;

  const avgs = data.map((d) => d.avg);
  const dataMin = Math.min(...avgs);
  const dataMax = Math.max(...avgs);
  const mean = Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length);

  let lo = Math.floor(dataMin - 4);
  let hi = Math.ceil(dataMax + 4);
  if (hi - lo < 10) {
    const mid = (hi + lo) / 2;
    lo = Math.round(mid - 5);
    hi = Math.round(mid + 5);
  }

  const x = (i: number) =>
    data.length === 1
      ? PAD_L + PLOT_W / 2
      : PAD_L + (i / (data.length - 1)) * PLOT_W;
  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * PLOT_H;

  const pts = data.map((d, i) => ({ ...d, px: x(i), py: y(d.avg) }));
  const linePts = pts
    .map((p) => `${p.px.toFixed(1)},${p.py.toFixed(1)}`)
    .join(" ");
  const baseY = PAD_T + PLOT_H;
  const areaPts = `${PAD_L},${baseY} ${linePts} ${(PAD_L + PLOT_W).toFixed(1)},${baseY}`;
  const meanY = y(mean);

  return (
    <View>
      <Text style={styles.summary}>
        Low <Text style={styles.summaryNum}>{dataMin}</Text> · Avg{" "}
        <Text style={styles.summaryNum}>{mean}</Text> · High{" "}
        <Text style={styles.summaryNum}>{dataMax}</Text> BPM
      </Text>

      <View style={styles.plot}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`}>
          {/* Weekly average reference line */}
          <Line
            x1={PAD_L}
            y1={meanY}
            x2={PAD_L + PLOT_W}
            y2={meanY}
            stroke="#5b6b85"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
          <SvgText
            x={PAD_L + PLOT_W + 4}
            y={meanY + 3}
            fontSize={9}
            fill="#5b6b85"
            textAnchor="start"
          >
            avg
          </SvgText>

          {/* Trend area + line (need at least 2 points) */}
          {data.length > 1 && (
            <>
              <Polygon points={areaPts} fill="#748cab" opacity={0.14} />
              <Polyline
                points={linePts}
                fill="none"
                stroke="#748cab"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          )}

          {/* Points: dot + BPM value above + weekday below */}
          {pts.map((p, i) => {
            const isLast = i === pts.length - 1;
            return (
              <React.Fragment key={p.day}>
                <Circle
                  cx={p.px}
                  cy={p.py}
                  r={isLast ? 4.5 : 3.5}
                  fill={isLast ? "#f0ebd8" : "#748cab"}
                  stroke="#0d1321"
                  strokeWidth={1.5}
                />
                <SvgText
                  x={p.px}
                  y={p.py - 9}
                  fontSize={11}
                  fontWeight="700"
                  fill="#f0ebd8"
                  textAnchor="middle"
                >
                  {p.avg}
                </SvgText>
                <SvgText
                  x={p.px}
                  y={VB_H - 8}
                  fontSize={10}
                  fill="#8a99b5"
                  textAnchor="middle"
                >
                  {weekdayLabel(p.day)}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    color: "#8a99b5",
    fontSize: 13,
    marginBottom: 4,
  },
  summaryNum: {
    color: "#f0ebd8",
    fontWeight: "700",
  },
  plot: {
    width: "100%",
    aspectRatio: VB_W / VB_H,
  },
});
