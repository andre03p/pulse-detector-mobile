import { supabase } from "./supabase";

export const getCurrentUser = async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
};

export const fetchUserData = async (tableName: string) => {
  const user = await getCurrentUser();
  if (!user) {
    return { data: null, error: { message: "User not authenticated" } };
  }

  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .eq("user_id", user.id);

  return { data, error };
};

export const insertUserData = async (tableName: string, data: any) => {
  const user = await getCurrentUser();
  if (!user) {
    return { data: null, error: { message: "User not authenticated" } };
  }

  const { data: result, error } = await supabase
    .from(tableName)
    .insert({ ...data, user_id: user.id })
    .select();

  return { data: result, error };
};

export const updateUserData = async (
  tableName: string,
  id: string,
  updates: any
) => {
  const user = await getCurrentUser();
  if (!user) {
    return { data: null, error: { message: "User not authenticated" } };
  }

  const { data, error } = await supabase
    .from(tableName)
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select();

  return { data, error };
};

export const deleteUserData = async (tableName: string, id: string) => {
  const user = await getCurrentUser();
  if (!user) {
    return { data: null, error: { message: "User not authenticated" } };
  }

  const { data, error } = await supabase
    .from(tableName)
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  return { data, error };
};
