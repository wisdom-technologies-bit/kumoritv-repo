/**
 * Client-safe names only.
 *
 * The watch player is a client component and has to recognise the provider key
 * when it decides whether a failed stream deserves one forced re-resolve, so
 * this file must stay free of `server-only`, of environment access and of any
 * import from the rest of `app/lib/ani/`. Everything server-side lives in the
 * other modules, which are all `server-only`.
 */
export const ANI_PROVIDER = "ani";

/** The single server button an ani stream shows. */
export const ANI_SERVER_LABEL = "Kumori";
