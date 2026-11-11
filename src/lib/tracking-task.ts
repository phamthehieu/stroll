// Tác vụ nền nhận vị trí từ expo-location và lưu vào bộ nhớ máy.
// File này phải được import ở điểm vào của app (index.js) để tác vụ được định nghĩa ngay khi JS khởi động.
import type { LocationObject } from "expo-location";
import * as TaskManager from "expo-task-manager";

import { appendPoints } from "./route-store";

export const LOCATION_TASK = "stroll-route-tracking";

/** Bỏ điểm có sai số quá lớn (thường là vị trí theo mạng, không phải GPS). */
const MAX_ACCURACY_M = 150;

TaskManager.defineTask<{ locations: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations) return;
  const points = data.locations
    .filter((l) => (l.coords.accuracy ?? 0) <= MAX_ACCURACY_M)
    .map((l) => ({
      t: l.timestamp,
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      acc: l.coords.accuracy ?? null,
      speed: l.coords.speed ?? null,
      mocked: !!l.mocked,
    }));
  if (points.length > 0) await appendPoints(points);
});
