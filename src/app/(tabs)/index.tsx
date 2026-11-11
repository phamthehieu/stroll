import { router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StepParade } from "@/blocks/step-parade/StepParade";
import { buildScene } from "@/blocks/step-parade/sp-data";
import { Button, COLORS } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { lastDays } from "@/lib/dates";
import { useGroups } from "@/lib/groups";
import { useHealth } from "@/lib/health";
import { useGroupSteps } from "@/lib/useGroupSteps";

export default function LeaderboardScreen() {
  const { top } = useSafeAreaInsets();
  const { session } = useAuth();
  const { groups, selected, loading } = useGroups();
  const { lastSync } = useHealth();
  const { rows, hourly, error } = useGroupSteps(selected?.id ?? null, lastSync);
  const meId = session?.user.id ?? "";

  const scene = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const n = new Date();
    return buildScene(rows, meId, lastDays(7, n), n.getHours() + n.getMinutes() / 60, hourly);
  }, [rows, hourly, meId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (groups.length === 0 || !selected) {
    return (
      <View style={[styles.center, { paddingTop: top }]}>
        <Text style={styles.title}>Bạn chưa có nhóm nào</Text>
        <Text style={styles.note}>Tạo nhóm mới hoặc nhập mã mời của bạn bè để bắt đầu thi đua.</Text>
        <Button label="Tạo hoặc tham gia nhóm" onPress={() => router.navigate("/groups")} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { paddingTop: top }]}>
        <Text style={styles.title}>Không tải được dữ liệu</Text>
        <Text style={styles.note}>{error}</Text>
      </View>
    );
  }

  if (!scene) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  // key đổi khi nhóm hoặc số bước đổi → dựng lại cảnh với dữ liệu mới.
  const key = selected.id + ":" + scene.friends.map((f) => f.id + "=" + f.total).join(",");
  return (
    <StepParade
      key={key}
      scene={scene}
      groupName={selected.name}
      onSwitchGroup={() => router.navigate("/groups")}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
    backgroundColor: COLORS.bg,
  },
  title: { fontSize: 20, fontWeight: "700", color: COLORS.ink, textAlign: "center" },
  note: { fontSize: 15, color: COLORS.muted, textAlign: "center", marginBottom: 8 },
});
