import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "./auth";
import { supabase } from "./supabase";

export const MAX_MEMBERS = 10;
const SELECTED_KEY = "stroll.selectedGroup";

export type Group = {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string;
};

type GroupsState = {
  groups: Group[];
  selected: Group | null;
  loading: boolean;
  select: (id: string) => void;
  refresh: () => Promise<void>;
  create: (name: string) => Promise<Group>;
  join: (code: string) => Promise<Group>;
  leave: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

const Ctx = createContext<GroupsState | null>(null);

async function fetchMyGroups(uid: string): Promise<Group[]> {
  const { data, error } = await supabase
    .from("members")
    .select("joined_at, group:groups(id, name, invite_code, owner_id)")
    .eq("user_id", uid)
    .order("joined_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as { group: Group | Group[] | null }[];
  return rows
    .map((r) => (Array.isArray(r.group) ? r.group[0] : r.group))
    .filter((g): g is Group => !!g);
}

export function GroupsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const uid = session?.user.id ?? null;
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Đã nạp nhóm cho người dùng nào; loading = chưa nạp xong cho người đang đăng nhập.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = !!uid && loadedFor !== uid;

  const refresh = useCallback(async () => {
    if (!uid) return;
    try {
      setGroups(await fetchMyGroups(uid));
    } finally {
      setLoadedFor(uid);
    }
  }, [uid]);

  // Nạp nhóm khi đăng nhập; bỏ kết quả nếu người dùng đổi/đăng xuất giữa chừng.
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    fetchMyGroups(uid)
      .then((list) => {
        if (!cancelled) setGroups(list);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadedFor(uid);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    AsyncStorage.getItem(SELECTED_KEY)
      .then((v) => v && setSelectedId(v))
      .catch(() => {});
  }, []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    AsyncStorage.setItem(SELECTED_KEY, id).catch(() => {});
  }, []);

  const value = useMemo<GroupsState>(() => {
    // Không để lộ nhóm của người dùng trước khi tài khoản khác đăng nhập.
    const mine = loadedFor === uid ? groups : [];
    const selected = mine.find((g) => g.id === selectedId) ?? mine[0] ?? null;
    return {
      groups: mine,
      selected,
      loading,
      select,
      refresh,
      create: async (name) => {
        const { data, error } = await supabase.rpc("create_group", { group_name: name });
        if (error) throw new Error(error.message);
        await refresh();
        select((data as Group).id);
        return data as Group;
      },
      join: async (code) => {
        const { data, error } = await supabase.rpc("join_group", { code });
        if (error) throw new Error(error.message);
        await refresh();
        select((data as Group).id);
        return data as Group;
      },
      leave: async (id) => {
        if (!uid) return;
        const { error } = await supabase
          .from("members")
          .delete()
          .eq("group_id", id)
          .eq("user_id", uid);
        if (error) throw new Error(error.message);
        await refresh();
      },
      remove: async (id) => {
        const { error } = await supabase.from("groups").delete().eq("id", id);
        if (error) throw new Error(error.message);
        await refresh();
      },
    };
  }, [groups, loadedFor, selectedId, loading, select, refresh, uid]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGroups(): GroupsState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGroups phải nằm trong GroupsProvider");
  return v;
}

/** Link mời. Mã luôn đi kèm để người nhận nhập tay nếu link không mở được app. */
export const inviteLink = (code: string) => "stroll://join/" + code;
