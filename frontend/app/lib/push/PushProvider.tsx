"use client";
// Initialises OneSignal only for a signed-in Supabase user (Google, email,
// anonymous and AniList-bridged accounts all have a Supabase session). A guest
// never downloads the SDK, and nothing here can throw into the page.

import { useEffect } from "react";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import { syncPushIdentity } from "./runtime";

export default function PushProvider() {
  const { user, loading } = useUser();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (loading) return;

    let active = true;

    void (async () => {
      try {
        await syncPushIdentity(userId);
      } catch (error) {
        if (!active) return;
        console.warn(
          "[push] OneSignal identity sync failed",
          error instanceof Error ? error.message : error,
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [loading, userId]);

  return null;
}
