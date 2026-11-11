// Step Parade — dựng "cảnh" từ số bước thật của nhóm.
//
// Hiện database chỉ có TỔNG bước mỗi ngày, nên dạng đường cong trong ngày (ai đi sáng, ai đi tối)
// được sinh giả lập và cố định theo id người dùng, rồi co giãn để khớp đúng tổng bước thật.
// Khi có dữ liệu theo giờ từ HealthKit / Health Connect (M2) chỉ cần thay phần sinh đường cong.

export type Friend = {
  id: string;
  name: string;
  /** Tổng bước hôm nay */
  total: number;
  coat: string;
  hat: string;
  skin: string;
  /** activity peaks: [hour, weight, width] */
  peaks: [number, number, number][];
  /** Làn đi trong cảnh (0 = xa nhất); -1 = không hiển thị trong cảnh (chỉ tính vào xếp hạng) */
  lane: number;
};

export type WeekDay = { d: string; steps: number; win: number };

export type Scene = {
  friends: Friend[];
  curves: number[][];
  /** Chỉ số của bạn trong friends */
  me: number;
  /** Giờ hiện tại trong ngày, nằm trong [H0, H1] */
  now: number;
  /** Số bước ứng với cuối đường đi trong cảnh */
  max: number;
  /** Số làn đang dùng */
  lanes: number;
  week: WeekDay[];
};

export type StepRow = {
  user_id: string;
  display_name: string;
  day: string;
  steps: number;
};

export type HourRow = { user_id: string; hour: number; steps: number };

export const H0 = 6; // ngày trong cảnh chạy từ 06:00 → 22:00
export const H1 = 22;
export const SAMPLES = 65; // mỗi 15 phút
export const MAX_LANES = 6;

const COATS = ["#3D6BFF", "#FF7A45", "#FFC83D", "#22B573", "#A764FF", "#2A3142", "#E5486B", "#14A3C7"];
const HATS = ["#FF5A4E", "#FFD23F", "#3D6BFF", "#1F2A44", "#FF8FC8", "#FF9F2E", "#5BD0A0", "#F5F1E8"];
const SKINS = ["#F2C3A0", "#E8B48E", "#C98E66", "#8D5A3B", "#F5D1B5", "#E3A77F"];

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const PEAK_WINDOWS: [number, number][] = [
  [6.5, 9],
  [11.5, 14],
  [17, 20.5],
];

const makePeaks = (id: string): [number, number, number][] => {
  const r = rng(hashStr(id));
  const order = [0, 1, 2].sort(() => r() - 0.5);
  const n = 1 + Math.floor(r() * 2.99); // 1..3 đỉnh
  return order.slice(0, n).map((w) => {
    const [a, b] = PEAK_WINDOWS[w];
    return [a + r() * (b - a), 0.4 + r() * 0.6, 0.6 + r() * 1.2] as [number, number, number];
  });
};

const makeCurve = (peaks: [number, number, number][], total: number, now: number) => {
  const rate: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const h = H0 + ((H1 - H0) * i) / (SAMPLES - 1);
    let r = 0.04;
    for (const [c, w, s] of peaks) r += w * Math.exp(-((h - c) * (h - c)) / (2 * s * s));
    rate.push(r);
  }
  const cum: number[] = [0];
  for (let i = 1; i < SAMPLES; i++) cum.push(cum[i - 1] + (rate[i - 1] + rate[i]) / 2);
  // Co giãn để tại "bây giờ" đường cong đúng bằng tổng bước thật.
  const u = ((now - H0) / (H1 - H0)) * (SAMPLES - 1);
  const k = Math.min(SAMPLES - 2, Math.floor(u));
  const atNow = cum[k] + (cum[k + 1] - cum[k]) * (u - k);
  const factor = atNow > 0 ? total / atNow : 0;
  return cum.map((v) => v * factor);
};

/**
 * Đường cong thật từ số bước theo giờ (24 giá trị, giờ địa phương).
 * Giờ đang diễn ra được nội suy tới "bây giờ"; từ "bây giờ" trở đi giữ phẳng ở tổng bước
 * (gồm cả các giờ sau 22h nếu có), nên giá trị tại "bây giờ" luôn đúng bằng tổng thật.
 */
