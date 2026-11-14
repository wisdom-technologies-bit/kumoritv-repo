// /community/post/[id] - one post and its comments.
//
// Guests may read (RLS lets anon read published, non-deleted posts). Post pages
// are noindex,follow (Q6): the index and the announcement pages carry SEO.
import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CommentsSection from "@/app/components/CommentsSection";
import SpoilerBody from "@/app/community/components/SpoilerBody";
import ThreadActions from "@/app/community/components/ThreadActions";
import styles from "@/app/community/page.module.css";
import { isCommunityEnabled } from "@/app/lib/community/flag";
import { buildClipCard, type ClipCard } from "@/app/lib/community/clip-post";
import { ADULT_LABEL, clipDurationLabel, clipMetaLabel, clipRangeLabel, clipThumbPath } from "@/app/lib/community/clip-attachment";
import { readShowAdultContent } from "@/app/lib/anilist/adult-content";
import { getAnimeSummary, getClipById } from "@/app/lib/clips/server";
import { createClient } from "@/app/lib/supabase/server";
import { getAuthUser } from "@/app/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PostRow = {
  id: string;
  author_id: string;
  body: string;
  is_spoiler: boolean;
  created_at: string;
  clip_id: string | null;
};

const loadPost = cache(async function loadPost(id: string): Promise<PostRow | null> {
  try {
    const client = createClient();
    if (!client) return null;
    const { data, error } = await (client as any)
      .from("community_posts")
      .select("id, author_id, body, is_spoiler, created_at, clip_id")
      .eq("id", id)
      .maybeSingle();
    if (error) return null;
    return (data as PostRow) ?? null;
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const enabled = isCommunityEnabled();
  const post = enabled && UUID.test(params.id) ? await loadPost(params.id) : null;
  // Metadata resolves before the layout shell is flushed, so this is the only
  // place a 404 also gets the right status code. The page keeps its own guard.
  if (enabled && !post) notFound();
  const title = post ? "A post on KumoriTV Community" : "Post not found";

  return {
    title,
    alternates: { canonical: `/community/post/${params.id}` },
    robots: { index: false, follow: true },
    openGraph: { title, url: `/community/post/${params.id}`, type: "article" },
  };
}

export default async function CommunityPostPage({ params }: { params: { id: string } }) {
  if (!isCommunityEnabled()) notFound();
  if (!UUID.test(params.id)) notFound();

  const post = await loadPost(params.id);
  if (!post) notFound();

  let user: { id?: string } | null = null;
  try {
    user = await getAuthUser();
  } catch {
    user = null;
  }
  const canDelete = Boolean(user?.id) && user?.id === post.author_id;

  let author: { display_name: string | null; username: string | null; avatar_url: string | null } | null = null;
  try {
    const client = createClient();
    if (client) {
      const { data } = await (client as any)
        .from("public_profiles")
        .select("display_name, username, avatar_url")
        .eq("id", post.author_id)
        .maybeSingle();
      author = data ?? null;
    }
  } catch {
    author = null;
  }

  // The clip this post carries, resolved and gated here on the server: an
  // adult clip with the reader's adult setting off becomes the masked card and
  // the clip row's title, range and code never enter the response.
  // The table keeps the clip's id (community_posts.clip_id), never its code:
  // selecting `clip_code` from the table - a name that only exists as an OUT
  // column of community_feed_page - made PostgREST answer 400 and turned every
  // post page into "Post not found". The code comes from the clip row.
  let clip: ClipCard = { state: "none" };
  if (post.clip_id) {
    let showAdult = false;
    try {
      showAdult = await readShowAdultContent();
    } catch {
      showAdult = false;
    }
    const row = await getClipById(post.clip_id);
    if (!row) {
      // The post points at a clip that has since been deleted.
      clip = { state: "removed" };
    } else {
      const summary = await getAnimeSummary(Number(row.anilist_id));
      clip = buildClipCard(row, summary, showAdult);
    }
  }

  const name = author?.display_name || author?.username || "Someone";
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const createdAt = new Date(post.created_at);

  return (
    <div className={styles.page}>
      <div className={styles.thread}>
        <Link href="/community" className={styles.back_link}>
          ← Back to the feed
        </Link>

        <article className={styles.thread_card}>
          <header className={styles.post_head}>
            <span className={styles.avatar} aria-hidden="true">
              {author?.avatar_url ? (
                // Author avatars are remote Supabase storage URLs; a plain img
                // keeps them working without widening the next/image allowlist.
                <img src={author.avatar_url} alt="" width={40} height={40} />
              ) : (
                initial
              )}
            </span>
            <div className={styles.identity}>
              <span className={styles.author_name}>{name}</span>
              <span className={styles.author_meta}>
                <time dateTime={post.created_at} title={createdAt.toLocaleString()}>
                  {createdAt.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                </time>
                {post.is_spoiler && (
                  <>
                    <span className={styles.dot} aria-hidden="true" />
                    <span>Spoiler</span>
                  </>
                )}
              </span>
            </div>
          </header>

          {post.is_spoiler ? (
            <SpoilerBody body={post.body} />
          ) : (
            <p className={styles.thread_body}>{post.body}</p>
          )}

          {clip.state === "live" ? (
            <a
              className={styles.feed_clip}
              href={`/clip/${clip.code}`}
              data-clip-post="live"
              aria-label={`Watch the clip${clip.animeTitle ? ` from ${clip.animeTitle}` : ""}`}
            >
              <span className={styles.feed_clip_thumb}>
                {clipThumbPath(clip.anilistId, clip.episode) ? (
                  <img src={clipThumbPath(clip.anilistId, clip.episode)} alt="" width={160} height={90} />
                ) : (
                  <span className={styles.feed_clip_placeholder} aria-hidden="true" data-placeholder="true" />
                )}
              </span>
              <span className={styles.feed_clip_text}>
                <span className={styles.feed_clip_title}>{clip.title || clip.animeTitle || "Shared a clip"}</span>
                <span className={styles.feed_clip_meta}>
                  {[clipMetaLabel(clip.animeTitle, clip.episode), clipRangeLabel(clip.start, clip.end), clipDurationLabel(clip.start, clip.end)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className={styles.feed_clip_cta}>Watch the clip</span>
              </span>
            </a>
          ) : clip.state === "hidden_adult" ? (
            <div className={styles.adult_card} data-clip-post="hidden_adult" data-adult-hidden="true">
              <span className={styles.adult_label}>{ADULT_LABEL}</span>
              <p className={styles.adult_text}>{clip.text}</p>
            </div>
          ) : clip.state === "removed" ? (
            <div className={styles.clip_removed} data-clip-post="removed">
              <span className={styles.clip_removed_title}>This clip was removed</span>
              <span className={styles.clip_removed_text}>The post is still here, but the clip is gone.</span>
            </div>
          ) : null}

          <ThreadActions kind="post" id={post.id} url={`/community/post/${post.id}`} canDelete={canDelete} />
        </article>

        <div className={styles.comments_wrap}>
          <CommentsSection target={{ kind: "post", id: post.id }} />
        </div>
      </div>
    </div>
  );
}
