import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

import { LOCATION_TASK } from "./tracking-task";

const PREF_KEY = "stroll.trackingEnabled";

export type StartResult =
  | "ok" // đã cấp quyền cả khi dùng app và nền
  | "limited" // chỉ cấp quyền khi đang dùng app: vẫn ghi được nhưng có thể bị hệ thống ngắt
  | "denied";

export async function getTrackingPref(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREF_KEY)) === "1";
  } catch {
    return false;
  }
}

async function setTrackingPref(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    // không quan trọng
  }
}

export async function isTrackingActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

async function begin(): Promise<void> {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 20000, // tối thiểu 20 giây giữa hai lần cập nhật (Android)
    distanceInterval: 15, // và di chuyển ít nhất 15 m
    foregroundService: {
      notificationTitle: "Stroll đang ghi lộ trình",
      notificationBody: "Dùng để xác minh số bước chân của bạn trong ngày.",
      notificationColor: "#FF7A45",
    },
  });
}

/** Xin quyền vị trí rồi bắt đầu ghi lộ trình. */
export async function startTracking(): Promise<StartResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return "denied";
  const bg = await Location.requestBackgroundPermissionsAsync();
  await begin();
  await setTrackingPref(true);
  return bg.status === "granted" ? "ok" : "limited";
}

export async function stopTracking(): Promise<void> {
  await setTrackingPref(false);
  if (await isTrackingActive()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

/** Gọi khi mở app: nếu người dùng đã bật ghi lộ trình mà dịch vụ nền đã bị tắt thì bật lại. */
export async function resumeTrackingIfEnabled(): Promise<void> {
  try {
    if (!(await getTrackingPref())) return;
    if (await isTrackingActive()) return;
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") return;
    await begin();
  } catch {
    // Android không cho khởi động dịch vụ nền từ nền: bỏ qua, lần mở app sau sẽ thử lại.
  }
}