const makeCurveHourly = (hourly: number[], total: number, now: number) => {
  const nowHour = Math.floor(now);
  const curve: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const h = H0 + ((H1 - H0) * i) / (SAMPLES - 1);
    if (h >= now) {
      curve.push(total);
      continue;
    }
    const k = Math.floor(h);
    let c = 0;
    for (let j = 0; j < k; j++) c += hourly[j] ?? 0;
    const end = k === nowHour ? now : k + 1;
    const frac = end > k ? Math.min(1, Math.max(0, (h - k) / (end - k))) : 1;
    curve.push(c + (hourly[k] ?? 0) * frac);
  }
  return curve;
};

const DAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const shortName = (s: string) => {
  const t = s.trim() || "?";
  return t.length > 9 ? t.slice(0, 8) + "…" : t;
};

/**
 * @param rows  kết quả `group_daily_steps` (mọi thành viên × mọi ngày)
 * @param days  7 ngày liên tiếp (YYYY-MM-DD), ngày cuối là hôm nay
 */
export function buildScene(
  rows: StepRow[],
  meId: string,
  days: string[],
  hourNow: number,
  hourlyRows: HourRow[] = [],
): Scene {
  const today = days[days.length - 1];
  const now = Math.min(H1, Math.max(H0 + 1, hourNow));

  // Số bước theo giờ của hôm nay cho từng người.
  const hourlyBy = new Map<string, number[]>();
  for (const r of hourlyRows) {
    let a = hourlyBy.get(r.user_id);
    if (!a) {
      a = new Array<number>(24).fill(0);
      hourlyBy.set(r.user_id, a);
    }
    if (r.hour >= 0 && r.hour < 24) a[r.hour] = r.steps;
  }

  const byUser = new Map<string, { name: string; perDay: Map<string, number> }>();
  for (const r of rows) {
    let u = byUser.get(r.user_id);
    if (!u) {
      u = { name: r.display_name, perDay: new Map() };
      byUser.set(r.user_id, u);
    }
    u.perDay.set(r.day, r.steps);
  }

  const members = [...byUser.entries()]
    .map(([id, u]) => ({ id, name: u.name, total: u.perDay.get(today) ?? 0, perDay: u.perDay }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  // Chọn tối đa MAX_LANES người vào cảnh: top theo bước, luôn có bạn.
  const shown = new Set(members.slice(0, MAX_LANES).map((m) => m.id));
  if (!shown.has(meId) && byUser.has(meId)) {
    shown.delete(members[MAX_LANES - 1].id);
    shown.add(meId);
  }
  let lane = 0;
  const friends: Friend[] = members.map((m) => {
    const peaks = makePeaks(m.id);
    const h = hashStr(m.id);
    return {
      id: m.id,
      name: m.id === meId ? "Bạn" : shortName(m.name),
      total: m.total,
      coat: COATS[h % COATS.length],
      hat: HATS[(h >>> 4) % HATS.length],
      skin: SKINS[(h >>> 8) % SKINS.length],
      peaks,
      lane: shown.has(m.id) ? lane++ : -1,
    };
  });

  const me = Math.max(0, friends.findIndex((f) => f.id === meId));
  // Có dữ liệu theo giờ khớp đúng tổng thì dùng dữ liệu thật, không thì dựng giả lập từ tổng bước.
  const curves = friends.map((f) => {
    const hr = hourlyBy.get(f.id);
    if (hr && f.total > 0 && hr.reduce((a, b) => a + b, 0) === f.total) {
      return makeCurveHourly(hr, f.total, now);
    }
    return makeCurve(f.peaks, f.total, now);
  });

  const week: WeekDay[] = days.map((day) => {
    const date = new Date(day + "T12:00:00");
    let win = -1;
    let best = 0;
    members.forEach((m) => {
      const v = m.perDay.get(day) ?? 0;
      if (v > best) {
        best = v;
        win = friends.findIndex((f) => f.id === m.id);
      }
    });
    return { d: DAY_LABELS[date.getDay()], steps: best, win };
  });

  const leader = Math.max(0, ...friends.map((f) => f.total));
  const max = Math.max(6000, Math.ceil((leader * 1.15) / 1000) * 1000);

  return { friends, curves, me, now, max, lanes: lane, week };
}
