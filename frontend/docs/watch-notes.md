# Watch resolver notes

- Streams are fetched from `BASE + "/" + episodeId`, where episodeId is the stored full path in `episodes.sub_providers` / `dub_providers`.
- Responses may include streams, subtitles, intro/outro timing, thumbnails, embeds, and failed servers; providers may omit subtitles and timings.
- Stream types are hls, mp4, embed, and dash. `playlist_key` streams are XOR-encrypted and unsupported; skip them with `unsupported_encrypted`.
- Requests need a full browser User-Agent and the stream referer (or a referer derived from headers/embed origin) to avoid CDN 403 HTML responses.
- Frieren episode 1 findings: anikoto, aniwaves and kaa provide plain HLS; senshi is embed-only; animegg is redirected mp4; reanime uses unsupported playlist encryption. anikoto offers soft subtitles; aniwaves and kaa are commonly hard-subbed; reanime provides intro/outro and senshi provides intro.
- Subtitle formats include ass, srt, and vtt; labels include language plus signs/songs/forced and dubtitle variants.


## Prompt 41 (B): the Download pill

`DownloadEpisode` is no longer a full-width button under the controls and no
longer opens a bottom sheet. It is a pill inside the toolbar row
(`PlayerToolbar`), styled by that row's own `.tool` class, with a dropdown
rendered in a portal.

- **Nothing renders** while `DOWNLOADS_ENABLED` is off, when the episode has no
  links, or before the prefetch has answered: the row is exactly as before.
- **Prefetch, not on-open.** The links are fetched 2 s after the toolbar mounts.
  The pill only exists when we know the episode really has downloads, and the
  menu opens instantly. Fetching on first open would show a pill that may lead
  nowhere and a spinner on every tap.
- **The pill never navigates.** A click toggles the menu; closing happens on the
  second click, an outside pointerdown, Escape, a route change or entering
  fullscreen. It is repositioned on scroll and resize (`placeMenu` in
  `position.ts`: `min(320px, 100vw - 24px)`, flips above when there is no room
  below, shifts horizontally to stay on screen).
- **Menu**: "Download Episode N", `Source: <provider>`, then Sub and then Dub,
  each quality high to low (`800p` keeps its place), every item an
  `<a target="_blank" rel="noopener noreferrer nofollow">` so popup blockers do
  not interfere. The sponsor popup from Prompt 39 still opens from that same
  quality click, with the same interval cap, and is silently ignored when
  blocked. One line under the list: "Opens an external page. It may show ads."
- **Keyboard**: `aria-haspopup="menu"`, `aria-expanded`, `role="menu"` /
  `role="menuitem"`, ArrowUp/ArrowDown/Home/End/Escape, focus moves to the first
  quality on open and back to the pill on close, 44 px touch targets.
- The old `sheet.tsx` and its styles are gone; `__tests__/menu.test.tsx` covers
  order, links and the on-screen maths.
