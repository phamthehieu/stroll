import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState, Linking, Platform } from "react-native";
import {
  RecordingMethod,
  SdkAvailabilityStatus,
  aggregateGroupByDuration,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
} from "react-native-health-connect";

import { WINDOWS_PER_DAY, WINDOWS_PER_HOUR, WINDOW_MIN, WINDOW_MS, analyzeDay } from "./analysis";
import { useAuth } from "./auth";
import { lastDays, localDay } from "./dates";
import { applyModes, loadDay, markUploaded, pruneOld, type Mode } from "./route-store";
import { supabase } from "./supabase";

/**
 * Android: đọc số bước từ Health Connect.
 * iOS: chưa hỗ trợ (HealthKit làm ở bước sau).
 */
export type HealthStatus =
  | "checking"
  | "unsupported" // iOS hoặc nền tảng khác
  | "missing" // chưa cài Health Connect (Android 13 trở xuống)
  | "update" // Health Connect cần cập nhật
  | "needs-permission" // chưa cấp quyền đọc bước chân
  | "ready";

/** Số bước theo từng nguồn (tên gói ứng dụng) trong hôm nay. */
export type Origins = Record<string, number>;

const PLAY_STORE_URL = "market://details?id=com.google.android.apps.healthdata";
const SYNC_DAYS = 3; // đồng bộ lại cả 2 ngày trước phòng khi đồng hồ đồng bộ muộn

