import { router } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, COLORS } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { MAX_MEMBERS, useGroups } from "@/lib/groups";

export default function GroupsScreen() {
  const { top } = useSafeAreaInsets();
  const { session } = useAuth();
  const { groups, selected, select, create, join } = useGroups();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    if (!name.trim()) return setError("Nhập tên nhóm.");
    setError(null);
    setBusy("create");
    try {
      await create(name.trim());
      setName("");
      router.navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được nhóm.");
    }
    setBusy(null);
  }

  async function onJoin() {
    if (code.trim().length < 4) return setError("Nhập mã mời.");
    setError(null);
    setBusy("join");
    try {
      await join(code.trim());
      setCode("");
      router.navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tham gia được nhóm.");
    }
    setBusy(null);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ paddingTop: top + 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Nhóm của tôi</Text>

        {groups.length === 0 && (
          <Text style={styles.note}>Bạn chưa ở trong nhóm nào. Tạo nhóm mới hoặc nhập mã mời bên dưới.</Text>
        )}

        {groups.map((g) => {
          const on = selected?.id === g.id;
          return (
            <View key={g.id} style={[styles.card, on && styles.cardOn]}>
              <Pressable
                style={{ flex: 1 }}
                onPress={() => {
                  select(g.id);
                  router.navigate("/");
                }}
                accessibilityRole="button"
                accessibilityLabel={`Xem bảng xếp hạng nhóm ${g.name}`}
              >
                <Text style={styles.cardName} numberOfLines={1}>
                  {g.name}
                </Text>
                <Text style={styles.cardSub}>
                  {on ? "Đang xem" : "Bấm để xem xếp hạng"}
                  {g.owner_id === session?.user.id ? " · Chủ nhóm" : ""}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => router.push({ pathname: "/group/[id]", params: { id: g.id } })}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Chi tiết nhóm ${g.name}`}
              >
                <Text style={styles.detail}>Chi tiết ›</Text>
              </Pressable>
            </View>
          );
        })}

        <View style={styles.form}>
          <Text style={styles.h2}>Tạo nhóm mới</Text>
          <TextInput
            style={styles.input}
            placeholder="Tên nhóm (ví dụ: Team đi bộ)"
            value={name}
            onChangeText={setName}
            maxLength={60}
          />
          <Button label="Tạo nhóm" onPress={onCreate} busy={busy === "create"} disabled={busy !== null} />
        </View>

        <View style={styles.form}>
          <Text style={styles.h2}>Có mã mời?</Text>
          <TextInput
            style={[styles.input, styles.code]}
            placeholder="MÃ MỜI"
            autoCapitalize="characters"
            autoCorrect={false}
            value={code}
            onChangeText={setCode}
            maxLength={12}
          />
          <Button
            label="Tham gia nhóm"
            variant="outline"
            onPress={onJoin}
            busy={busy === "join"}
            disabled={busy !== null}
          />
          <Text style={styles.hint}>Mỗi nhóm tối đa {MAX_MEMBERS} người.</Text>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 20 },
  title: { fontSize: 28, fontWeight: "800", color: COLORS.ink, marginBottom: 12 },
  note: { fontSize: 15, color: COLORS.muted, marginBottom: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  cardOn: { borderColor: COLORS.brand, backgroundColor: "#FFF6F1" },
  cardName: { fontSize: 17, fontWeight: "700", color: COLORS.ink },
  cardSub: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  detail: { fontSize: 14, color: "#3D6BFF", fontWeight: "600" },
  form: { marginTop: 24, gap: 10 },
  h2: { fontSize: 18, fontWeight: "700", color: COLORS.ink },
  input: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  code: { letterSpacing: 4, fontWeight: "700", textAlign: "center" },
  hint: { fontSize: 13, color: COLORS.muted },
  error: { color: COLORS.danger, marginTop: 16, fontSize: 15 },
});
