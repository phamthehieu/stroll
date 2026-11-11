import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { rangeFor, type RangeKind } from "./dates";
import { supabase } from "./supabase";

export type LeaderRow = {
  user_id: string;
  display_name: string;
  total_steps: number;
  /** Cờ cảnh báo của các ngày trong khoảng (xem FLAG_LABELS). */
  flags: string[];
};

export const FLAG_LABELS: Record<string, string> = {
  hour_high: "Có giờ đi quá nhiều bước bất thường",
  night: "Nhiều bước vào lúc rạng sáng (0–5h)",
  untrusted_origin: "Dữ liệu đến từ ứng dụng ngoài danh sách tin cậy",
  decreased: "Số bước trong ngày giảm bất thường",
  mock_location: "Phát hiện vị trí giả trong lộ trình",
};

/** Bảng xếp hạng của nhóm theo ngày / tuần / tháng; tải lại mỗi khi màn hình được mở. */
export function useLeaderboard(groupId: string | null, kind: RangeKind) {
  const [data, setData] = useState<{ key: string; rows: LeaderRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = groupId + ":" + kind;

  const load = useCallback(async () => {
    if (!groupId) return;
    const { from, to } = rangeFor(kind);
    const { data: res, error: e } = await supabase.rpc("group_leaderboard", {
      gid: groupId,
      from_day: from,
      to_day: to,
    });
    if (e) {
      setError(e.message);
      return;
    }
    setError(null);
    const rows = ((res ?? []) as LeaderRow[]).map((r) => ({
      ...r,
      total_steps: Number(r.total_steps),
      flags: r.flags ?? [],
    }));
    setData({ key: groupId + ":" + kind, rows });
  }, [groupId, kind]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Không hiện dữ liệu của tab/nhóm trước trong lúc đang tải tab mới.
  return { rows: data && data.key === key ? data.rows : null, error, range: rangeFor(kind), reload: load };
}
