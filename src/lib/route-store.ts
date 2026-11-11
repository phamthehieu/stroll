import AsyncStorage from "@react-native-async-storage/async-storage";

import { lastDays, localDay } from "./dates";

/** Cách di chuyển của một đoạn: still (đứng yên), walk, run, vehicle (xe máy, ô tô, xe đạp...), unknown (thiếu dữ liệu). */
export type Mode = "still" | "walk" | "run" | "vehicle" | "unknown";

export type StoredPoint = {
  /** Thời điểm (ms epoch) */
  t: number;
  lat: number;
  lng: number;
  acc: number | null;
  speed: number | null;
  mocked: boolean;
  mode: Mode;
  /** Mode đã gửi lên server (để chỉ gửi lại khi đổi). */
  up?: Mode;
};

export type RawPoint = Omit<StoredPoint, "mode" | "up">;

const PREFIX = "stroll.route.";
const KEEP_DAYS = 4;
const MAX_POINTS_PER_DAY = 6000; // giữ file nhỏ (AsyncStorage Android giới hạn ~2MB mỗi mục)

const keyOf = (day: string) => PREFIX + day;

export async function loadDay(day: string): Promise<StoredPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(keyOf(day));
    return raw ? (JSON.parse(raw) as StoredPoint[]) : [];
  } catch {
    return [];
  }
}

async function saveDay(day: string, points: StoredPoint[]): Promise<void> {
  const trimmed = points.length > MAX_POINTS_PER_DAY ? points.slice(points.length - MAX_POINTS_PER_DAY) : points;
  await AsyncStorage.setItem(keyOf(day), JSON.stringify(trimmed));
}

/** Thêm điểm mới (gọi từ tác vụ nền). Tự chia theo ngày địa phương, bỏ trùng thời điểm, giữ thứ tự. */
export async function appendPoints(points: RawPoint[]): Promise<void> {
  const byDay = new Map<string, RawPoint[]>();
  for (const p of points) {
    const day = localDay(new Date(p.t));
    const arr = byDay.get(day);
    if (arr) arr.push(p);
    else byDay.set(day, [p]);
  }
  for (const [day, add] of byDay) {
    const cur = await loadDay(day);
    const seen = new Set(cur.map((p) => p.t));
    for (const p of add) {
      if (!seen.has(p.t)) cur.push({ ...p, mode: "unknown" });
    }
    cur.sort((a, b) => a.t - b.t);
    await saveDay(day, cur);
  }
}

/** Cập nhật mode của các điểm đã có. Đọc lại dữ liệu mới nhất trước khi ghi để không mất điểm tác vụ nền vừa thêm. */
export async function applyModes(day: string, modes: Map<number, Mode>): Promise<StoredPoint[]> {
  const cur = await loadDay(day);
  for (const p of cur) {
    const m = modes.get(p.t);
    if (m) p.mode = m;
  }
  await saveDay(day, cur);
  return cur;
}

/** Ghi nhận các điểm đã gửi lên server cùng mode lúc gửi. */
export async function markUploaded(day: string, sent: Map<number, Mode>): Promise<void> {
  const cur = await loadDay(day);
  for (const p of cur) {
    const m = sent.get(p.t);
    if (m) p.up = m;
  }
  await saveDay(day, cur);
}

/** Xóa dữ liệu cục bộ cũ hơn KEEP_DAYS ngày (server vẫn giữ bản đã gửi). */
export async function pruneOld(): Promise<void> {
  try {
    const oldest = lastDays(KEEP_DAYS)[0];
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    const drop = keys.filter((k) => k.slice(PREFIX.length) < oldest);
    if (drop.length) await AsyncStorage.multiRemove(drop);
  } catch {
    // không quan trọng
  }
}
