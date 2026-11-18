// Phase 5: /clips - the public clip browse, and "My clips" behind the same
// chrome.
//
// Before Phase 5 this page was "My clips" only: private, noindex, signed-in.
// The public list is behind CLIPS_PUBLIC_ENABLED, read per request. With the
// flag off the page behaves exactly as it did (My clips, or the sign-in
// prompt), except that both share the new card design.
//
// SEO: index/follow only on the public tab, with no `q` and no `cursor`, and a
// canonical of /clips. "My clips" is always noindex. Individual clips are not in
// the sitemap (a thin clip page should not be crawled).

import Link from "next/link";
import styles from "./page.module.css";
import MyClipsList, { type MyClipItem } from "./components/MyClipsList";
import SignedOutPrompt from "./components/SignedOutPrompt";
import ClipsBrowser from "./components/ClipsBrowser";
import { getAnimeSummaries, listUserClips, toPublicClip } from "@/app/lib/clips/server";
import { readClipViewer } from "@/app/lib/clips/request";
import { readShowAdultContent } from "@/app/lib/anilist/adult-content";
import { isClipsPublicEnabled } from "@/app/lib/clips/public-flag";
import { readBrowseQuery } from "@/app/lib/clips/browse";
import { loadBrowsePage } from "@/app/lib/clips/browse-server";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

/** `?tab=mine` is the only tab that is not the public list. */
function readTab(value: string | string[] | undefined): "all" | "mine" {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "mine" ? "mine" : "all";
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }) {
  const publicOn = isClipsPublicEnabled();
  const tab = readTab(searchParams.tab);
  const query = readBrowseQuery({
    sort: searchParams.sort,
    anime: searchParams.anime,
    q: searchParams.q,
    cursor: searchParams.cursor,
  });
  const filtered = Boolean(query.q) || searchParams.cursor != null || tab === "mine";
  // A filtered or paginated view is a different page for a crawler, and "My
  // clips" is private: only the clean public list is indexable.
  const indexable = publicOn && !filtered;

  return {
    title: publicOn && tab === "all" ? "Clips" : "My Clips",
    description:
      publicOn && tab === "all"
        ? "Short clips from KumoriTV: pick a moment from any episode and share it."
        : "The clips you made on KumoriTV.",
    alternates: { canonical: "/clips" },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
  };
}

async function myClips(userId: string) {
  const rows = await listUserClips(userId);
  const clips = rows.map(toPublicClip);
  const anime = await getAnimeSummaries(clips.map((clip) => clip.anilistId));
  const items: MyClipItem[] = clips.map((clip) => ({
    ...clip,
    animeTitle: anime.get(clip.anilistId)?.title ?? `Anime ${clip.anilistId}`,
    thumbnail: `/thumb/${clip.anilistId}/${clip.episode}`,
  }));
  return items;
}

export default async function ClipsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await readClipViewer();
  const publicOn = isClipsPublicEnabled();
  const tab = readTab(searchParams.tab);
  const signedIn = Boolean(viewer.userId);
  const showAdult = await readShowAdultContent();

  const query = readBrowseQuery({
    sort: searchParams.sort,
    anime: searchParams.anime,
    q: searchParams.q,
    cursor: searchParams.cursor,
  });

  // ---- My clips (and the flag-off page, which is what /clips always was) ----
  if (!publicOn || tab === "mine") {
    if (!signedIn) {
      return (
        <main id={styles.container}>
          <section id={styles.main_content_container}>
            <header id={styles.heading_container}>
              <h1>My Clips</h1>
            </header>
            <SignedOutPrompt />
            {publicOn ? (
              <p className={styles.signin_hint}>
                Or <Link href="/clips">browse every clip</Link>.
              </p>
            ) : null}
          </section>
        </main>
      );
    }

    const items = await myClips(viewer.userId!);
    return (
      <main id={styles.container}>
        <section id={styles.main_content_container}>
          <header id={styles.heading_container}>
            <h1>Clips</h1>
            <p className={styles.count} data-testid="clips-count">
              {items.length} {items.length === 1 ? "clip" : "clips"}
            </p>
          </header>
          <Tabs tab="mine" publicOn={publicOn} signedIn={signedIn} />
          <MyClipsList items={items} />
        </section>
      </main>
    );
  }

  // ---- The public list ----
  // The first page renders on the server: a crawler and a first paint both get
  // real cards, and "Load more" takes over from there.
  const first = await loadBrowsePage(query);

  return (
    <main id={styles.container}>
      <section id={styles.main_content_container}>
        <header id={styles.heading_container}>
          <h1>Clips</h1>
          {first.items.length > 0 ? (
            <p className={styles.count} data-testid="clips-count">
              {first.items.length}
              {first.nextCursor ? "+" : ""} {first.items.length === 1 ? "clip" : "clips"}
            </p>
          ) : null}
        </header>

        <Tabs tab="all" publicOn={publicOn} signedIn={signedIn} />

        {first.failed ? (
          <div className={styles.state} role="alert" data-testid="clips-error">
            <p className={styles.state_title}>The clip list did not load.</p>
            <p className={styles.state_text}>Try again in a moment.</p>
            <a className={styles.primary} href="/clips">
              Reload
            </a>
          </div>
        ) : first.items.length === 0 && !query.after ? (
          <div className={styles.state} data-testid="clips-empty">
            <p className={styles.state_title}>
              {query.q ? `No clips match "${query.q}"` : "No clips yet"}
            </p>
            <p className={styles.state_text}>
              Make one while watching: open any episode, pick a moment, and it appears here.
            </p>
            <a className={styles.primary} href="/search">
              Find something to watch
            </a>
          </div>
        ) : (
          <ClipsBrowser
            initialItems={first.items}
            initialNextCursor={first.nextCursor}
            initialQuery={{ sort: query.sort, q: query.q ?? "", anime: query.anime }}
            initialCount={first.items.length}
            showAdult={showAdult}
          />
        )}
      </section>
    </main>
  );
}

/** All clips | My clips. Guests get a sign-in link instead of a private tab. */
function Tabs({ tab, publicOn, signedIn }: { tab: "all" | "mine"; publicOn: boolean; signedIn: boolean }) {
  return (
    <div className={styles.tab_row}>
      <nav className={styles.segmented} aria-label="Clip lists">
        <Link
          href="/clips"
          className={styles.segment}
          aria-current={tab === "all" ? "page" : undefined}
          data-active={tab === "all"}
        >
          All clips
        </Link>
        {signedIn ? (
          <Link
            href="/clips?tab=mine"
            className={styles.segment}
            aria-current={tab === "mine" ? "page" : undefined}
            data-active={tab === "mine"}
          >
            My clips
          </Link>
        ) : (
          <span className={styles.segment_ghost} data-testid="clips-signin">
            {publicOn ? <Link href="/auth?next=%2Fclips%3Ftab%3Dmine">Sign in to see yours</Link> : null}
          </span>
        )}
      </nav>
    </div>
  );
}
