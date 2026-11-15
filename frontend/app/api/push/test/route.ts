import { createClient } from "@/app/lib/supabase/server";
import { sendPush } from "@/app/lib/push/onesignal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/push/test - "Send me a test notification".
 *
 * Sends a real push to the signed-in user's own External ID (the Supabase user
 * id), rate limited to one per minute per user. The answer is in words, never a
 * OneSignal status code and never the key.
 */
const lastSentAt = new Map<string, number>();
const WINDOW_MS = 60_000;

export async function POST() {
  const client: any = createClient();
  if (!client) return Response.json({ message: "Push is not available right now." }, { status: 503 });

  let userId: string | null = null;
  try {
    const { data } = await client.auth.getUser();
    userId = data?.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return Response.json({ message: "Sign in first." }, { status: 401 });

  const now = Date.now();
  const previous = lastSentAt.get(userId) ?? 0;
  if (now - previous < WINDOW_MS)
    return Response.json(
      { message: "A test was sent a moment ago. Try again in a minute." },
      { status: 429 },
    );
  lastSentAt.set(userId, now);

  if (!(process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || "").trim())
    return Response.json({ message: "Push is not configured: the app id is missing at build time." });
  if (!(process.env.ONESIGNAL_REST_API_KEY || "").trim())
    return Response.json({ message: "Push is not configured: the server key is missing." });

  const result = await sendPush({
    externalIds: [userId],
    title: "KumoriTV test notification",
    body: "If you can read this, push works for this account.",
    url: "/",
    topic: "kumori-test",
  });

  if (result.skipped) return Response.json({ message: "There was nothing to send." });
  if (!result.ok && result.retryable)
    return Response.json({ message: "OneSignal did not answer. Try again in a minute." });
  if (!result.ok)
    return Response.json({ message: "OneSignal rejected the request. Check the server key." });
  if (result.sent === 0)
    return Response.json({
      message: "No active subscription for this account. Turn the toggle on in this browser first.",
    });

  return Response.json({ message: "Sent. It should arrive in a moment." });
}
