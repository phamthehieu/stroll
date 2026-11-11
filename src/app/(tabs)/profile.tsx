import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, COLORS } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useHealth } from "@/lib/health";
import { supabase } from "@/lib/supabase";
import { isTrackingActive, startTracking, stopTracking } from "@/lib/tracking";

const ORIGIN_LABELS: Record<string, string> = {
  android: "Hệ thống Android",
  "com.sec.android.app.shealth": "Samsung Health",
  "com.google.android.apps.fitness": "Google Fit",
  "com.google.android.gms": "Google Play services",
  "com.fitbit.FitbitMobile": "Fitbit",
  "com.garmin.android.apps.connectmobile": "Garmin Connect",
  "com.xiaomi.hm.health": "Zepp / Mi Fit",
  "com.huawei.health": "Huawei Health",
};

export default function ProfileScreen() {
  const { top } = useSafeAreaInsets();
  const { session } = useAuth();
  const user = session?.user;
  const health = useHealth();
  const metaName = (user?.user_metadata?.display_name as string | undefined) ?? "Bạn";
  const [name, setName] = useState(metaName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Tên hiển thị hiện tại lấy từ bảng profiles (nguồn mà cả nhóm nhìn thấy).
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.display_name) setName(data.display_name);
      });
  }, [user]);

  async function saveName() {
    if (!user) return;
    const n = name.trim();
    if (n.length < 1 || n.length > 30) {
      setNameMsg({ ok: false, text: "Tên từ 1 đến 30 ký tự." });
      return;
    }
    setNameBusy(true);
    setNameMsg(null);
    const { error } = await supabase.from("profiles").update({ display_name: n }).eq("id", user.id);
    if (!error) await supabase.auth.updateUser({ data: { display_name: n } });
    setNameBusy(false);
    setNameMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Đã đổi tên." });
  }

  const [tracking, setTracking] = useState(false);
  const [trackBusy, setTrackBusy] = useState(false);
  const [trackMsg, setTrackMsg] = useState<string | null>(null);

  useEffect(() => {
    isTrackingActive().then(setTracking);
  }, []);

  async function toggleTracking() {
    setTrackBusy(true);
    setTrackMsg(null);
    try {
      if (tracking) {
        await stopTracking();
        setTracking(false);
      } else {
        const r = await startTracking();
        setTracking(r !== "denied");
        if (r === "denied") setTrackMsg("Cần cấp quyền vị trí để ghi lộ trình.");
        if (r === "limited") {
          setTrackMsg(
            "Mới cấp quyền khi đang dùng app. Để ghi cả khi tắt màn hình, vào Cài đặt → Ứng dụng → Stroll → Vị trí → chọn “Luôn cho phép”.",
          );
        }
      }
    } catch (e) {
      setTrackMsg(e instanceof Error ? e.message : "Không bật được ghi lộ trình.");
    }
    setTrackBusy(false);
  }

  const sources = Object.entries(health.origins).sort((a, b) => b[1] - a[1]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: top + 24, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{name}</Text>
      <Text style={styles.email}>{user?.email}</Text>

      <View style={[styles.card, { marginBottom: 16 }]}>
        <Text style={styles.h2}>Tên hiển thị</Text>
        <Text style={styles.hint}>Các thành viên trong nhóm sẽ thấy tên này.</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          maxLength={30}
          placeholder="Tên của bạn"
        />
        <Button label="Lưu tên" variant="outline" onPress={saveName} busy={nameBusy} />
        {nameMsg && <Text style={[styles.msg, { color: nameMsg.ok ? "#22B573" : COLORS.danger }]}>{nameMsg.text}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Số bước tự động</Text>
        {health.status === "unsupported" && (
          <Text style={styles.hint}>Đồng bộ tự động chưa hỗ trợ trên iPhone, sẽ có ở bản sau.</Text>
        )}
        {health.status === "checking" && <Text style={styles.hint}>Đang kiểm tra Health Connect…</Text>}
        {(health.status === "missing" || health.status === "update") && (
          <>
            <Text style={styles.hint}>
              {health.status === "missing"
                ? "Máy chưa có Health Connect. Cài ứng dụng này để Stroll đọc số bước từ Samsung Health, Google Fit hoặc đồng hồ của bạn."
                : "Health Connect cần được cập nhật để dùng được."}
            </Text>
            <Button label="Mở Google Play" onPress={health.connect} />
          </>
        )}
        {health.status === "needs-permission" && (
          <>
            <Text style={styles.hint}>
              Cho phép Stroll đọc số bước từ Health Connect. Số bước bạn tự nhập tay trong các ứng dụng khác sẽ không được tính.
            </Text>
            <Button label="Kết nối Health Connect" onPress={health.connect} />
          </>
        )}
        {health.status === "ready" && (
          <>
            <Text style={styles.hint}>
              {health.lastSync
                ? "Đã kết nối · đồng bộ lúc " +
                  health.lastSync.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
                : "Đã kết nối Health Connect."}
            </Text>
            {sources.length > 0 && (
              <View style={{ gap: 2 }}>
                <Text style={styles.hint}>Nguồn dữ liệu hôm nay:</Text>
                {sources.map(([pkg, n]) => (
                  <Text key={pkg} style={styles.source}>
                    • {ORIGIN_LABELS[pkg] ?? pkg}: {Math.round(n).toLocaleString("vi-VN")} bước
                    {ORIGIN_LABELS[pkg] ? "" : "  (nguồn lạ, sẽ bị gắn cờ)"}
                  </Text>
                ))}
              </View>
            )}
            <Button label="Đồng bộ ngay" variant="outline" onPress={health.syncNow} busy={health.syncing} />
            <Button label="Quản lý quyền" variant="outline" onPress={health.openSettings} />
          </>
        )}
        {health.error && <Text style={[styles.msg, { color: COLORS.danger }]}>{health.error}</Text>}
      </View>

      <View style={[styles.card, { marginTop: 16 }]}>
        <Text style={styles.h2}>Lộ trình di chuyển</Text>
        <Text style={styles.hint}>
          Ghi vị trí GPS trong ngày để xác minh số bước và loại bỏ số bước khi bạn đi xe. Lộ trình chỉ bạn và chủ nhóm
          xem được.
        </Text>
        <Text style={styles.hint}>
          {tracking
            ? "Đang ghi lộ trình (có thông báo “Stroll đang ghi lộ trình” trên thanh trạng thái)."
            : "Chưa ghi lộ trình."}
        </Text>
        <Button
          label={tracking ? "Tắt ghi lộ trình" : "Bật ghi lộ trình"}
          variant={tracking ? "outline" : "primary"}
          onPress={toggleTracking}
          busy={trackBusy}
        />
        <Button
          label="Xem lộ trình hôm nay"
          variant="outline"
          onPress={() => user && router.push({ pathname: "/route", params: { user: user.id, name: name } })}
        />
        {trackMsg && <Text style={[styles.msg, { color: COLORS.danger }]}>{trackMsg}</Text>}
      </View>

      <Button
        label="Đăng xuất"
        variant="danger"
        onPress={() => supabase.auth.signOut()}
        style={{ marginTop: 24 }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, backgroundColor: COLORS.bg },
  title: { fontSize: 28, fontWeight: "700", color: COLORS.ink },
  email: { fontSize: 16, color: COLORS.muted, marginBottom: 24 },
  card: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 16, gap: 10 },
  h2: { fontSize: 17, fontWeight: "700", color: COLORS.ink },
  hint: { fontSize: 13, color: COLORS.muted },
  source: { fontSize: 13, color: COLORS.ink },
  input: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  msg: { fontSize: 14 },
});
