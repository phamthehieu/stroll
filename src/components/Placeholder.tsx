import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function Placeholder({ title, note }: { title: string; note: string }) {
  const { top } = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: top + 24 }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, backgroundColor: "#fff" },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 8 },
  note: { fontSize: 16, color: "#666" },
});
