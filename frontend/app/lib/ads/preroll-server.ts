// Prompt 40: server side of the pre-roll.
//
// Runs on the watch page only, at request time, and returns null while the flags
// are off - which is the default. No query, no import and no prop when disabled.
import "server-only";
import { readPrerollConfig, type PrerollClientConfig } from "./preroll";
import { readShowAdultContent } from "../anilist/adult-content";
import { getAuthUser } from "../supabase/auth-server";
import { createAdminClient } from "../supabase/admin";

/** `public.staff_roles` is the only place a role lives; the key never leaves the server. */
async function isStaffUser(userId: string): Promise<boolean> {
  try {
    const admin: any = createAdminClient();
    const { data } = (await admin?.from("staff_roles").select("role").eq("user_id", userId).maybeSingle()) ?? {};

    return Boolean(data?.role);
  } catch {
    // Unknown role means "not staff": the viewer may see an ad. Never the reverse.
    return false;
  }
}

export async function readPrerollProps({ isAdult }: { isAdult: boolean }): Promise<PrerollClientConfig | null> {
  const config = readPrerollConfig();

  if (!config.enabled) return null;

  let staff = false;

  try {
    const user = await getAuthUser();

    if (user?.id) staff = await isStaffUser(user.id);
  } catch {
    staff = false;
  }

  let adultBlocked = false;

  if (isAdult) {
    try {
      adultBlocked = !(await readShowAdultContent());
    } catch {
      adultBlocked = true;
    }
  }

  return { ...config, isStaff: staff, adultBlocked };
}
