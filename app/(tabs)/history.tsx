import { PRESET_TAGS } from "@/components/HeartRateMonitor";
import {
  deleteMeasurement,
  deleteMeasurements,
  fetchMeasurements,
  updateMeasurementTag,
} from "@/lib/supabaseQueries";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect } from "@react-navigation/native";
import { File, Paths } from "expo-file-system";
import { LinearGradient } from "expo-linear-gradient";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface HistoryItem {
  id: number;
  created_at: string;
  heartRate: number;
  tag?: string | null;
  timeStamp: string;
  userId: number;
}

const UNTAGGED_KEY = "__untagged__";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CELL_SIZE = Math.floor((SCREEN_WIDTH - 48) / 7);

export default function History() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const insets = useSafeAreaInsets();

  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [activeRange, setActiveRange] = useState<{
    start: Date;
    end: Date;
  } | null>(null);

  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [tagFilterVisible, setTagFilterVisible] = useState(false);

  const [editingItem, setEditingItem] = useState<HistoryItem | null>(null);
  const [editTagValue, setEditTagValue] = useState<string | null>(null);
  const [editCustomTag, setEditCustomTag] = useState("");
  const [editCustomMode, setEditCustomMode] = useState(false);
  const [savingTag, setSavingTag] = useState(false);

  const availableTags = useMemo(() => {
    const set = new Set<string>(PRESET_TAGS);
    for (const h of history) {
      if (h.tag && h.tag.trim().length > 0) set.add(h.tag);
    }
    return Array.from(set);
  }, [history]);

  const filteredHistory = useMemo(() => {
    let result = history;
    if (activeRange) {
      const start = new Date(activeRange.start);
      start.setHours(0, 0, 0, 0);
      const end = new Date(activeRange.end);
      end.setHours(23, 59, 59, 999);
      result = result.filter((item) => {
        const d = new Date(item.created_at);
        return d >= start && d <= end;
      });
    }
    if (activeTagFilter) {
      if (activeTagFilter === UNTAGGED_KEY) {
        result = result.filter((item) => !item.tag || item.tag.trim() === "");
      } else {
        result = result.filter((item) => item.tag === activeTagFilter);
      }
    }
    return result;
  }, [history, activeRange, activeTagFilter]);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const handleDayPress = (day: Date) => {
    if (!rangeStart || rangeEnd) {
      // Start fresh selection
      setRangeStart(day);
      setRangeEnd(null);
    } else {
      // Complete the range
      if (day < rangeStart) {
        setRangeEnd(rangeStart);
        setRangeStart(day);
      } else {
        setRangeEnd(day);
      }
    }
  };

  const openCalendar = () => {
    if (activeRange) {
      setRangeStart(activeRange.start);
      setRangeEnd(activeRange.end);
      setCalendarMonth(
        new Date(
          activeRange.start.getFullYear(),
          activeRange.start.getMonth(),
          1,
        ),
      );
    } else {
      setCalendarMonth(new Date());
    }
    setCalendarVisible(true);
  };

  const applyRange = () => {
    if (rangeStart) {
      setActiveRange({ start: rangeStart, end: rangeEnd ?? rangeStart });
    }
    setCalendarVisible(false);
  };

  const clearRange = () => {
    setRangeStart(null);
    setRangeEnd(null);
    setActiveRange(null);
    setCalendarVisible(false);
  };

  const renderCalendarGrid = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay();

    const cells: (Date | null)[] = Array(firstDayOfWeek).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(year, month, d));
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const rows: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

    return rows.map((row, ri) => (
      <View key={ri} style={calStyles.weekRow}>
        {row.map((day, di) => {
          if (!day) return <View key={di} style={calStyles.dayCell} />;

          const isStart = !!rangeStart && isSameDay(day, rangeStart);
          const isEnd = !!rangeEnd && isSameDay(day, rangeEnd);
          const isSelected = isStart || isEnd;
          const isInRange =
            !!rangeStart && !!rangeEnd && day > rangeStart && day < rangeEnd;

          return (
            <TouchableOpacity
              key={di}
              onPress={() => handleDayPress(day)}
              style={[calStyles.dayCell, isInRange && calStyles.dayCellInRange]}
              activeOpacity={0.7}
            >
              <View
                style={[
                  calStyles.dayInner,
                  isSelected && calStyles.dayInnerSelected,
                ]}
              >
                <Text
                  style={[
                    calStyles.dayText,
                    isSelected && calStyles.dayTextSelected,
                    isInRange && calStyles.dayTextInRange,
                  ]}
                >
                  {day.getDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    ));
  };

  const formatRangeLabel = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const escapeCsvValue = (value: string) => {
    const needsQuotes =
      value.includes(",") || value.includes("\n") || value.includes('"');
    const escaped = value.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  };

  const shareFile = async (uri: string) => {
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri);
        return;
      }
    } catch (error) {
      console.log("expo-sharing failed, falling back to RN Share", error);
    }
    try {
      if (Platform.OS === "ios") {
        await Share.share({ url: uri });
      } else {
        await Share.share({ message: `File saved at: ${uri}`, url: uri });
      }
    } catch (error) {
      console.error("Share error:", error);
      Alert.alert("Export successful", `File saved to: ${uri}`);
    }
  };

  const exportAsCsv = async () => {
    try {
      const header = ["id", "created_at", "heartRate", "tag"].join(",");
      const rows = filteredHistory.map((h) =>
        [
          String(h.id),
          escapeCsvValue(new Date(h.created_at).toISOString()),
          String(h.heartRate),
          escapeCsvValue(h.tag ?? ""),
        ].join(","),
      );
      const fileName = `pulse_history_${Date.now()}.csv`;
      const file = new File(Paths.cache, fileName);
      file.create({ overwrite: true });
      file.write([header, ...rows].join("\n"));
      await shareFile(file.uri);
      Alert.alert("Success", "CSV file exported successfully");
    } catch (error) {
      console.error("Export CSV error:", error);
      const message =
        error instanceof Error ? error.message : "Could not export data as CSV";
      Alert.alert("Export failed", message);
    }
  };

  const exportAsPdf = async () => {
    try {
      const escapeHtml = (value: string) =>
        value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      const rowsHtml = filteredHistory
        .map((h) => {
          const date = new Date(h.created_at);
          const tag = h.tag ? escapeHtml(h.tag) : "";
          return `<tr><td>${date.toLocaleString()}</td><td style="text-align:right;">${h.heartRate}</td><td>${tag}</td></tr>`;
        })
        .join("");
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
        <style>
          body{font-family:sans-serif;padding:20px}
          h1{font-size:24px;color:#0d1321}
          table{width:100%;border-collapse:collapse;margin-top:8px}
          th,td{border-bottom:1px solid #ddd;padding:10px 8px;font-size:13px}
          th{background:#f5f5f5;font-weight:600}
        </style></head><body>
        <h1>Heart Rate History</h1>
        <p>Exported on ${new Date().toLocaleString()} · ${filteredHistory.length} readings</p>
        <table><thead><tr><th>Date/Time</th><th style="text-align:right;">BPM</th><th>Tag</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table></body></html>`;
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await shareFile(uri);
      Alert.alert("Success", "PDF file exported successfully");
    } catch (error) {
      console.error("Export PDF error:", error);
      const message =
        error instanceof Error ? error.message : "Could not export data as PDF";
      Alert.alert("Export failed", message);
    }
  };

  const handleExport = async () => {
    if (Platform.OS === "web") {
      Alert.alert(
        "Not supported",
        "Exporting is only available on iOS/Android.",
      );
      return;
    }
    if (filteredHistory.length === 0) {
      Alert.alert("Nothing to export", "No readings in the selected range.");
      return;
    }
    Alert.alert("Export data", "Choose a format:", [
      { text: "Cancel", style: "cancel" },
      { text: "CSV", onPress: () => void exportAsCsv() },
      { text: "PDF", onPress: () => void exportAsPdf() },
    ]);
  };

  const openEditTag = (item: HistoryItem) => {
    setEditingItem(item);
    const currentTag = item.tag ?? null;
    if (currentTag && !PRESET_TAGS.includes(currentTag)) {
      setEditCustomMode(true);
      setEditCustomTag(currentTag);
      setEditTagValue(null);
    } else {
      setEditCustomMode(false);
      setEditCustomTag("");
      setEditTagValue(currentTag);
    }
  };

  const closeEditTag = () => {
    setEditingItem(null);
    setEditTagValue(null);
    setEditCustomTag("");
    setEditCustomMode(false);
  };

  const saveEditTag = async (clear: boolean = false) => {
    if (!editingItem) return;
    let newTag: string | null = null;
    if (!clear) {
      if (editCustomMode) {
        const trimmed = editCustomTag.trim();
        newTag = trimmed.length > 0 ? trimmed : null;
      } else {
        newTag = editTagValue;
      }
    }
    setSavingTag(true);
    const { error } = await updateMeasurementTag(editingItem.id, newTag);
    setSavingTag(false);
    if (error) {
      Alert.alert("Error", "Could not update tag.");
      return;
    }
    setHistory((prev) =>
      prev.map((h) => (h.id === editingItem.id ? { ...h, tag: newTag } : h)),
    );
    closeEditTag();
  };

  const renderRightActions = (id: number) => (
    <View style={styles.swipeActions}>
      <View style={styles.swipeDeleteAction}>
        <MaterialIcons
          name="delete-forever"
          size={28}
          color="#f0ebd8"
          onPress={() => handleDelete(id)}
        />
        <Text style={styles.swipeDeleteText} onPress={() => handleDelete(id)}>
          Delete
        </Text>
      </View>
    </View>
  );

  const loadHistory = async () => {
    try {
      const { data, error } = await fetchMeasurements();
      if (error) {
        Alert.alert("Error", "Failed to load history. Please try again.");
        console.error("Error fetching measurements:", error);
      } else if (data) {
        setHistory(data);
      }
    } catch (error) {
      console.error("Error loading history:", error);
      Alert.alert("Error", "Failed to load history. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);
  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, []),
  );

  const handleDelete = async (id: number) => {
    Alert.alert(
      "Delete Measurement",
      "Are you sure you want to delete this measurement?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const { error } = await deleteMeasurement(id);
            if (error) {
              Alert.alert("Error", "Failed to delete measurement.");
            } else {
              loadHistory();
            }
          },
        },
      ],
    );
  };

  const handleDeleteAll = () => {
    if (filteredHistory.length === 0) {
      Alert.alert("Nothing to delete", "No readings to delete.");
      return;
    }

    const title = activeRange
      ? "Delete filtered history"
      : "Delete all history";
    const message = activeRange
      ? `Delete ${filteredHistory.length} reading${filteredHistory.length !== 1 ? "s" : ""} in the selected date range?`
      : `Delete all ${filteredHistory.length} reading${filteredHistory.length !== 1 ? "s" : ""}?`;

    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const range = activeRange
            ? (() => {
                const start = new Date(activeRange.start);
                start.setHours(0, 0, 0, 0);
                const end = new Date(activeRange.end);
                end.setHours(23, 59, 59, 999);
                return { start, end };
              })()
            : undefined;

          const { error } = await deleteMeasurements(range);
          if (error) {
            Alert.alert("Error", "Failed to delete records.");
          } else {
            loadHistory();
          }
        },
      },
    ]);
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

  const formatTime = (dateString: string) =>
    new Date(dateString).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

  const footerHeight = 80 + (insets.bottom || 12);

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <ActivityIndicator size="large" color="#748cab" />
        <Text style={styles.loadingText}>Loading history...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: footerHeight }}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={["#0d1321", "#1d2d44", "#3e5c76"]}
          style={[styles.header, { paddingTop: insets.top + 16 }]}
        >
          <View style={styles.headerContent}>
            <View style={styles.titleGroup}>
              <Ionicons name="time" size={28} color="#f0ebd8" />
              <Text style={styles.title}>History</Text>
            </View>
            <TouchableOpacity
              style={styles.exportIconBtn}
              onPress={handleExport}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="file-download" size={20} color="#f0ebd8" />
            </TouchableOpacity>
          </View>

          {activeRange || activeTagFilter ? (
            <View style={styles.filterActive}>
              {activeRange && (
                <>
                  <Ionicons name="calendar" size={14} color="#f0ebd8" />
                  <Text style={styles.filterActiveText}>
                    {formatRangeLabel(activeRange.start)}
                    {isSameDay(activeRange.start, activeRange.end)
                      ? ""
                      : ` – ${formatRangeLabel(activeRange.end)}`}
                  </Text>
                </>
              )}
              {activeTagFilter && (
                <View style={styles.filterTagPill}>
                  <Ionicons name="pricetag" size={12} color="#f0ebd8" />
                  <Text style={styles.filterTagPillText}>
                    {activeTagFilter === UNTAGGED_KEY
                      ? "Untagged"
                      : activeTagFilter}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setActiveTagFilter(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={12} color="#f0ebd8" />
                  </TouchableOpacity>
                </View>
              )}
              <Text style={styles.filterCount}>
                · {filteredHistory.length} reading
                {filteredHistory.length !== 1 ? "s" : ""}
              </Text>
              {activeRange && (
                <TouchableOpacity
                  onPress={clearRange}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={16} color="#f0ebd8" />
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <Text style={styles.subtitle}>
              {history.length} {history.length === 1 ? "reading" : "readings"}{" "}
              recorded
            </Text>
          )}

          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={openCalendar}
            >
              <Ionicons name="calendar-outline" size={16} color="#f0ebd8" />
              <Text style={styles.actionButtonText}>
                {activeRange ? "Change range" : "Filter date"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                activeTagFilter && styles.actionButtonActive,
              ]}
              onPress={() => setTagFilterVisible(true)}
            >
              <Ionicons name="pricetag-outline" size={16} color="#f0ebd8" />
              <Text style={styles.actionButtonText}>
                {activeTagFilter ? "Tag set" : "Filter tag"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                filteredHistory.length === 0 && { opacity: 0.5 },
              ]}
              onPress={handleDeleteAll}
              disabled={filteredHistory.length === 0}
            >
              <MaterialIcons name="delete-sweep" size={16} color="#f0ebd8" />
              <Text style={styles.actionButtonText}>Delete all</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <View style={styles.content}>
          {filteredHistory.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="stats-chart-outline" size={48} color="#3e5c76" />
              <Text style={styles.emptyTitle}>
                {activeRange ? "No readings in this range" : "No readings yet"}
              </Text>
              <Text style={styles.emptySubtitle}>
                {activeRange
                  ? "Try a different date range"
                  : "Start monitoring your heart rate to see your history"}
              </Text>
            </View>
          ) : (
            filteredHistory.map((item) => (
              <ReanimatedSwipeable
                key={item.id}
                overshootRight={false}
                renderRightActions={() => renderRightActions(item.id)}
              >
                <TouchableOpacity
                  onPress={() => openEditTag(item)}
                  activeOpacity={0.85}
                  style={styles.historyCard}
                >
                  <View style={styles.cardLeft}>
                    <Text style={styles.cardDate}>
                      {formatDate(item.created_at)}
                    </Text>
                    <Text style={styles.cardTime}>
                      {formatTime(item.created_at)}
                    </Text>
                    {item.tag ? (
                      <View style={styles.cardTag}>
                        <Ionicons name="pricetag" size={11} color="#f0ebd8" />
                        <Text style={styles.cardTagText}>{item.tag}</Text>
                      </View>
                    ) : (
                      <View style={[styles.cardTag, styles.cardTagEmpty]}>
                        <Ionicons
                          name="add-circle-outline"
                          size={11}
                          color="#748cab"
                        />
                        <Text style={styles.cardTagEmptyText}>
                          Add tag
                        </Text>
                      </View>
                    )}
                  </View>
                  <LinearGradient
                    colors={["#3e5c76", "#748cab"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.bpmBadge}
                  >
                    <Text style={styles.bpmValue}>{item.heartRate}</Text>
                    <Text style={styles.bpmLabel}>BPM</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </ReanimatedSwipeable>
            ))
          )}
        </View>
      </ScrollView>

      <Modal
        visible={calendarVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCalendarVisible(false)}
      >
        <TouchableOpacity
          style={calStyles.overlay}
          activeOpacity={1}
          onPress={() => setCalendarVisible(false)}
        />
        <View style={[calStyles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          {/* Month navigation */}
          <View style={calStyles.monthHeader}>
            <TouchableOpacity
              onPress={() =>
                setCalendarMonth(
                  (m) => new Date(m.getFullYear(), m.getMonth() - 1, 1),
                )
              }
              hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
            >
              <Ionicons name="chevron-back" size={22} color="#f0ebd8" />
            </TouchableOpacity>

            <Text style={calStyles.monthTitle}>
              {MONTH_NAMES[calendarMonth.getMonth()]}{" "}
              {calendarMonth.getFullYear()}
            </Text>

            <TouchableOpacity
              onPress={() =>
                setCalendarMonth(
                  (m) => new Date(m.getFullYear(), m.getMonth() + 1, 1),
                )
              }
              hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
            >
              <Ionicons name="chevron-forward" size={22} color="#f0ebd8" />
            </TouchableOpacity>
          </View>

          {/* Day-of-week headers */}
          <View style={calStyles.weekRow}>
            {DAY_HEADERS.map((d) => (
              <View key={d} style={calStyles.dayCell}>
                <Text style={calStyles.dayHeaderText}>{d}</Text>
              </View>
            ))}
          </View>

          {/* Day grid */}
          {renderCalendarGrid()}

          {/* Selection hint */}
          <Text style={calStyles.hint}>
            {!rangeStart
              ? "Tap a day to set start date"
              : !rangeEnd
                ? "Tap another day to set end date"
                : `${formatRangeLabel(rangeStart)} – ${formatRangeLabel(rangeEnd)}`}
          </Text>

          {/* Actions */}
          <View style={calStyles.actions}>
            <TouchableOpacity style={calStyles.clearBtn} onPress={clearRange}>
              <Text style={calStyles.clearBtnText}>Clear filter</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                calStyles.applyBtn,
                !rangeStart && calStyles.applyBtnDisabled,
              ]}
              onPress={applyRange}
              disabled={!rangeStart}
            >
              <Text style={calStyles.applyBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={tagFilterVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTagFilterVisible(false)}
      >
        <TouchableOpacity
          style={tagModalStyles.overlay}
          activeOpacity={1}
          onPress={() => setTagFilterVisible(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={tagModalStyles.sheet}
            onPress={() => {}}
          >
            <Text style={tagModalStyles.title}>Filter by tag</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <View style={tagModalStyles.chipsWrap}>
                <TouchableOpacity
                  onPress={() => {
                    setActiveTagFilter(null);
                    setTagFilterVisible(false);
                  }}
                  style={[
                    tagModalStyles.chip,
                    !activeTagFilter && tagModalStyles.chipActive,
                  ]}
                >
                  <Text style={tagModalStyles.chipText}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setActiveTagFilter(UNTAGGED_KEY);
                    setTagFilterVisible(false);
                  }}
                  style={[
                    tagModalStyles.chip,
                    activeTagFilter === UNTAGGED_KEY &&
                      tagModalStyles.chipActive,
                  ]}
                >
                  <Text style={tagModalStyles.chipText}>Untagged</Text>
                </TouchableOpacity>
                {availableTags.map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => {
                      setActiveTagFilter(t);
                      setTagFilterVisible(false);
                    }}
                    style={[
                      tagModalStyles.chip,
                      activeTagFilter === t && tagModalStyles.chipActive,
                    ]}
                  >
                    <Text style={tagModalStyles.chipText}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={!!editingItem}
        transparent
        animationType="fade"
        onRequestClose={closeEditTag}
      >
        <View style={tagModalStyles.overlay}>
          <View style={tagModalStyles.sheet}>
            <Text style={tagModalStyles.title}>Edit tag</Text>
            {editingItem && (
              <Text style={tagModalStyles.subtitle}>
                {editingItem.heartRate} BPM · {formatDate(editingItem.created_at)}{" "}
                {formatTime(editingItem.created_at)}
              </Text>
            )}

            {!editCustomMode ? (
              <View style={tagModalStyles.chipsWrap}>
                {PRESET_TAGS.map((t) => {
                  const active = editTagValue === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      onPress={() =>
                        setEditTagValue(active ? null : t)
                      }
                      style={[
                        tagModalStyles.chip,
                        active && tagModalStyles.chipActive,
                      ]}
                    >
                      <Text style={tagModalStyles.chipText}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  onPress={() => {
                    setEditCustomMode(true);
                    setEditTagValue(null);
                  }}
                  style={[tagModalStyles.chip, tagModalStyles.chipCustom]}
                >
                  <Ionicons name="add" size={14} color="#f0ebd8" />
                  <Text style={tagModalStyles.chipText}>Custom</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <TextInput
                  value={editCustomTag}
                  onChangeText={setEditCustomTag}
                  placeholder="Type a tag..."
                  placeholderTextColor="#748cab"
                  style={tagModalStyles.input}
                  maxLength={40}
                  autoFocus
                />
                <TouchableOpacity
                  onPress={() => {
                    setEditCustomMode(false);
                    setEditCustomTag("");
                  }}
                  style={tagModalStyles.backBtn}
                >
                  <Ionicons name="arrow-back" size={16} color="#748cab" />
                  <Text style={tagModalStyles.backBtnText}>
                    Back to suggestions
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={tagModalStyles.actions}>
              <TouchableOpacity
                onPress={() => void saveEditTag(true)}
                disabled={savingTag}
                style={tagModalStyles.clearBtn}
              >
                <Text style={tagModalStyles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={closeEditTag}
                disabled={savingTag}
                style={tagModalStyles.skipBtn}
              >
                <Text style={tagModalStyles.skipText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void saveEditTag(false)}
                disabled={savingTag}
                style={tagModalStyles.saveBtn}
              >
                <Text style={tagModalStyles.saveText}>
                  {savingTag ? "..." : "Save"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050000" },
  scrollView: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
    position: "relative",
  },
  titleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  exportIconBtn: {
    position: "absolute",
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#3e5c76",
    backgroundColor: "#0d1321",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: "#f0ebd8",
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 15,
    color: "#b8c5d6",
    textAlign: "center",
    fontWeight: "500",
  },
  filterActive: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  filterActiveText: {
    fontSize: 14,
    color: "#f0ebd8",
    fontWeight: "600",
  },
  filterCount: {
    fontSize: 14,
    color: "#b8c5d6",
  },
  filterTagPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#3e5c76",
  },
  filterTagPillText: {
    fontSize: 13,
    color: "#f0ebd8",
    fontWeight: "600",
  },
  actionButtonActive: {
    backgroundColor: "#3e5c76",
    borderColor: "#748cab",
  },
  headerActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3e5c76",
    backgroundColor: "#0d1321",
  },
  actionButtonText: {
    color: "#f0ebd8",
    fontSize: 13,
    fontWeight: "600",
  },
  content: { padding: 16 },
  historyCard: {
    backgroundColor: "#050000",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3e5c76",
    shadowColor: "#0d1321",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  cardLeft: { flex: 1 },
  cardDate: {
    fontSize: 16,
    fontWeight: "600",
    color: "#f0ebd8",
    marginBottom: 4,
  },
  cardTime: { fontSize: 14, color: "#748cab" },
  cardTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#3e5c76",
    marginTop: 8,
  },
  cardTagText: {
    fontSize: 12,
    color: "#f0ebd8",
    fontWeight: "600",
  },
  cardTagEmpty: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3e5c76",
    borderStyle: "dashed",
  },
  cardTagEmptyText: {
    fontSize: 12,
    color: "#748cab",
    fontWeight: "500",
  },
  bpmBadge: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 50,
    alignItems: "center",
    minWidth: 80,
  },
  bpmValue: { fontSize: 24, fontWeight: "bold", color: "#f0ebd8" },
  bpmLabel: { fontSize: 12, color: "#f0ebd8", marginTop: 2 },
  swipeActions: {
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  swipeDeleteAction: {
    width: 96,
    height: "100%",
    backgroundColor: "#920c0cff",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#28080eff",
  },
  swipeDeleteText: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: "#f0ebd8",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#f0ebd8",
    marginBottom: 8,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#748cab",
    textAlign: "center",
    paddingHorizontal: 40,
  },
  loadingText: { fontSize: 16, color: "#748cab", marginTop: 16 },
});

const calStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: "#0d1321",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  monthHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f0ebd8",
  },
  weekRow: {
    flexDirection: "row",
  },
  dayCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    justifyContent: "center",
    alignItems: "center",
  },
  dayCellInRange: {
    backgroundColor: "#1d2d44",
  },
  dayInner: {
    width: CELL_SIZE - 6,
    height: CELL_SIZE - 6,
    borderRadius: (CELL_SIZE - 6) / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  dayInnerSelected: {
    backgroundColor: "#3e5c76",
  },
  dayHeaderText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#748cab",
  },
  dayText: {
    fontSize: 15,
    color: "#f0ebd8",
    fontWeight: "400",
  },
  dayTextSelected: {
    color: "#f0ebd8",
    fontWeight: "700",
  },
  dayTextInRange: {
    color: "#b8c5d6",
  },
  hint: {
    textAlign: "center",
    fontSize: 13,
    color: "#748cab",
    marginTop: 14,
    marginBottom: 4,
    minHeight: 18,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  clearBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#3e5c76",
    alignItems: "center",
  },
  clearBtnText: {
    color: "#748cab",
    fontSize: 15,
    fontWeight: "600",
  },
  applyBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#3e5c76",
    alignItems: "center",
  },
  applyBtnDisabled: {
    opacity: 0.4,
  },
  applyBtnText: {
    color: "#f0ebd8",
    fontSize: 15,
    fontWeight: "700",
  },
});

const tagModalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#0d1321",
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: "#3e5c76",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f0ebd8",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: "#748cab",
    textAlign: "center",
    marginBottom: 14,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    marginBottom: 8,
    paddingVertical: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3e5c76",
    backgroundColor: "#050000",
  },
  chipActive: {
    backgroundColor: "#3e5c76",
    borderColor: "#748cab",
  },
  chipCustom: {
    borderStyle: "dashed",
  },
  chipText: {
    color: "#f0ebd8",
    fontSize: 13,
    fontWeight: "600",
  },
  input: {
    backgroundColor: "#050000",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3e5c76",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#f0ebd8",
    fontSize: 15,
    marginBottom: 8,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  backBtnText: {
    color: "#748cab",
    fontSize: 13,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  clearBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#920c0cff",
    alignItems: "center",
  },
  clearBtnText: {
    color: "#920c0cff",
    fontSize: 14,
    fontWeight: "600",
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3e5c76",
    alignItems: "center",
  },
  skipText: {
    color: "#748cab",
    fontSize: 14,
    fontWeight: "600",
  },
  saveBtn: {
    flex: 1.2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#3e5c76",
    alignItems: "center",
  },
  saveText: {
    color: "#f0ebd8",
    fontSize: 14,
    fontWeight: "700",
  },
});
