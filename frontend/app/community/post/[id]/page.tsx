// /community/post/[id] - one post and its comments.
//
// Guests may read (RLS lets anon read published, non-deleted posts). Post pages
// are noindex,follow (Q6): the index and the announcement pages carry SEO.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CommentsSection from "@/app/components/CommentsSection";
import SpoilerBody from "@/app/community/components/SpoilerBody";
import ThreadActions from "@/app/community/components/ThreadActions";
import styles from "@/app/community/page.module.css";
import { isCommunityEnabled } from "@/app/lib/community/flag";
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
};

async function loadPost(id: string): Promise<PostRow | null> {
  try {
    const client = createClient();
    if (!client) return null;
    const { data, error } = await (client as any)
      .from("community_posts")
      .select("id, author_id, body, is_spoiler, created_at")
      .eq("id", id)
      .maybeSingle();
    if (error) return null;
    return (data as PostRow) ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const enabled = isCommunityEnabled();
  const post = enabled && UUID.test(params.id) ? await loadPost(params.id) : null;
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

          <ThreadActions kind="post" id={post.id} url={`/community/post/${post.id}`} canDelete={canDelete} />
        </article>

        <div className={styles.comments_wrap}>
          <CommentsSection target={{ kind: "post", id: post.id }} />
        </div>
      </div>
    </div>
  );
}
