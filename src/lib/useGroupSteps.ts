import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { lastDays } from "./dates";
import { supabase } from "./supabase";
import type { HourRow, StepRow } from "@/blocks/step-parade/sp-data";

type Loaded = { gid: string; rows: StepRow[]; hourly: HourRow[] };

/**
 * Số bước của mọi thành viên trong 7 ngày gần nhất + số bước theo giờ của hôm nay.
 * Tự tải lại mỗi khi màn hình được mở.
 */
export function useGroupSteps(groupId: string | null, refreshKey?: unknown) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!groupId) return;
    const days = lastDays(7);
    const [daily, hourly] = await Promise.all([
      supabase.rpc("group_daily_steps", { gid: groupId, from_day: days[0], to_day: days[6] }),
      supabase.rpc("group_hourly_steps", { gid: groupId, p_day: days[6] }),
    ]);
    const e = daily.error ?? hourly.error;
    if (e) {
      setError(e.message);
      return;
    }
    setError(null);
    setData({
      gid: groupId,
      rows: (daily.data ?? []) as StepRow[],
      hourly: (hourly.data ?? []) as HourRow[],
    });
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      // refreshKey đổi (ví dụ vừa đồng bộ xong) thì callback đổi theo và tải lại.
      void refreshKey;
      load();
    }, [load, refreshKey]),
  );

  // Không trả dữ liệu của nhóm cũ khi vừa đổi nhóm.
  const ok = data && data.gid === groupId ? data : null;
  return { rows: ok?.rows ?? null, hourly: ok?.hourly ?? [], error, reload: load };
}
