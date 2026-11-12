// Prompt 35: My clips.
//
// Signed-in users get a list of the clips they made; guests have no list page
// (they can still create clips and delete their own through the cookie). The
// row shape and the interactions mirror the favourites/list pages.

import styles from "./page.module.css";
import MyClipsList, { type MyClipItem } from "./components/MyClipsList";
import SignedOutPrompt from "./components/SignedOutPrompt";
import { getAnimeSummaries, listUserClips, toPublicClip } from "@/app/lib/clips/server";
import { readClipViewer } from "@/app/lib/clips/request";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "My Clips",
  description: "The clips you made on KumoriTV.",
  robots: { index: false, follow: false },
};

export default async function MyClipsPage() {
  const viewer = await readClipViewer();

  if (!viewer.userId) {
    return (
      <main id={styles.container}>
        <section id={styles.main_content_container}>
          <div id={styles.heading_container}>
            <h1>My Clips</h1>
          </div>
          <SignedOutPrompt />
        </section>
      </main>
    );
  }

  const rows = await listUserClips(viewer.userId);
  const clips = rows.map(toPublicClip);
  const anime = await getAnimeSummaries(clips.map((clip) => clip.anilistId));

  const items: MyClipItem[] = clips.map((clip) => ({
    ...clip,
    animeTitle: anime.get(clip.anilistId)?.title ?? `Anime ${clip.anilistId}`,
    thumbnail: `/thumb/${clip.anilistId}/${clip.episode}`,
  }));

  return (
    <main id={styles.container}>
      <section id={styles.main_content_container}>
        <div id={styles.heading_container}>
          <h1>My Clips</h1>
          <p className={styles.count}>
            {items.length} {items.length === 1 ? "clip" : "clips"}
          </p>
        </div>

        <MyClipsList items={items} />
      </section>
    </main>
  );
}
