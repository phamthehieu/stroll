import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { Button, COLORS } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { localDay, shortDate, type RangeKind } from "@/lib/dates";
import { MAX_MEMBERS, inviteLink, useGroups } from "@/lib/groups";
import { supabase } from "@/lib/supabase";
import { FLAG_LABELS, useLeaderboard } from "@/lib/useLeaderboard";

const TABS: { kind: RangeKind; label: string; title: string }[] = [
  { kind: "day", label: "Ngày", title: "Xếp hạng hôm nay" },
  { kind: "week", label: "Tuần", title: "Xếp hạng tuần này" },
  { kind: "month", label: "Tháng", title: "Xếp hạng tháng này" },
];

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { groups, select, leave, remove } = useGroups();
  const group = groups.find((g) => g.id === id) ?? null;
  const [kind, setKind] = useState<RangeKind>("day");
  const { rows, error, range, reload } = useLeaderboard(group?.id ?? null, kind);
  const [busy, setBusy] = useState(false);
  const meId = session?.user.id;
  const isOwner = group?.owner_id === meId;

  if (!group) {
    return (
      <View style={styles.center}>
        <Text style={styles.note}>Không tìm thấy nhóm (có thể bạn đã rời hoặc nhóm đã bị xóa).</Text>
        <Button label="Về danh sách nhóm" variant="outline" onPress={() => router.back()} />
      </View>
    );
  }

  const g = group;
  const tab = TABS.find((t) => t.kind === kind) ?? TABS[0];
  const board = rows ? [...rows].sort((a, b) => b.total_steps - a.total_steps || a.display_name.localeCompare(b.display_name)) : null;

  function showFlags(name: string, flags: string[]) {
    Alert.alert(
      "Cần kiểm tra: " + name,
      flags.map((f) => "• " + (FLAG_LABELS[f] ?? f)).join("\n") +
        "\n\nĐây chỉ là cảnh báo tự động, có thể do thói quen đi bộ khác thường. Chủ nhóm có thể đặt lại số bước của ngày hôm nay.",
    );
  }

  function confirmReset(userId: string, name: string) {
    Alert.alert("Đặt lại số bước hôm nay?", `Số bước hôm nay của ${name} sẽ về 0 và không đồng bộ ghi đè lại được.`, [
      { text: "Hủy", style: "cancel" },
      {
        text: "Đặt lại",
        style: "destructive",
        onPress: async () => {
          const { error: e } = await supabase.rpc("owner_reset_steps", {
            gid: g.id,
            target: userId,
            p_day: localDay(),
          });
          if (e) Alert.alert("Lỗi", e.message);
          else reload();
        },
      },
    ]);
  }

  function onShare() {
    Share.share({
      message:
        `Vào nhóm "${g.name}" trên Stroll để đi bộ thi đua cùng mình!\n` +
        `Mã mời: ${g.invite_code}\n` +
        inviteLink(g.invite_code),
    }).catch(() => {});
  }

  function confirmLeave() {
    Alert.alert(isOwner ? "Xóa nhóm?" : "Rời nhóm?", isOwner ? "Cả nhóm sẽ bị xóa, không khôi phục được." : "Bạn có thể vào lại bằng mã mời.", [
      { text: "Hủy", style: "cancel" },
      {
        text: isOwner ? "Xóa nhóm" : "Rời nhóm",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            if (isOwner) await remove(g.id);
            else await leave(g.id);
            router.back();
          } catch (e) {
            setBusy(false);
            Alert.alert("Lỗi", e instanceof Error ? e.message : "Thử lại sau.");
          }
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.name}>{g.name}</Text>
      <Text style={styles.sub}>
        {board ? board.length : "…"}/{MAX_MEMBERS} thành viên
      </Text>

      <View style={styles.invite}>
        <Text style={styles.inviteLabel}>Mã mời</Text>
        <Text style={styles.inviteCode} selectable>
          {g.invite_code}
        </Text>
        <Button label="Chia sẻ lời mời" onPress={onShare} />
      </View>

      <Button
        label="Xem bảng xếp hạng"
        variant="outline"
        onPress={() => {
          select(g.id);
          router.dismissTo("/");
        }}
        style={{ marginTop: 12 }}
      />

      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable
            key={t.kind}
            style={[styles.tab, kind === t.kind && styles.tabOn]}
            onPress={() => setKind(t.kind)}
            accessibilityRole="tab"
            accessibilityState={{ selected: kind === t.kind }}
          >
            <Text style={[styles.tabText, kind === t.kind && styles.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.h2}>{tab.title}</Text>
      {kind !== "day" && (
        <Text style={styles.range}>
          {shortDate(range.from)} – {shortDate(range.to)}
        </Text>
      )}

      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : !board ? (
        <ActivityIndicator style={{ marginTop: 16 }} />
      ) : (
        board.map((m, i) => (
          <View key={m.user_id} style={styles.row}>
            <Text style={[styles.rank, i === 0 && m.total_steps > 0 && { color: COLORS.brand }]}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.member} numberOfLines={1}>
                {m.user_id === meId ? "Bạn" : m.display_name}
              </Text>
              {m.flags.length > 0 && (
                <Pressable onPress={() => showFlags(m.display_name, m.flags)} hitSlop={6}>
                  <Text style={styles.flag}>⚠ Cần kiểm tra</Text>
                </Pressable>
              )}
              {isOwner && kind === "day" && (
                <View style={{ flexDirection: "row", gap: 14 }}>
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: "/route", params: { user: m.user_id, name: m.display_name } })
                    }
                    hitSlop={6}
                  >
                    <Text style={styles.routeLink}>Xem lộ trình</Text>
                  </Pressable>
                  {m.user_id !== meId && m.total_steps > 0 && (
                    <Pressable onPress={() => confirmReset(m.user_id, m.display_name)} hitSlop={6}>
                      <Text style={styles.reset}>Đặt lại số bước hôm nay</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
            <Text style={styles.steps}>{m.total_steps.toLocaleString("vi-VN")}</Text>
          </View>
        ))
      )}

      <Button
        label={isOwner ? "Xóa nhóm" : "Rời nhóm"}
        variant="danger"
        onPress={confirmLeave}
        busy={busy}
        style={{ marginTop: 28 }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  note: { fontSize: 15, color: COLORS.muted, textAlign: "center" },
  name: { fontSize: 26, fontWeight: "800", color: COLORS.ink },
  sub: { fontSize: 14, color: COLORS.muted, marginTop: 2, marginBottom: 16 },
  invite: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 16,
    padding: 16,
    alignItems: "stretch",
    gap: 8,
  },
  inviteLabel: { fontSize: 13, color: COLORS.muted, textAlign: "center" },
  inviteCode: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 6,
    textAlign: "center",
    color: COLORS.ink,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: "#F1F3F7",
    borderRadius: 12,
    padding: 3,
    marginTop: 28,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  tabOn: { backgroundColor: "#fff" },
  tabText: { fontSize: 14, fontWeight: "600", color: COLORS.muted },
  tabTextOn: { color: COLORS.ink },
  h2: { fontSize: 18, fontWeight: "700", color: COLORS.ink, marginTop: 20 },
  range: { fontSize: 13, color: COLORS.muted, marginTop: 2, marginBottom: 4 },
  error: { color: COLORS.danger, marginTop: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.line,
  },
  rank: { width: 24, fontSize: 16, fontWeight: "700", color: COLORS.muted, textAlign: "center" },
  member: { fontSize: 16, fontWeight: "600", color: COLORS.ink },
  flag: { fontSize: 12, color: "#B45309", marginTop: 2 },
  reset: { fontSize: 12, color: COLORS.danger, marginTop: 2 },
  routeLink: { fontSize: 12, color: "#3D6BFF", marginTop: 2 },
  steps: { fontSize: 17, fontWeight: "700", color: COLORS.ink },
});
