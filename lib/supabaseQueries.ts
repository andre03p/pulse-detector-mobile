import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/supabaseHelpers";

export const fetchMeasurements = async () => {
  const user = await getCurrentUser();
  if (!user) return { data: null, error: { message: "Not authenticated" } };

  const { data, error } = await supabase
    .from("Measurement")
    .select("*")
    .eq("userId", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return { data, error };
};

export const addMeasurement = async (heartRate: number) => {
  const user = await getCurrentUser();
  if (!user) return { data: null, error: { message: "Not authenticated" } };

  const { data, error } = await supabase
    .from("Measurement")
    .insert({
      userId: user.id,
      heartRate: heartRate,
      timeStamp: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })
    .select();

  return { data, error };
};

export const getHeartRateStats = async () => {
  const user = await getCurrentUser();
  if (!user) return { data: null, error: { message: "Not authenticated" } };

  const { data: readings, error } = await supabase
    .from("Measurement")
    .select("heartRate, created_at")
    .eq("userId", user.id);

  if (error || !readings || readings.length === 0) {
    return {
      data: {
        avgBpm: 0,
        minBpm: 0,
        maxBpm: 0,
        totalReadings: 0,
        weeklyReadings: 0,
      },
      error,
    };
  }

  const bpms = readings.map((r: any) => r.heartRate);
  const avgBpm = Math.round(
    bpms.reduce((sum: number, bpm: number) => sum + bpm, 0) / bpms.length
  );
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weeklyReadings = readings.filter(
    (r: any) => new Date(r.created_at) >= weekAgo
  ).length;

  return {
    data: {
      avgBpm,
      minBpm: Math.min(...bpms),
      maxBpm: Math.max(...bpms),
      totalReadings: readings.length,
      weeklyReadings,
    },
    error: null,
  };
};
