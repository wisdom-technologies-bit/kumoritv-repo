"use client";

// The React view of the toast setting: server value first (after login), the
// localStorage value otherwise, and both kept in step for the rest of the page.

import { useCallback, useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/app/lib/supabase/browser";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import {
  applyServerToastSetting,
  getToastSetting,
  saveToastSettingToProfile,
  setToastSetting,
  subscribeToastSetting,
} from "./toast-setting";

export type ToastSettingHandle = {
  value: boolean;
  signedIn: boolean;
  /** Optimistic; returns false when the profile write failed and was undone. */
  update: (next: boolean) => Promise<boolean>;
};

export function useCommunityToastSetting(): ToastSettingHandle {
  const { user, profile } = useUser();
  const signedIn = Boolean(user?.id) && user?.is_anonymous !== true;
  const profileValue = (profile as unknown as { community_toasts?: unknown } | null)?.community_toasts;

  const [value, setValue] = useState<boolean>(() =>
    typeof profileValue === "boolean" && signedIn ? profileValue : getToastSetting(),
  );

  // "For signed-in users the server value wins after login."
  useEffect(() => {
    if (!signedIn) return;
    const applied = applyServerToastSetting(profileValue);
    if (applied !== null) setValue(applied);
  }, [profileValue, signedIn]);

  useEffect(() => subscribeToastSetting(setValue), []);

  const update = useCallback(
    async (next: boolean) => {
      const previous = getToastSetting();
      setToastSetting(next);
      setValue(next);
      if (!signedIn || !user?.id) return true;

      const ok = await saveToastSettingToProfile(createBrowserSupabaseClient(), user.id, next);
      if (!ok) {
        setToastSetting(previous);
        setValue(previous);
      }
      return ok;
    },
    [signedIn, user?.id],
  );

  return { value, signedIn, update };
}
