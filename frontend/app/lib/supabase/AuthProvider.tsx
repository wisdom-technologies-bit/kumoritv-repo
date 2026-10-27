"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "./browser";
import type { Database } from "./database.types";
import { mergeGuestDataIntoAccount, clearUserScopedCaches } from "@/app/lib/user-data/merge";
import { hydrateProgress } from "@/app/lib/user-data/progress";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type AuthContextValue = { user: User | null; profile: Profile | null; isAnonymous: boolean; loading: boolean; signOut: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client) { setLoading(false); return; }
    let active = true;
    const load = async (nextUser: User | null) => {
      setUser(nextUser);
      if (!nextUser) { setProfile(null); setLoading(false); return; }
      const { data } = await client.from("profiles").select("*").eq("id", nextUser.id).maybeSingle();
      if (active) { setProfile(data); setLoading(false); }
      // Guest data collected on this device is merged into the account once, and
      // the server watch progress is pulled in so resume works on a fresh device.
      void mergeGuestDataIntoAccount(nextUser.id);
      void hydrateProgress();
    };
    client.auth.getUser().then(({ data }) => load(data.user));
    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => { void load(nextSession?.user ?? null); });
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, [client]);

  const value = useMemo(() => ({
    user,
    profile,
    isAnonymous: user?.is_anonymous ?? false,
    loading,
    signOut: async () => {
      clearUserScopedCaches(user?.id);
      if (client) await client.auth.signOut();
    },
  }), [client, loading, profile, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useUser() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useUser must be used within AuthProvider");
  return context;
}
