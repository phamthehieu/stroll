import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { MODE_COLORS, RouteMap } from "@/components/RouteMap";
import { Button, COLORS } from "@/components/ui";
import { segmentDistance } from "@/lib/analysis";
import { localDay } from "@/lib/dates";
import type { Mode, StoredPoint } from "@/lib/route-store";
import { supabase } from "@/lib/supabase";

type RouteRow = {
  t: string;
  lat: number;
  lng: number;
  acc: number | null;
  speed: number | null;
  mode: Mode;
  mocked: boolean;
};

type DayInfo = { steps: number; vehicle_steps: number; flags: string[] };

const MODE_LABELS: Record<Mode, string> = {
  walk: "Đi bộ",
  run: "Chạy",
  vehicle: "Đi xe / xe đạp",
  still: "Đứng yên",
  unknown: "Chưa xác định",
};

const fmtKm = (m: number) => (m / 1000).toFixed(2) + " km";
const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

export default function RouteScreen() {
  const { user, day: dayParam, name } = useLocalSearchParams<{ user: string; day?: string; name?: string }>();
  const day = dayParam ?? localDay();
  const { width } = useWindowDimensions();
  const [rows, setRows] = useState<RouteRow[] | null>(null);
  const [info, setInfo] = useState<DayInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([
        supabase.rpc("get_route", { target: user, p_day: day }),
        supabase
          .from("daily_steps")
          .select("steps, vehicle_steps, flags")
          .eq("user_id", user)
          .eq("day", day)
          .maybeSingle(),
      ]).then(([route, daily]) => {
        if (cancelled) return;
        if (route.error) {
          setError(route.error.message);
          return;
        }
        setError(null);
        setRows((route.data ?? []) as RouteRow[]);
        setInfo((daily.data as DayInfo | null) ?? null);
      });
      return () => {
        cancelled = true;
      };
    }, [user, day]),
  );

  const points = useMemo<StoredPoint[]>(
    () =>
      (rows ?? []).map((r) => ({
        t: Date.parse(r.t),
        lat: r.lat,
        lng: r.lng,
        acc: r.acc,
        speed: r.speed,
        mocked: r.mocked,
        mode: r.mode,
      })),
    [rows],
  );

  const stats = useMemo(() => {
    const dist: Record<Mode, number> = { walk: 0, run: 0, vehicle: 0, still: 0, unknown: 0 };
    let mocked = 0;
    for (let i = 0; i < points.length; i++) {
      if (points[i].mocked) mocked++;
      if (i > 0) dist[points[i].mode] += segmentDistance(points[i - 1], points[i]);
    }
    return { dist, mocked, total: dist.walk + dist.run + dist.vehicle + dist.unknown };
  }, [points]);

  const last = points[points.length - 1];
  const mapW = width - 40;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.title}>{name ? "Lộ trình của " + name : "Lộ trình của bạn"}</Text>
      <Text style={styles.sub}>{day}</Text>

      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : !rows ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : points.length === 0 ? (
        <Text style={styles.note}>
          Chưa có dữ liệu lộ trình cho ngày này. Cần bật “Ghi lộ trình” ở tab Hồ sơ; dữ liệu được gửi lên mỗi lần app
          đồng bộ.
        </Text>
      ) : (
        <>
          <RouteMap points={points} width={mapW} height={Math.min(380, mapW * 1.1)} />

          <View style={styles.legend}>
            {(["walk", "run", "vehicle", "still"] as Mode[]).map((m) => (
              <View key={m} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: MODE_COLORS[m] }]} />
                <Text style={styles.legendText}>{MODE_LABELS[m]}</Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.h2}>Tóm tắt</Text>
            <Text style={styles.line}>
              Thời gian ghi: {fmtTime(points[0].t)} – {fmtTime(last.t)} · {points.length} điểm
            </Text>
            <Text style={styles.line}>Tổng quãng đường: {fmtKm(stats.total)}</Text>
            {(["walk", "run", "vehicle"] as Mode[]).map((m) => (
              <Text key={m} style={styles.line}>
                <Text style={{ color: MODE_COLORS[m] }}>● </Text>
                {MODE_LABELS[m]}: {fmtKm(stats.dist[m])}
              </Text>
            ))}
            {info && (
              <>
                <Text style={[styles.line, { marginTop: 8 }]}>
                  Số bước được tính: {info.steps.toLocaleString("vi-VN")}
                </Text>
                {info.vehicle_steps > 0 && (
                  <Text style={styles.line}>
                    Số bước bị loại vì đang đi xe: {info.vehicle_steps.toLocaleString("vi-VN")}
                  </Text>
                )}
              </>
            )}
            {stats.mocked > 0 && (
              <Text style={[styles.line, { color: COLORS.danger }]}>
                ⚠ Có {stats.mocked} điểm vị trí giả (không được dùng để tính quãng đường).
              </Text>
            )}
          </View>

          <Button
            label="Mở điểm cuối trong Bản đồ"
            variant="outline"
            onPress={() => Linking.openURL(`geo:${last.lat},${last.lng}?q=${last.lat},${last.lng}`)}
            style={{ marginTop: 12 }}
          />
          <Text style={styles.hint}>
            Cách phân loại dựa trên độ dài mỗi bước (quãng đường GPS chia cho số bước trong từng 3 phút). Đây là ước
            lượng, có thể sai ở đoạn chuyển từ đi bộ sang đi xe.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  title: { fontSize: 24, fontWeight: "800", color: COLORS.ink },
  sub: { fontSize: 14, color: COLORS.muted, marginBottom: 14 },
  note: { fontSize: 15, color: COLORS.muted, marginTop: 12 },
  error: { color: COLORS.danger, marginTop: 12 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 13, color: COLORS.ink },
  card: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 16, marginTop: 16, gap: 4 },
  h2: { fontSize: 17, fontWeight: "700", color: COLORS.ink, marginBottom: 4 },
  line: { fontSize: 14, color: COLORS.ink },
  hint: { fontSize: 12, color: COLORS.muted, marginTop: 12 },
});
