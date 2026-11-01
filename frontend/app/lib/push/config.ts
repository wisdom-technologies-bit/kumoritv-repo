// Push configuration, read from the environment on every call (never hard-coded).
//
// The client only ever needs the public app id. The REST key lives on the server
// (`app/lib/push/onesignal.ts`) and is never imported from a client component.

export const PUSH_WORKER_PATH = "push/onesignal/OneSignalSDKWorker.js";
export const PUSH_WORKER_SCOPE = "/push/onesignal/";

/** `NEXT_PUBLIC_ONESIGNAL_APP_ID`, or "" when push is not configured. */
export function onesignalAppId(): string {
  return (process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID ?? "").trim();
}

/** True when the public app id is present. Missing env is not an error: the bell
 *  keeps working, only the Notifications section says push is unavailable. */
export function pushConfigured(): boolean {
  return onesignalAppId().length > 0;
}

/** The OneSignal init options both the provider and the tests use. */
export function oneSignalInitOptions(appId: string, isDevelopment: boolean) {
  return {
    appId,
    // The worker is served from /push/onesignal/ so it never sits at the site
    // root (public/sw.js belongs to the ad provider and must stay untouched).
    serviceWorkerPath: PUSH_WORKER_PATH,
    serviceWorkerParam: { scope: PUSH_WORKER_SCOPE },
    // No floating bell, no automatic prompt, no slide-down prompts: the only
    // thing allowed to ask for permission is the Settings toggle.
    notifyButton: { enable: false },
    promptOptions: {
      slidedown: {
        prompts: [{ type: "push" as const, autoPrompt: false, delay: { pageViews: 0, timeDelay: 0 } }],
      },
    },
    allowLocalhostAsSecureOrigin: isDevelopment,
  };
}
