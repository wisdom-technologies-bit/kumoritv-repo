"use client";

// Prompt 35: /clips is for signed-in users. Guests can still CREATE clips (and
// delete them with the cookie for 30 days), they just have no list page, so this
// reuses the site's existing login modal instead of inventing a new one.

import { useEffect } from "react";
import { useAppDispatch } from "@/app/lib/redux/hooks";
import { toggleShowLoginModalValue } from "@/app/lib/redux/features/loginModal";
import { useUser } from "@/app/lib/supabase/AuthProvider";

export default function SignedOutPrompt() {
  const dispatch = useAppDispatch();
  const { user, loading } = useUser();

  useEffect(() => {
    if (loading || user) return;
    dispatch(toggleShowLoginModalValue());
  }, [dispatch, loading, user]);

  return (
    <div data-testid="clips-signed-out">
      <p>Sign in to see the clips you have made.</p>
      <p>
        Guests can still create clips and delete them for 30 days on the device that
        made them.
      </p>
    </div>
  );
}