async function checkStatus(): Promise<HealthStatus> {
  if (Platform.OS !== "android") return "unsupported";
  const sdk = await getSdkStatus();
  if (sdk === SdkAvailabilityStatus.SDK_UNAVAILABLE) return "missing";
  if (sdk === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update";
  await initialize();
  const granted = await getGrantedPermissions();
  return granted.some((p) => p.recordType === "Steps" && p.accessType === "read")
    ? "ready"
    : "needs-permission";
}

type DayData = { windows: number[]; origins: Origins };

/**
 * Số bước tự động ghi nhận trong một ngày, chia theo từng cửa sổ WINDOW_MIN phút (giờ địa phương).
 * - Từng cửa sổ lấy từ aggregateGroupByDuration: Health Connect tự loại trùng giữa điện thoại và đồng hồ.
 * - Aggregate vẫn gồm số bước người dùng gõ tay, nên trừ đi các bản ghi nhập tay (chia theo tỉ lệ thời gian
 *   rơi vào từng cửa sổ). Nếu bản ghi nhập tay đè lên dữ liệu tự động thì có thể trừ hơi dư: nghiêng về phía
 *   thiệt cho người dùng chứ không để lọt gian lận.
 * - origins: số bước theo từng ứng dụng nguồn (không tính nhập tay), để server gắn cờ nguồn lạ.
 */
async function readDay(start: Date, end: Date): Promise<DayData> {
  const timeRangeFilter = {
    operator: "between" as const,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
  const t0 = start.getTime();
  const raw = new Array<number>(WINDOWS_PER_DAY).fill(0);

  const buckets = await aggregateGroupByDuration({
    recordType: "Steps",
    timeRangeFilter,
    timeRangeSlicer: { duration: "MINUTES", length: WINDOW_MIN },
  });
  for (const b of buckets) {
    const w = Math.floor((new Date(b.startTime).getTime() - t0) / WINDOW_MS);
    if (w >= 0 && w < WINDOWS_PER_DAY) raw[w] += b.result.COUNT_TOTAL ?? 0;
  }

  const origins: Origins = {};
  const manual = new Array<number>(WINDOWS_PER_DAY).fill(0);
  let pageToken: string | undefined;
  do {
    const res = await readRecords("Steps", { timeRangeFilter, pageSize: 1000, pageToken });
    for (const r of res.records) {
      if (r.metadata?.recordingMethod === RecordingMethod.RECORDING_METHOD_MANUAL_ENTRY) {
        const rs = new Date(r.startTime).getTime();
        const re = new Date(r.endTime).getTime();
        if (re <= rs) {
          const w = Math.floor((rs - t0) / WINDOW_MS);
          if (w >= 0 && w < WINDOWS_PER_DAY) manual[w] += r.count;
          continue;
        }
        const first = Math.max(0, Math.floor((rs - t0) / WINDOW_MS));
        const last = Math.min(WINDOWS_PER_DAY - 1, Math.floor((re - t0) / WINDOW_MS));
        for (let w = first; w <= last; w++) {
          const overlap = Math.min(re, t0 + (w + 1) * WINDOW_MS) - Math.max(rs, t0 + w * WINDOW_MS);
          if (overlap > 0) manual[w] += (r.count * overlap) / (re - rs);
        }
      } else {
        const o = r.metadata?.dataOrigin ?? "unknown";
        origins[o] = (origins[o] ?? 0) + r.count;
      }
    }
    pageToken = res.pageToken || undefined;
  } while (pageToken);

  return {
    windows: raw.map((v, w) => Math.max(0, Math.round(v - manual[w]))),
    origins,
  };
}

/** Gom các cửa sổ thành 24 giờ. */
function toHourly(windows: number[]): number[] {
  const out = new Array<number>(24).fill(0);
  for (let w = 0; w < windows.length; w++) out[Math.floor(w / WINDOWS_PER_HOUR)] += windows[w];
  return out.map((v) => Math.round(v));
}

/** Cập nhật mode cho các điểm lộ trình trong máy rồi gửi những điểm mới hoặc đổi mode lên server. */
async function uploadRoute(day: string, modes: Map<number, Mode>): Promise<void> {
  const cur = await applyModes(day, modes);
  const pending = cur.filter((p) => p.up !== p.mode);
  for (let i = 0; i < pending.length; i += 1500) {
    const chunk = pending.slice(i, i + 1500);
    const { error } = await supabase.rpc("submit_route", {
      p_day: day,
      p_points: chunk.map((p) => ({
        t: p.t,
        lat: p.lat,
        lng: p.lng,
        acc: p.acc,
        speed: p.speed,
        mode: p.mode,
        mocked: p.mocked,
      })),
    });
    if (error) throw new Error(error.message);
    await markUploaded(day, new Map(chunk.map((p) => [p.t, p.mode])));
  }
}

/**
 * Đọc số bước vài ngày gần nhất, đối chiếu với lộ trình GPS để loại bước khi đi xe, rồi gửi lên server
 * (hàm submit_steps kiểm tra rồi mới ghi). Trả về nguồn của hôm nay.
 */
async function syncDays(): Promise<Origins> {
  const now = new Date();
  const today = localDay(now);
  let todayOrigins: Origins = {};
  for (const day of lastDays(SYNC_DAYS)) {
    const [y, m, d] = day.split("-").map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const next = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
    const { windows, origins } = await readDay(start, next < now ? next : now);

    const points = await loadDay(day);
    const analysis = analyzeDay(points, windows, start.getTime(), now.getTime());
    if (points.length > 0) await uploadRoute(day, analysis.modes);

    const { error } = await supabase.rpc("submit_steps", {
      p_day: day,
      p_hourly: toHourly(windows),
      p_origins: origins,
      p_source: "health_connect",
      p_vehicle: toHourly(analysis.vehicleSteps),
    });
    if (error) throw new Error(error.message);
    if (day === today) todayOrigins = origins;
  }
  void pruneOld();
  return todayOrigins;
}

type HealthState = {
  status: HealthStatus;
  syncing: boolean;
  lastSync: Date | null;
  error: string | null;
  /** Nguồn dữ liệu bước chân của hôm nay (lần đồng bộ gần nhất). */
  origins: Origins;
  /** Xin quyền (hoặc mở trang cài Health Connect) rồi đồng bộ. */
  connect: () => Promise<void>;
  syncNow: () => Promise<void>;
  openSettings: () => void;
};

const Ctx = createContext<HealthState | null>(null);

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Không đồng bộ được số bước.");

export function HealthProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const uid = session?.user.id ?? null;
  const [status, setStatus] = useState<HealthStatus>(Platform.OS === "android" ? "checking" : "unsupported");
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origins, setOrigins] = useState<Origins>({});

  // Tự kiểm tra và đồng bộ khi đăng nhập và mỗi lần mở lại app.
  useEffect(() => {
    if (Platform.OS !== "android" || !uid) return;
    let cancelled = false;

    const run = () => {
      checkStatus()
        .then(async (s) => {
          if (cancelled) return;
          setStatus(s);
          if (s !== "ready") return;
          setSyncing(true);
          try {
            const o = await syncDays();
            if (!cancelled) {
              setOrigins(o);
              setLastSync(new Date());
              setError(null);
            }
          } catch (e) {
            if (!cancelled) setError(errMsg(e));
          } finally {
            if (!cancelled) setSyncing(false);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(errMsg(e));
        });
    };

    run();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") run();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [uid]);

  const syncNow = useCallback(async () => {
    if (!uid) return;
    setSyncing(true);
    try {
      setOrigins(await syncDays());
      setLastSync(new Date());
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
    setSyncing(false);
  }, [uid]);

  const connect = useCallback(async () => {
    try {
      let s = await checkStatus();
      if (s === "missing" || s === "update") {
        await Linking.openURL(PLAY_STORE_URL);
        return;
      }
      if (s === "needs-permission") {
        await requestPermission([{ accessType: "read", recordType: "Steps" }]);
        s = await checkStatus();
      }
      setStatus(s);
      if (s === "ready") await syncNow();
    } catch (e) {
      setError(errMsg(e));
    }
  }, [syncNow]);

  const value = useMemo<HealthState>(
    () => ({
      status,
      syncing,
      lastSync,
      error,
      origins,
      connect,
      syncNow,
      openSettings: () => {
        if (Platform.OS === "android") openHealthConnectSettings();
      },
    }),
    [status, syncing, lastSync, error, origins, connect, syncNow],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHealth(): HealthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHealth phải nằm trong HealthProvider");
  return v;
}
