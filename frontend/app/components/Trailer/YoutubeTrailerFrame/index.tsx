"use client";

// One guarded YouTube trailer frame for the surfaces that show a plain embed
// (home banner, /media/[id], the home media carousel): correct attributes,
// autoplay policy, and a player that refuses to load is removed instead of
// being left on screen.
//
// The hero keeps its own `motion.iframe` because it fades in over the artwork;
// it uses the same helpers and the same guard.

import { useEffect, useState } from "react";
import {
  YOUTUBE_IFRAME_ALLOW,
  YOUTUBE_REFERRER_POLICY,
  autoplayAllowed,
  browserOrigin,
  buildYoutubeEmbedSrc,
  isYoutubeTrailer,
  readPlaybackEnvironment,
  youtubeTrailerId,
  type TrailerRef,
} from "@/app/lib/youtube";
import { useYoutubeTrailerGuard } from "../useYoutubeTrailerGuard";

export type YoutubeTrailerFrameProps = {
  trailer: TrailerRef;
  /** Accessible name for the frame, e.g. "One Piece Trailer". */
  title: string;
  className?: string;
  autoplay?: boolean;
  loop?: boolean;
  controls?: boolean;
  /**
   * The page origin. Passed down by server pages (request headers) so the
   * markup is identical on the server and on the client; client-only callers
   * leave it out and it is read after mount.
   */
  origin?: string;
};

export default function YoutubeTrailerFrame({
  trailer,
  title,
  className,
  autoplay = false,
  loop = false,
  controls = true,
  origin,
}: YoutubeTrailerFrameProps) {
  const trailerId = youtubeTrailerId(isYoutubeTrailer(trailer) ? trailer : null);
  // Only an autoplaying embed has to prove playback; a poster embed legitimately
  // waits for the visitor to press play.
  const { failed, frameRef, onFrameLoad } = useYoutubeTrailerGuard(trailerId, {
    requirePlayback: autoplay,
  });

  const [embedOrigin, setEmbedOrigin] = useState<string>(origin || "");
  // Reduced motion / data saver only decide whether we may start playback by
  // ourselves, so a poster embed is never withheld from them.
  const [mayAutoplay, setMayAutoplay] = useState<boolean>(!autoplay);

  useEffect(() => {
    if (!origin) setEmbedOrigin(browserOrigin());
    setMayAutoplay(autoplay ? autoplayAllowed(readPlaybackEnvironment()) : true);
  }, [origin, autoplay]);

  if (!trailerId || failed || !mayAutoplay || !embedOrigin) return null;

  const src = buildYoutubeEmbedSrc(trailerId, {
    autoplay,
    loop,
    controls,
    origin: embedOrigin,
  });
  if (!src) return null;

  return (
    <iframe
      ref={frameRef}
      onLoad={onFrameLoad}
      className={className}
      src={src}
      frameBorder={0}
      title={title}
      allow={YOUTUBE_IFRAME_ALLOW}
      referrerPolicy={YOUTUBE_REFERRER_POLICY}
      allowFullScreen
    />
  );
}
