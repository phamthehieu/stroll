import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button, COLORS } from "@/components/ui";
import { MAX_MEMBERS, useGroups } from "@/lib/groups";

export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { join } = useGroups();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onJoin() {
    setBusy(true);
    setError(null);
    try {
      await join(String(code));
      router.dismissTo("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tham gia được nhóm.");
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.label}>Bạn được mời vào nhóm với mã</Text>
      <Text style={styles.code}>{String(code).toUpperCase()}</Text>
      <Text style={styles.hint}>Mỗi nhóm tối đa {MAX_MEMBERS} người.</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Tham gia nhóm" onPress={onJoin} busy={busy} style={{ alignSelf: "stretch" }} />
      <Button
        label="Để sau"
        variant="outline"
        onPress={() => router.dismissTo("/")}
        disabled={busy}
        style={{ alignSelf: "stretch" }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: COLORS.bg },
  label: { fontSize: 16, color: COLORS.muted },
  code: { fontSize: 40, fontWeight: "800", letterSpacing: 6, color: COLORS.ink },
  hint: { fontSize: 13, color: COLORS.muted, marginBottom: 12 },
  error: { color: COLORS.danger, textAlign: "center" },
});
