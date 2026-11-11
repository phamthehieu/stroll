// Phân loại di chuyển trong ngày bằng cách đối chiếu GPS với số bước theo từng cửa sổ thời gian.
//
// Ý tưởng chính: độ dài mỗi bước. Đi bộ khoảng 0,5–0,9 m/bước, chạy nhanh khoảng 1–1,8 m/bước.
// Nếu GPS cho thấy quãng đường chia cho số bước vượt xa mức đó thì bước chân được đếm là do rung lắc
// trên phương tiện (hoặc đi xe đạp), không phải đi bộ, nên bị loại khỏi số bước.
//
// Các ngưỡng bên dưới là kinh nghiệm, chưa được hiệu chỉnh bằng dữ liệu thật của nhóm.

import type { Mode, StoredPoint } from "./route-store";

export const WINDOW_MIN = 3;
export const WINDOW_MS = WINDOW_MIN * 60 * 1000;
export const WINDOWS_PER_DAY = (24 * 60) / WINDOW_MIN; // 480
export const WINDOWS_PER_HOUR = 60 / WINDOW_MIN; // 20

const MAX_ACC_M = 50; // bỏ điểm sai số lớn khi tính quãng đường
const MAX_SEGMENT_GAP_S = 600; // hai điểm cách nhau quá 10 phút thì không nối
const MAX_PLAUSIBLE_SPEED = 70; // m/s (~250 km/h): trên mức này là nhảy vị trí do lỗi GPS

const STILL_SPEED = 0.3; // m/s
const RUN_SPEED = 2.2; // m/s
const FAST_SPEED = 4.0; // m/s (~14 km/h)
const SLOW_VEHICLE_SPEED = 2.0; // m/s (~7 km/h)
const FAST_STRIDE = 2.0; // m/bước
const SLOW_STRIDE = 2.4; // m/bước

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Đoạn nối hai điểm liên tiếp, đã lọc nhiễu. Dùng chung cho phân tích và thống kê trên màn hình lộ trình. */
export function segmentDistance(a: StoredPoint, b: StoredPoint): number {
  if (a.mocked || b.mocked) return 0;
  if ((a.acc ?? 0) > MAX_ACC_M || (b.acc ?? 0) > MAX_ACC_M) return 0;
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0 || dt > MAX_SEGMENT_GAP_S) return 0;
  const d = haversine(a.lat, a.lng, b.lat, b.lng);
  if (d / dt > MAX_PLAUSIBLE_SPEED) return 0;
  // Dịch chuyển nhỏ hơn sai số GPS thì coi là đứng yên.
  const noise = Math.max(3, 0.2 * ((a.acc ?? 10) + (b.acc ?? 10)));
  return d < noise ? 0 : d;
}

export type Analysis = {
  /** Mode của từng điểm (khóa là thời điểm t). */
  modes: Map<number, Mode>;
  /** Số bước đi xe trong từng cửa sổ (độ dài WINDOWS_PER_DAY). */
  vehicleSteps: number[];
};

/**
 * @param points      điểm GPS của một ngày, đã sắp theo thời gian
 * @param windowSteps số bước trong từng cửa sổ WINDOW_MIN phút của ngày (độ dài WINDOWS_PER_DAY)
 * @param dayStart    0 giờ của ngày (ms epoch, giờ địa phương)
 * @param now         thời điểm hiện tại (ms epoch), để cửa sổ đang diễn ra tính đúng độ dài
 */
export function analyzeDay(
  points: StoredPoint[],
  windowSteps: number[],
  dayStart: number,
  now: number,
): Analysis {
  const dist = new Array<number>(WINDOWS_PER_DAY).fill(0);
  const hasPts = new Array<boolean>(WINDOWS_PER_DAY).fill(false);
  const winOf = (t: number) => Math.floor((t - dayStart) / WINDOW_MS);

  let prev: StoredPoint | null = null;
  for (const p of points) {
    const w = winOf(p.t);
    if (w >= 0 && w < WINDOWS_PER_DAY && !p.mocked && (p.acc ?? 0) <= MAX_ACC_M) {
      hasPts[w] = true;
      if (prev) dist[w] += segmentDistance(prev, p);
      prev = p;
    }
  }

  const winMode = new Array<Mode>(WINDOWS_PER_DAY).fill("unknown");
  const vehicleSteps = new Array<number>(WINDOWS_PER_DAY).fill(0);

  for (let w = 0; w < WINDOWS_PER_DAY; w++) {
    if (!hasPts[w]) continue;
    const winStart = dayStart + w * WINDOW_MS;
    const lenS = Math.min(WINDOW_MS, now - winStart) / 1000;
    if (lenS < 30) continue;
    const steps = windowSteps[w] ?? 0;
    const v = dist[w] / lenS;

    if (v < STILL_SPEED) {
      winMode[w] = "still";
      continue;
    }
    const stride = steps > 0 ? dist[w] / steps : Infinity;
    if ((v >= FAST_SPEED && stride > FAST_STRIDE) || (v >= SLOW_VEHICLE_SPEED && stride > SLOW_STRIDE)) {
      winMode[w] = "vehicle";
      vehicleSteps[w] = steps;
    } else {
      winMode[w] = v >= RUN_SPEED ? "run" : "walk";
    }
  }

  const modes = new Map<number, Mode>();
  for (const p of points) {
    const w = winOf(p.t);
    modes.set(p.t, w >= 0 && w < WINDOWS_PER_DAY ? winMode[w] : "unknown");
  }
  return { modes, vehicleSteps };
}
