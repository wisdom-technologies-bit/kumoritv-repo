// Phase 6, part F: remove a person's OneSignal identity when they delete.
//
// OneSignal keys a browser subscription on external_id, which is the user's id
// (see app/lib/push/onesignal.ts, where include_aliases.external_id is built).
// Deleting the database row alone leaves the subscription live, so a deleted
// account keeps receiving pushes.
//
// The REST key is server-only and never leaves this module. Unconfigured push is
// not an error: it just means there is nothing to remove.
const ONESIGNAL_USERS_ENDPOINT = "https://api.onesignal.com/apps";

export function pushIdentityConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean((env.NEXT_PUBLIC_ONESIGNAL_APP_ID ?? "").trim() && (env.ONESIGNAL_REST_API_KEY ?? "").trim());
}

export type PushIdentityResult = { ok: boolean; status?: number; skipped?: boolean };

/**
 * DELETE /apps/<app_id>/users/by/external_id/<id>
 *
 * Best effort by contract: it never throws, and a failure is reported rather
 * than raised, because a push provider that is down must never block an account
 * deletion.
 */
export async function removeOneSignalIdentity(
  externalId: string,
  options: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<PushIdentityResult> {
  const env = options.env ?? process.env;
  const appId = (env.NEXT_PUBLIC_ONESIGNAL_APP_ID ?? "").trim();
  const restKey = (env.ONESIGNAL_REST_API_KEY ?? "").trim();
  if (!appId || !restKey || !externalId) return { ok: false, skipped: true };

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);

  try {
    const response = await doFetch(
      `${ONESIGNAL_USERS_ENDPOINT}/${encodeURIComponent(appId)}/users/by/external_id/${encodeURIComponent(externalId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Key ${restKey}` },
        signal: controller.signal,
      },
    );
    // 200: removed. 404: there was no subscription, which is the same outcome.
    return { ok: response.ok || response.status === 404, status: response.status };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}
