import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotificationsAsync() {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF231F7C",
      });
    }

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.warn("Notification permissions not granted");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error requesting notification permissions:", error);
    return false;
  }
}

export async function scheduleAlarmNotification(
  alarmId: number,
  time: string,
  label: string,
  repeatDays: string[],
) {
  const [hours, minutes] = time.split(":").map(Number);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new Error(`Invalid time format: ${time}`);
  }

  await cancelAlarmNotification(alarmId);

  const dayMap: { [key: string]: number } = {
    Sun: 1,
    Mon: 2,
    Tue: 3,
    Wed: 4,
    Thu: 5,
    Fri: 6,
    Sat: 7,
  };

  const content: Notifications.NotificationContentInput = {
    title: "Heart Rate Reminder",
    body: label,
    sound: true,
    priority: Notifications.AndroidNotificationPriority.HIGH,
  };

  const androidChannel =
    Platform.OS === "android" ? { channelId: "default" } : {};

  if (repeatDays.length === 0) {
    const triggerDate = new Date();
    triggerDate.setHours(hours, minutes, 0, 0);

    if (triggerDate < new Date()) {
      triggerDate.setDate(triggerDate.getDate() + 1);
    }

    await Notifications.scheduleNotificationAsync({
      identifier: `alarm-${alarmId}-once`,
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        ...androidChannel,
      },
    });
    return;
  }

  const uniqueDays = Array.from(new Set(repeatDays));
  await Promise.all(
    uniqueDays
      .map((day) => dayMap[day])
      .filter((weekday): weekday is number => typeof weekday === "number")
      .map((weekday) =>
        Notifications.scheduleNotificationAsync({
          identifier: `alarm-${alarmId}-w${weekday}`,
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday,
            hour: hours,
            minute: minutes,
            ...androidChannel,
          },
        }),
      ),
  );
}

export async function cancelAlarmNotification(alarmId: number) {
  const scheduledNotifications =
    await Notifications.getAllScheduledNotificationsAsync();

  for (const notification of scheduledNotifications) {
    if (
      notification.identifier === `alarm-${alarmId}` ||
      notification.identifier.startsWith(`alarm-${alarmId}-`)
    ) {
      await Notifications.cancelScheduledNotificationAsync(
        notification.identifier,
      );
    }
  }
}

export async function getAllScheduledNotifications() {
  return await Notifications.getAllScheduledNotificationsAsync();
}

export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
