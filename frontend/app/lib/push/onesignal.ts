import "server-only";
// OneSignal Web Push sender (REST API v16).
//
// The REST key is read here and never logged, never returned and never sent to
// the browser. 429 and 5xx are retryable; everything else is a permanent failure
// for that chunk.

export const ONESIGNAL_ENDPOINT = "https://api.onesignal.com/notifications";
/** OneSignal accepts at most 2000 external ids per request. */
export const PUSH_CHUNK_SIZE = 2000;
/** A single request must not hold the cron open for long. */
export const PUSH_TIMEOUT_MS = 10_000;

export type SendPushInput = {
  externalIds: string[];
  title: string;
  body?: string | null;
  url?: string | null;
  /** Cover art, used as both the small icon and the big picture. */
  image?: string | null;
  /** Collapses repeats on the device (OneSignal web push topic). */
  topic?: string | null;
  /** Stable across retries of the same batch. */
  idempotencyKey?: string | null;
};

export type SendPushResult = {
  ok: boolean;
  /** Distinct external ids asked for. */
  requested: number;
  chunks: number;
  /** External ids in chunks OneSignal accepted. */
  sent: number;
  /** True when the caller should try again later (429 / 5xx / network). */
  retryable: boolean;
  error?: string;
  /** True when there was nothing to send or no key configured. */
  skipped?: boolean;
};

/** Site origin used for absolute notification URLs. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://kumoritv.top").replace(/\/+$/, "");
}

/** Builds the absolute URL OneSignal should open. Already-absolute values pass through. */
export function absoluteUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${siteUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function chunkIds(ids: string[], size = PUSH_CHUNK_SIZE): string[][] {
  const unique = [...new Set((ids ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))];
  const chunks: string[][] = [];

  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }

  return chunks;
}

/** The exact request body for one chunk (exported for the tests). */
export function buildNotificationPayload(input: {
  appId: string;
  externalIds: string[];
  title: string;
  body?: string | null;
  url?: string | null;
  image?: string | null;
  topic?: string | null;
  idempotencyKey?: string | null;
  chunkIndex?: number;
}) {
  const payload: Record<string, unknown> = {
    app_id: input.appId,
    target_channel: "push",
    include_aliases: { external_id: input.externalIds },
    headings: { en: input.title },
    contents: { en: input.body || input.title },
  };

  const url = absoluteUrl(input.url);
  if (url) payload.url = url;
  if (input.image) {
    payload.chrome_web_icon = input.image;
    payload.big_picture = input.image;
  }
  if (input.topic) payload.web_push_topic = input.topic;
  if (input.idempotencyKey) {
    payload.idempotency_key = `${input.idempotencyKey}:${input.chunkIndex ?? 0}`;
  }

  return payload;
}

function oneSignalKeys() {
  return {
    appId: (process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || "").trim(),
    restKey: (process.env.ONESIGNAL_REST_API_KEY || "").trim(),
  };
}

/** True when both the app id and the REST key are present. */
export function pushSenderConfigured(): boolean {
  const { appId, restKey } = oneSignalKeys();
  return Boolean(appId && restKey);
}

type AttemptResult = { status: number; ok: boolean; message: string; retryable: boolean; id?: string };

async function postChunk(payload: Record<string, unknown>, restKey: string): Promise<AttemptResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);

  try {
    const response = await fetch(ONESIGNAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${restKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    // OneSignal answers 200 with an `id` per notification. A failure body is JSON
    // too, but it never echoes our key, so it is safe to keep the message.
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (response.ok) {
      return { status: response.status, ok: true, message: "sent", retryable: false, id: body?.id };
    }

    const retryable = response.status === 429 || response.status >= 500;
    const message =
      (typeof body?.errors === "object" && Array.isArray(body.errors) && body.errors[0]) ||
      body?.error ||
      `onesignal_${response.status}`;

    return {
      status: response.status,
      ok: false,
      message: String(message).slice(0, 200),
      retryable,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      status: 0,
      ok: false,
      message: aborted ? "onesignal_timeout" : "onesignal_network_error",
      retryable: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sends one push to many Supabase user ids (the OneSignal External ID is the
 * Supabase user id). Chunks at 2000 ids and reports per-chunk outcomes.
 */
export async function sendPush(input: SendPushInput): Promise<SendPushResult> {
  const { appId, restKey } = oneSignalKeys();
  const chunks = chunkIds(input.externalIds);
  const requested = chunks.reduce((total, chunk) => total + chunk.length, 0);

  if (!requested) {
    return { ok: true, requested: 0, chunks: 0, sent: 0, retryable: false, skipped: true };
  }
  if (!appId || !restKey) {
    return {
      ok: false,
      requested,
      chunks: chunks.length,
      sent: 0,
      retryable: false,
      error: "onesignal_not_configured",
      skipped: true,
    };
  }

  let sent = 0;
  let retryable = false;
  let lastError: string | undefined;

  for (const [index, chunk] of chunks.entries()) {
    const payload = buildNotificationPayload({
      appId,
      externalIds: chunk,
      title: input.title,
      body: input.body,
      url: input.url,
      image: input.image,
      topic: input.topic,
      idempotencyKey: input.idempotencyKey,
      chunkIndex: index,
    });

    let result = await postChunk(payload, restKey);

    // One immediate retry for 429/5xx; the caller can retry the whole batch later.
    if (!result.ok && result.retryable) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      result = await postChunk(payload, restKey);
    }

    if (result.ok) {
      sent += chunk.length;
    } else {
      retryable = retryable || result.retryable;
      lastError = result.message;
    }
  }

  return {
    ok: sent === requested,
    requested,
    chunks: chunks.length,
    sent,
    retryable,
    error: lastError,
  };
}
