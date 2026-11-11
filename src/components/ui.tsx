import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";

export const COLORS = {
  brand: "#FF7A45",
  ink: "#1B1E26",
  muted: "#6B7280",
  line: "#E3E7EE",
  danger: "#D33",
  bg: "#fff",
};

type ButtonProps = {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "outline" | "danger";
  style?: ViewStyle;
};

export function Button({ label, onPress, busy, disabled, variant = "primary", style }: ButtonProps) {
  const off = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={[styles.btn, variant === "primary" ? styles.primary : styles.outline, off && { opacity: 0.55 }, style]}
      accessibilityRole="button"
    >
      {busy ? (
        <ActivityIndicator color={variant === "primary" ? "#fff" : COLORS.ink} />
      ) : (
        <Text
          style={[
            styles.btnText,
            variant === "primary" && { color: "#fff" },
            variant === "danger" && { color: COLORS.danger },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center" },
  primary: { backgroundColor: COLORS.brand },
  outline: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: "#fff" },
  btnText: { fontSize: 16, fontWeight: "700", color: COLORS.ink },
});
