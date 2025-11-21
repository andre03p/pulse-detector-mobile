import { supabase } from "./supabase";

export const testSupabaseConnection = async () => {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || supabaseUrl.includes("your-project")) {
    console.error("❌ EXPO_PUBLIC_SUPABASE_URL not configured");
    return false;
  }

  if (!supabaseKey || supabaseKey.includes("your-anon-key")) {
    console.error("❌ EXPO_PUBLIC_SUPABASE_ANON_KEY not configured");
    return false;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error("❌ Connection failed:", error.message);
    return false;
  }

  console.log("✅ Supabase connected");
  return true;
};
