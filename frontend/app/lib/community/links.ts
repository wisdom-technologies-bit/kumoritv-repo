// Prompt 38B: every community URL in one place.
//
// The SQL helper public.comment_link(comments) produces the same strings; the
// unit test asserts both against the six fixtures in the plan (section 5.3).
// Keep them in step: a comment deep link that works on one side and not the
// other is worse than no deep link.

export type CommentLinkTarget =
  | { target_type: "anime"; id: string; anilist_id: number; episode_number: number | null }
  | { target_type: "post"; id: string; post_id: string }
  | { target_type: "announcement"; id: string; announcement_id: string };

export function postUrl(id: string): string {
  return `/community/post/${id}`;
}

export function announcementUrl(id: string): string {
  return `/community/announcements/${id}`;
}

export function communityUrl(): string {
  return "/community";
}

/** The canonical link for one comment, mirroring public.comment_link(). */
export function commentUrl(comment: CommentLinkTarget): string {
  if (comment.target_type === "post") {
    return `${postUrl(comment.post_id)}#comment-${comment.id}`;
  }
  if (comment.target_type === "announcement") {
    return `${announcementUrl(comment.announcement_id)}#comment-${comment.id}`;
  }
  if (comment.episode_number === null || comment.episode_number === undefined) {
    return `/media/${comment.anilist_id}#comment-${comment.id}`;
  }
  return `/watch/${comment.anilist_id}?ep=${comment.episode_number}#comment-${comment.id}`;
}

/** Absolute URL for "copy link" and share sheets. */
export function absoluteUrl(path: string, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}
