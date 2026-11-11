import { Stack } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/lib/auth";
import { GroupsProvider } from "@/lib/groups";
import { HealthProvider } from "@/lib/health";
import { resumeTrackingIfEnabled } from "@/lib/tracking";

function RootStack() {
  const { session, loading } = useAuth();
  const signedIn = !!session;

  // Đã bật ghi lộ trình mà dịch vụ nền bị hệ thống tắt thì bật lại khi mở app.
  useEffect(() => {
    if (signedIn) void resumeTrackingIfEnabled();
  }, [signedIn]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="group/[id]"
          options={{ headerShown: true, title: "Nhóm", headerBackTitle: "Quay lại" }}
        />
        <Stack.Screen
          name="route"
          options={{ headerShown: true, title: "Lộ trình", headerBackTitle: "Quay lại" }}
        />
        <Stack.Screen
          name="join/[code]"
          options={{ presentation: "modal", headerShown: true, title: "Tham gia nhóm" }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <GroupsProvider>
            <HealthProvider>
              <RootStack />
            </HealthProvider>
          </GroupsProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
