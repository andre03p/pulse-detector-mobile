import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createAlarm as createAlarmRow,
  deleteAlarm as deleteAlarmRow,
  fetchAlarms,
  updateAlarm as updateAlarmRow,
} from "../../lib/supabaseQueries";
import {
  cancelAlarmNotification,
  registerForPushNotificationsAsync,
  scheduleAlarmNotification,
} from "../../utils/notifications";

type Alarm = {
  id: number;
  time: string;
  label: string;
  enabled: boolean;
  repeat: string[];
};

export default function AlarmRemindersApp() {
  const insets = useSafeAreaInsets();
  const [alarms, setAlarms] = useState<Alarm[]>([]);

  const [hydrated, setHydrated] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await fetchAlarms();
        if (error) {
          console.warn("Failed to fetch alarms", error);
          return;
        }

        const mapped: Alarm[] = (data ?? []).map((row) => ({
          id: row.id,
          time: row.time,
          label: row.label,
          enabled: row.enabled,
          repeat: row.repeat_days ?? [],
        }));

        if (!cancelled) {
          setAlarms(mapped);
        }
      } catch (e) {
        console.warn("Failed to load alarms", e);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await registerForPushNotificationsAsync();
      if (!cancelled) setNotificationsEnabled(Boolean(ok));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !notificationsEnabled) return;

    let cancelled = false;
    (async () => {
      for (const alarm of alarms) {
        if (cancelled) return;
        try {
          if (alarm.enabled) {
            await scheduleAlarmNotification(
              alarm.id,
              alarm.time,
              alarm.label,
              alarm.repeat,
            );
          } else {
            await cancelAlarmNotification(alarm.id);
          }
        } catch (e) {
          console.warn("Failed to sync alarm notification", { alarm, e });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [alarms, hydrated, notificationsEnabled]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newTime, setNewTime] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const addAlarm = () => {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(newTime)) {
      Alert.alert(
        "Invalid Time",
        "Please enter time in HH:MM format (e.g., 09:30)",
      );
      return;
    }

    if (!newLabel.trim()) {
      Alert.alert("Missing Label", "Please enter a label for this reminder");
      return;
    }

    (async () => {
      const { data, error } = await createAlarmRow({
        time: newTime,
        label: newLabel.trim(),
        enabled: true,
        repeat_days: selectedDays,
      });

      if (error || !data) {
        Alert.alert(
          "Error",
          error?.message || "Failed to create reminder. Please try again.",
        );
        return;
      }

      const created: Alarm = {
        id: data.id,
        time: data.time,
        label: data.label,
        enabled: data.enabled,
        repeat: data.repeat_days ?? [],
      };

      setAlarms((prev) => [...prev, created]);
      setNewTime("");
      setNewLabel("");
      setSelectedDays([]);
      setShowAddForm(false);

      Alert.alert("Success", "Reminder added and notification scheduled!");
    })();
  };

  const toggleAlarm = (id: number) => {
    let nextEnabled = false;
    setAlarms((prev) =>
      prev.map((alarm) => {
        if (alarm.id !== id) return alarm;
        nextEnabled = !alarm.enabled;
        return { ...alarm, enabled: nextEnabled };
      }),
    );

    (async () => {
      const { error } = await updateAlarmRow(id, { enabled: nextEnabled });
      if (error) {
        console.warn("Failed to update alarm", error);
      }
    })();
  };

  const deleteAlarm = (id: number) => {
    Alert.alert(
      "Delete Reminder",
      "Are you sure you want to delete this reminder?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            (async () => {
              await cancelAlarmNotification(id);
              const { error } = await deleteAlarmRow(id);
              if (error) {
                Alert.alert(
                  "Error",
                  error.message || "Failed to delete reminder.",
                );
                return;
              }
              setAlarms((prev) => prev.filter((alarm) => alarm.id !== id));
            })();
          },
        },
      ],
    );
  };

  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <LinearGradient
          colors={["#0d1321", "#1d2d44"]}
          style={[styles.header, { paddingTop: insets.top + 16 }]}
        >
          <View style={styles.headerContent}>
            <Ionicons name="notifications" size={28} color="#f0ebd8" />
            <Text style={styles.headerTitle}>Reminders</Text>
            <TouchableOpacity
              onPress={() => setShowAddForm(!showAddForm)}
              style={styles.addButton}
            >
              <Ionicons
                name={showAddForm ? "close" : "add"}
                size={24}
                color="#f0ebd8"
              />
            </TouchableOpacity>
          </View>
          <Text style={styles.headerSubtitle}>
            Set reminders to measure your heart rate
          </Text>
        </LinearGradient>
        {/* Add Alarm Form */}
        {showAddForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>New Reminder</Text>

            <Text style={styles.inputLabel}>Time (HH:MM)</Text>
            <TextInput
              value={newTime}
              onChangeText={setNewTime}
              placeholder="e.g., 08:00"
              placeholderTextColor="#748cab"
              maxLength={5}
              style={styles.input}
            />

            <Text style={styles.inputLabel}>Label</Text>
            <TextInput
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="e.g., Morning heart rate check"
              placeholderTextColor="#748cab"
              style={styles.input}
            />

            <Text style={styles.inputLabel}>Repeat on</Text>
            <View style={styles.daysContainer}>
              {days.map((day) => (
                <TouchableOpacity
                  key={day}
                  onPress={() => toggleDay(day)}
                  style={[
                    styles.dayButton,
                    selectedDays.includes(day) && styles.dayButtonActive,
                  ]}
                >
                  <Text
                    style={
                      selectedDays.includes(day)
                        ? styles.dayTextActive
                        : styles.dayText
                    }
                  >
                    {day}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.formButtons}>
              <TouchableOpacity onPress={addAlarm} style={styles.primaryButton}>
                <LinearGradient
                  colors={["#3e5c76", "#748cab"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradientButton}
                >
                  <Text style={styles.primaryButtonText}>Add Reminder</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setShowAddForm(false);
                  setNewTime("");
                  setNewLabel("");
                  setSelectedDays([]);
                }}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Alarms List */}
        <View style={styles.listContainer}>
          {alarms.map((alarm) => (
            <View
              key={alarm.id}
              style={[
                styles.alarmCard,
                !alarm.enabled && styles.alarmCardDisabled,
              ]}
            >
              <View style={styles.alarmContent}>
                <View style={styles.alarmInfo}>
                  <View style={styles.timeRow}>
                    <Ionicons name="time" size={20} color="#748cab" />
                    <Text style={styles.timeText}>{alarm.time}</Text>
                  </View>
                  <Text style={styles.labelText}>{alarm.label}</Text>
                  {alarm.repeat.length > 0 ? (
                    <Text style={styles.repeatText}>
                      {alarm.repeat.join(", ")}
                    </Text>
                  ) : (
                    <Text style={styles.repeatText}>Once</Text>
                  )}
                </View>
                <View style={styles.alarmActions}>
                  <Switch
                    value={alarm.enabled}
                    onValueChange={() => toggleAlarm(alarm.id)}
                    trackColor={{ false: "#748cab40", true: "#748cab" }}
                    thumbColor={alarm.enabled ? "#f0ebd8" : "#f0ebd880"}
                    ios_backgroundColor="#748cab40"
                  />
                  <TouchableOpacity
                    onPress={() => deleteAlarm(alarm.id)}
                    style={styles.deleteButton}
                  >
                    <Ionicons name="trash-outline" size={22} color="#e63946" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}

          {alarms.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons
                name="notifications-outline"
                size={80}
                color="#748cab40"
              />
              <Text style={styles.emptyStateTitle}>No reminders set</Text>
              <Text style={styles.emptyStateSubtitle}>
                Tap the + button to add a reminder for your heart rate
                measurements
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050000",
  },
  scrollView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#f0ebd8",
  },
  addButton: {
    backgroundColor: "#748cab",
    borderRadius: 20,
    padding: 8,
  },
  headerSubtitle: {
    color: "#748cab",
    fontSize: 14,
    textAlign: "center",
  },
  formCard: {
    backgroundColor: "#1d2d44",
    margin: 16,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#3e5c76",
  },
  formTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
    color: "#f0ebd8",
  },
  inputLabel: {
    fontSize: 14,
    color: "#748cab",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(116, 140, 171, 0.3)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    color: "#f0ebd8",
    backgroundColor: "#0d1321",
    fontSize: 16,
  },
  daysContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  dayButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: "#0d1321",
    borderColor: "#3e5c76",
  },
  dayButtonActive: {
    backgroundColor: "#748cab",
    borderColor: "#748cab",
  },
  dayText: {
    color: "#748cab",
  },
  dayTextActive: {
    color: "#f0ebd8",
    fontWeight: "600",
  },
  formButtons: {
    gap: 12,
  },
  primaryButton: {
    borderRadius: 12,
    overflow: "hidden",
  },
  gradientButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#f0ebd8",
    textAlign: "center",
    fontWeight: "600",
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: "#1d2d44",
    borderWidth: 1,
    borderColor: "rgba(116, 140, 171, 0.3)",
    borderRadius: 12,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: "#748cab",
    textAlign: "center",
    fontWeight: "600",
    fontSize: 16,
  },
  listContainer: {
    padding: 16,
  },
  alarmCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#3e5c76",
  },
  alarmCardDisabled: {
    opacity: 0.5,
  },
  alarmContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  alarmInfo: {
    flex: 1,
    marginRight: 12,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  timeText: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginLeft: 8,
  },
  labelText: {
    color: "#f0ebd8",
    fontSize: 16,
    marginBottom: 4,
  },
  repeatText: {
    fontSize: 14,
    color: "#748cab",
    marginTop: 4,
  },
  alarmActions: {
    alignItems: "flex-end",
    gap: 12,
  },
  deleteButton: {
    marginTop: 4,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
    paddingHorizontal: 24,
  },
  emptyStateTitle: {
    color: "#748cab",
    fontSize: 18,
    marginTop: 16,
    textAlign: "center",
  },
  emptyStateSubtitle: {
    color: "#748cab",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
});
