/** Ngày theo giờ địa phương của máy, định dạng YYYY-MM-DD. */
export function localDay(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

export type RangeKind = "day" | "week" | "month";

/** Khoảng ngày của bảng xếp hạng: hôm nay / tuần này (từ thứ Hai) / tháng này (từ mùng 1). */
export function rangeFor(kind: RangeKind, now: Date = new Date()): { from: string; to: string } {
  const to = localDay(now);
  if (kind === "day") return { from: to, to };
  if (kind === "month") {
    return { from: localDay(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  }
  const sinceMonday = (now.getDay() + 6) % 7; // Thứ Hai = 0
  return { from: localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday)), to };
}

/** "2026-11-09" → "09/11" */
export const shortDate = (day: string) => day.slice(8, 10) + "/" + day.slice(5, 7);

/** n ngày liên tiếp kết thúc ở hôm nay, cũ nhất trước. */
export function lastDays(n: number, end: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    out.push(localDay(d));
  }
  return out;
}
