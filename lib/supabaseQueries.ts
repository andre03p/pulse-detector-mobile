import { supabase } from "@/lib/supabase";

const getCurrentUser = async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
};

export const createUserProfile = async (
  authUuid: string,
  email: string,
  name?: string,
) => {
  try {
    const { data: existing } = await supabase
      .from("User")
      .select("id")
      .eq("auth_uuid", authUuid)
      .maybeSingle();

    if (existing) {
      return { data: existing, error: null };
    }

    // create new user profile with auth_uuid (no password, managed by Supabase Auth)
    const { data, error } = await supabase
      .from("User")
      .insert({
        auth_uuid: authUuid,
        email: email,
        name: name || email.split("@")[0],
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error creating user profile:", error);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (error) {
    console.error("Exception creating user profile:", error);
    return { data: null, error };
  }
};

export const getUserId = async (): Promise<number | null> => {
  const authUser = await getCurrentUser();
  if (!authUser) return null;

  const { data, error } = await supabase
    .from("User")
    .select("id")
    .eq("auth_uuid", authUser.id)
    .maybeSingle();

  if (!data) {
    console.log("User profile not found, creating...");
    const { data: newUser, error: createError } = await createUserProfile(
      authUser.id,
      authUser.email || "",
      authUser.user_metadata?.display_name,
    );

    if (createError || !newUser) {
      console.error("Error creating user profile:", createError);
      return null;
    }

    return newUser.id;
  }

  if (error) {
    console.error("Error fetching user ID:", error);
    return null;
  }

  return data.id;
};

export type AlarmRow = {
  id: number;
  userId: number;
  time: string;
  label: string;
  enabled: boolean;
  repeat_days: string[];
  created_at?: string;
  updated_at?: string;
};

export const fetchAlarms = async () => {
  const userId = await getUserId();
  if (!userId) return { data: null, error: { message: "Not authenticated" } };

  const { data, error } = await supabase
    .from("Alarm")
    .select("*")
    .eq("userId", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching alarms:", error);
  }

  return { data: data as AlarmRow[] | null, error };
};

export const createAlarm = async (alarm: {
  time: string;
  label: string;
  enabled: boolean;
  repeat_days: string[];
}) => {
  const userId = await getUserId();
  if (!userId) return { data: null, error: { message: "Not authenticated" } };

  const { data, error } = await supabase
    .from("Alarm")
    .insert({
      userId,
      time: alarm.time,
      label: alarm.label,
      enabled: alarm.enabled,
      repeat_days: alarm.repeat_days,
    })
    .select("*")
    .single();

  if (error) {
    console.error("Error creating alarm:", error);
  }

  return { data: data as AlarmRow | null, error };
};

export const updateAlarm = async (
  alarmId: number,
  patch: Partial<Pick<AlarmRow, "time" | "label" | "enabled" | "repeat_days">>,
) => {
  const userId = await getUserId();
  if (!userId) return { data: null, error: { message: "Not authenticated" } };

  const { data, error } = await supabase
    .from("Alarm")
    .update(patch)
    .eq("id", alarmId)
    .eq("userId", userId)
    .select("*")
    .single();

  if (error) {
    console.error("Error updating alarm:", error);
  }

  return { data: data as AlarmRow | null, error };
};

export const deleteAlarm = async (alarmId: number) => {
  const userId = await getUserId();
  if (!userId) return { data: null, error: { message: "Not authenticated" } };

  const { error } = await supabase
    .from("Alarm")
    .delete()
    .eq("id", alarmId)
    .eq("userId", userId);

  if (error) {
    console.error("Error deleting alarm:", error);
  }

  return { data: null, error };
};

export const fetchMeasurements = async () => {
  const userId = await getUserId();
  if (!userId) return { data: null, error: { message: "Not authenticated" } };

  const { data, error } = await supabase
    .from("Measurement")
    .select("id, created_at, heartRate, tag, timeStamp, userId")
    .eq("userId", userId)
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("Error fetching measurements:", error);
  }

  return { data: (data as MeasurementRow[] | null) ?? null, error };
};

export type MeasurementRow = {
  id: number;
  created_at: string;
  heartRate: number;
  tag?: string | null;
  timeStamp: string;
  userId: number;
};

export const addMeasurement = async (
  heartRate: number,
  tag: string | null = null,
) => {
  const userId = await getUserId();
  if (!userId) {
    console.error("Cannot add measurement: User not authenticated");
    return { data: null, error: { message: "Not authenticated" } };
  }

  const timestamp = new Date().toISOString();

  const payload = {
    userId: userId,
    heartRate: heartRate,
    tag,
    timeStamp: timestamp,
    created_at: timestamp,
  };

  const { data, error } = await supabase
    .from("Measurement")
    .insert(payload)
    .select();

  if (error) {
    console.error("Error saving measurement:", error);
  }

  return { data, error };
};

export const updateMeasurementTag = async (
  measurementId: number,
  tag: string | null,
) => {
  const userId = await getUserId();
  if (!userId) return { data: null, error: { message: "Not authenticated" } };

  const { data, error } = await supabase
    .from("Measurement")
    .update({ tag })
    .eq("id", measurementId)
    .eq("userId", userId)
    .select()
    .single();

  if (error) {
    console.error("Error updating measurement tag:", error);
  }

  return { data: data as MeasurementRow | null, error };
};

export const getHeartRateStats = async () => {
  const userId = await getUserId();
  if (!userId) return { data: null, error: { message: "Not authenticated" } };

  const { data: readings, error } = await supabase
    .from("Measurement")
    .select("heartRate, created_at")
    .eq("userId", userId);

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
    bpms.reduce((sum: number, bpm: number) => sum + bpm, 0) / bpms.length,
  );
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weeklyReadings = readings.filter(
    (r: any) => new Date(r.created_at) >= weekAgo,
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

export type TagStat = {
  tag: string;
  count: number;
  avgBpm: number;
  minBpm: number;
  maxBpm: number;
};

export const getStatsByTag = async (): Promise<{
  data: TagStat[] | null;
  error: any;
}> => {
  const userId = await getUserId();
  if (!userId) return { data: null, error: { message: "Not authenticated" } };

  const { data, error } = await supabase
    .from("Measurement")
    .select("heartRate, tag")
    .eq("userId", userId);

  if (error || !data) {
    return { data: null, error };
  }

  const byTag: Record<string, number[]> = {};
  for (const row of data as { heartRate: number; tag: string | null }[]) {
    const key = row.tag && row.tag.trim().length > 0 ? row.tag : "Untagged";
    byTag[key] = byTag[key] ?? [];
    byTag[key].push(row.heartRate);
  }

  const stats: TagStat[] = Object.keys(byTag).map((tag) => {
    const values = byTag[tag];
    const avgBpm = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    return {
      tag,
      count: values.length,
      avgBpm,
      minBpm: Math.min(...values),
      maxBpm: Math.max(...values),
    };
  });

  stats.sort((a, b) => b.count - a.count);

  return { data: stats, error: null };
};

export const getWeeklyHeartRateSeries = async () => {
  const userId = await getUserId();
  if (!userId) return { data: null, error: { message: "Not authenticated" } };

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { data, error } = await supabase
    .from("Measurement")
    .select("heartRate, created_at")
    .eq("userId", userId)
    .gte("created_at", weekAgo.toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching weekly series:", error);
    return { data: null, error };
  }

  const byDay: Record<string, number[]> = {};
  for (const row of data ?? []) {
    const day = new Date(row.created_at).toISOString().slice(0, 10);
    byDay[day] = byDay[day] ?? [];
    byDay[day].push(row.heartRate);
  }

  const series = Object.keys(byDay)
    .sort()
    .map((day) => {
      const values = byDay[day];
      const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
      return { day, avg, count: values.length };
    });

  return { data: series, error: null };
};

export const deleteMeasurement = async (measurementId: number) => {
  const userId = await getUserId();
  if (!userId) {
    console.error("Cannot delete measurement: User not authenticated");
    return { data: null, error: { message: "Not authenticated" } };
  }

  const { data, error } = await supabase
    .from("Measurement")
    .delete()
    .eq("id", measurementId)
    .eq("userId", userId)
    .select();

  if (error) {
    console.error("Error deleting measurement:", error);
  } else {
    console.log("Measurement deleted successfully:", data);
  }

  return { data, error };
};

export type MeasurementDeleteRange = {
  start: Date;
  end: Date;
};

export const deleteMeasurements = async (range?: MeasurementDeleteRange) => {
  const userId = await getUserId();
  if (!userId) {
    console.error("Cannot delete measurements: User not authenticated");
    return { error: { message: "Not authenticated" } };
  }

  try {
    let query = supabase.from("Measurement").delete().eq("userId", userId);

    if (range) {
      query = query
        .gte("created_at", range.start.toISOString())
        .lte("created_at", range.end.toISOString());
    }

    const { error } = await query;
    if (error) {
      console.error("Error deleting measurements:", error);
      return { error };
    }

    return { error: null };
  } catch (error: any) {
    console.error("Exception deleting measurements:", error);
    return { error: { message: error?.message ?? "Unknown error" } };
  }
};
