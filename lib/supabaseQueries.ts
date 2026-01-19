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

    // create new user profile with auth_uuid (no password - managed by Supabase Auth)
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
    .select("*")
    .eq("userId", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Error fetching measurements:", error);
  }

  return { data, error };
};

export const addMeasurement = async (heartRate: number) => {
  const userId = await getUserId();
  if (!userId) {
    console.error("Cannot add measurement: User not authenticated");
    return { data: null, error: { message: "Not authenticated" } };
  }

  const timestamp = new Date().toISOString();

  console.log("Saving measurement:", {
    userId: userId,
    heartRate,
    timestamp,
  });

  const { data, error } = await supabase
    .from("Measurement")
    .insert({
      userId: userId,
      heartRate: heartRate,
      timeStamp: timestamp,
      created_at: timestamp,
    })
    .select();

  if (error) {
    console.error("Error saving measurement:", error);
  } else {
    console.log("Measurement saved successfully:", data);
  }

  return { data, error };
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
