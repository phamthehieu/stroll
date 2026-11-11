import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";

export default function SignInScreen() {
  const { top } = useSafeAreaInsets();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setInfo(null);
    if (!email.trim() || password.length < 6) {
      setError("Nhập email và mật khẩu (tối thiểu 6 ký tự).");
      return;
    }
    if (mode === "up" && !name.trim()) {
      setError("Nhập tên hiển thị.");
      return;
    }
    setBusy(true);
    if (mode === "in") {
      const { error: e } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (e) setError(e.message);
    } else {
      const { data, error: e } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: name.trim() } },
      });
      if (e) setError(e.message);
      else if (!data.session) setInfo("Đã gửi email xác nhận. Hãy mở email rồi đăng nhập.");
    }
    setBusy(false);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: top + 48 }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.title}>Stroll</Text>
      <Text style={styles.sub}>Đi bộ cùng nhau, thi đua mỗi ngày</Text>

      {mode === "up" && (
        <TextInput
          style={styles.input}
          placeholder="Tên hiển thị"
          value={name}
          onChangeText={setName}
        />
      )}
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Mật khẩu"
        secureTextEntry
        autoCapitalize="none"
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={styles.error}>{error}</Text>}
      {info && <Text style={styles.info}>{info}</Text>}

      <Pressable style={[styles.button, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{mode === "in" ? "Đăng nhập" : "Tạo tài khoản"}</Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => {
          setMode(mode === "in" ? "up" : "in");
          setError(null);
          setInfo(null);
        }}
      >
        <Text style={styles.switch}>
          {mode === "in" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, backgroundColor: "#fff" },
  title: { fontSize: 40, fontWeight: "800", color: "#FF7A45" },
  sub: { fontSize: 16, color: "#666", marginBottom: 32 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#FF7A45",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  switch: { textAlign: "center", color: "#3D6BFF", marginTop: 20, fontSize: 15 },
  error: { color: "#D33", marginBottom: 4 },
  info: { color: "#22B573", marginBottom: 4 },
});
