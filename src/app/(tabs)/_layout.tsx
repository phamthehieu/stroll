import { Tabs } from "expo-router";

import { KubaiIcon, type KubaiIconName } from "@/components/kubai/KubaiIcon";

function tabIcon(name: KubaiIconName) {
  return function TabIcon({ focused, size }: { focused: boolean; size: number }) {
    return <KubaiIcon name={name} size={size + 4} variant={focused ? "color" : "soft"} />;
  };
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#1B1E26",
        tabBarInactiveTintColor: "#9AA0AE",
        tabBarLabelStyle: { fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Xếp hạng", tabBarIcon: tabIcon("podium") }} />
      <Tabs.Screen name="groups" options={{ title: "Nhóm", tabBarIcon: tabIcon("users") }} />
      <Tabs.Screen name="profile" options={{ title: "Hồ sơ", tabBarIcon: tabIcon("user") }} />
    </Tabs>
  );
}
