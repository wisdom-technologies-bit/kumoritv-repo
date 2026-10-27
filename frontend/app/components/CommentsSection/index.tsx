"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./component.module.css";
import SvgLoading from "@/public/assets/ripple-1s-200px.svg";
import SvgFilter from "@/public/assets/filter-right.svg";
import { MediaData } from "@/app/ts/interfaces/anilistMediaData";
import { createBrowserSupabaseClient } from "@/app/lib/supabase/browser";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import { useAppDispatch } from "@/app/lib/redux/hooks";
import { toggleShowLoginModalValue } from "@/app/lib/redux/features/loginModal";
import WriteCommentForm, {
  CommentSubmission,
  CommentSubmitResult,
} from "./components/WriteCommentForm";
import CommentContainer, { CommentLookups } from "./components/CommentContainer";
import {
  CommentFeedRow,
  CommentsSort,
  ReactionValue,
  addComment,
  clearReaction,
  countComments,
  listComments,
  listMyReactions,
  listReplies,
  setReaction,
  softDeleteComment,
} from "@/app/lib/comments/queries";

/** Only what the section needs, so both pages can pass a serialisable slice. */
export type CommentsMediaInfo = { id: number } & Partial<Pick<MediaData, "title" | "format">>;

type CommentsSectionTypes = {
  mediaInfo: CommentsMediaInfo;
  isOnWatchPage?: boolean;
  episodeNumber?: number;
};

const FIRST_PAGE_SIZE = 3;
const NEXT_PAGE_SIZE = 10;

function groupReplies(rows: CommentFeedRow[]): Record<string, CommentFeedRow[]> {
  const grouped: Record<string, CommentFeedRow[]> = {};
  for (const row of rows) {
    if (!row.parent_id) continue;
    grouped[row.parent_id] ??= [];
    grouped[row.parent_id].push(row);
  }
  return grouped;
}

export default function CommentsSection({ mediaInfo, isOnWatchPage, episodeNumber }: CommentsSectionTypes) {
  const client = useMemo(() => createBrowserSupabaseClient(), []);
  const { user, profile } = useUser();
  const dispatch = useAppDispatch();

  // Signed in means a Supabase session. AniList users have one through the bridge.
  const userId = user?.id ?? null;
  const isSignedIn = !!userId;
  const username = profile?.username || profile?.display_name || user?.user_metadata?.username || "Anonymous";
  const avatarUrl = profile?.avatar_url || null;

  const mediaId = mediaInfo.id;
  // Media page: every comment of the anime. Watch page: this episode only.
  const episodeFilter = isOnWatchPage ? episodeNumber ?? null : null;

  const [sort, setSort] = useState<CommentsSort>("recent");
  const [visibleCount, setVisibleCount] = useState<number>(FIRST_PAGE_SIZE);
  const [comments, setComments] = useState<CommentFeedRow[]>([]);
  const [repliesByParent, setRepliesByParent] = useState<Record<string, CommentFeedRow[]>>({});
  const [myReactions, setMyReactions] = useState<Record<string, ReactionValue>>({});
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isUnavailable, setIsUnavailable] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const visibleIdsKey = comments.map((comment) => comment.id).join("|");
  const latestIds = useRef<string[]>([]);
  latestIds.current = comments.map((comment) => comment.id);

  const openLoginModal = useCallback(() => {
    dispatch(toggleShowLoginModalValue());
  }, [dispatch]);

  // Top-level page + total. Both are computed by the database, never in the browser.
  useEffect(() => {
    let active = true;

    if (!client) {
      setIsUnavailable(true);
      setIsLoading(false);
      return () => {
        active = false;
      };
    }

    setIsLoading(true);

    (async () => {
      const [listResult, countResult] = await Promise.all([
        listComments(client, {
          anilistId: mediaId,
          episodeNumber: episodeFilter,
          sort,
          limit: visibleCount,
        }),
        countComments(client, { anilistId: mediaId, episodeNumber: episodeFilter }),
      ]);

      if (!active) return;

      if (listResult.error || countResult.error) {
        setIsUnavailable(true);
        setComments([]);
        setTotal(0);
        setIsLoading(false);
        return;
      }

      setIsUnavailable(false);
      setComments(listResult.data);
      setTotal(countResult.data);
      setIsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [client, mediaId, episodeFilter, sort, visibleCount]);

  // Replies for the visible top-level comments, and my own reactions for them.
  useEffect(() => {
    let active = true;
    const ids = visibleIdsKey ? visibleIdsKey.split("|") : [];

    if (!client || ids.length === 0) {
      setRepliesByParent({});
      setMyReactions({});
      return () => {
        active = false;
      };
    }

    (async () => {
      const [replyResult, reactionResult] = await Promise.all([
        listReplies(client, ids),
        listMyReactions(client, userId, ids),
      ]);

      if (!active) return;
      if (!replyResult.error) setRepliesByParent(groupReplies(replyResult.data));
      if (!reactionResult.error) setMyReactions(reactionResult.data);
    })();

    return () => {
      active = false;
    };
  }, [client, userId, visibleIdsKey]);

  // Switching episode or sort starts the list again from the first page.
  useEffect(() => {
    setVisibleCount(FIRST_PAGE_SIZE);
  }, [mediaId, episodeFilter, sort]);

  const applyReactionLocally = useCallback(
    (commentId: string, from: ReactionValue | null, to: ReactionValue | null) => {
      const adjust = (comment: CommentFeedRow): CommentFeedRow => {
        if (comment.id !== commentId) return comment;
        let likes = comment.likes;
        let dislikes = comment.dislikes;
        if (from === 1) likes -= 1;
        if (from === -1) dislikes -= 1;
        if (to === 1) likes += 1;
        if (to === -1) dislikes += 1;
        return { ...comment, likes: Math.max(0, likes), dislikes: Math.max(0, dislikes) };
      };

      setComments((previous) => previous.map(adjust));
      setRepliesByParent((previous) => {
        const next: Record<string, CommentFeedRow[]> = {};
        for (const [parentId, rows] of Object.entries(previous)) next[parentId] = rows.map(adjust);
        return next;
      });
      setMyReactions((previous) => {
        const next = { ...previous };
        if (to === null) delete next[commentId];
        else next[commentId] = to;
        return next;
      });
    },
    [],
  );

  const handleReact = useCallback(
    async (comment: CommentFeedRow, value: ReactionValue) => {
      if (!isSignedIn || !userId || !client) {
        openLoginModal();
        return;
      }

      const current = myReactions[comment.id] ?? null;
      const next: ReactionValue | null = current === value ? null : value;

      setActionError(null);
      applyReactionLocally(comment.id, current, next);

      const result =
        next === null
          ? await clearReaction(client, { commentId: comment.id, userId })
          : await setReaction(client, { commentId: comment.id, userId, value: next });

      if (result.error) {
        applyReactionLocally(comment.id, next, current);
        setActionError("Could not save your reaction. Please try again.");
      }
    },
    [applyReactionLocally, client, isSignedIn, myReactions, openLoginModal, userId],
  );

  const handleDelete = useCallback(
    async (comment: CommentFeedRow) => {
      if (!client || !userId || comment.user_id !== userId) return;

      setActionError(null);
      const result = await softDeleteComment(client, { commentId: comment.id, userId });

      if (result.error) {
        setActionError("Could not delete your comment. Please try again.");
        return;
      }

      if (comment.parent_id) {
        setRepliesByParent((previous) => ({
          ...previous,
          [comment.parent_id as string]: (previous[comment.parent_id as string] ?? []).filter(
            (row) => row.id !== comment.id,
          ),
        }));
        return;
      }

      setComments((previous) => previous.filter((row) => row.id !== comment.id));
      setRepliesByParent((previous) => {
        const next = { ...previous };
        delete next[comment.id];
        return next;
      });
      setTotal((previous) => Math.max(0, previous - 1));
    },
    [client, userId],
  );

  const handleCreateComment = useCallback(
    async (submission: CommentSubmission, parentId: string | null): Promise<CommentSubmitResult> => {
      if (!client || !userId) {
        openLoginModal();
        return { error: { message: "Please log in to comment.", code: "not_signed_in" } };
      }

      const result = await addComment(client, {
        anilistId: mediaId,
        userId,
        body: submission.body,
        isSpoiler: submission.isSpoiler,
        // Media page comments belong to the anime; watch page ones to the episode.
        episodeNumber: isOnWatchPage ? episodeNumber ?? null : null,
        parentId,
      });

      if (result.error) return { error: result.error };

      const created: CommentFeedRow = {
        id: result.data.id,
        anilist_id: result.data.anilist_id,
        episode_number: result.data.episode_number,
        parent_id: result.data.parent_id,
        user_id: result.data.user_id,
        body: result.data.body,
        is_spoiler: result.data.is_spoiler,
        created_at: result.data.created_at,
        username: profile?.username ?? null,
        display_name: profile?.display_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
        likes: 0,
        dislikes: 0,
      };

      // Optimistic: the new comment shows up immediately, then the page is confirmed.
      if (parentId) {
        setRepliesByParent((previous) => ({
          ...previous,
          [parentId]: [...(previous[parentId] ?? []), created],
        }));
      } else {
        setComments((previous) => [created, ...previous]);
        setTotal((previous) => previous + 1);
        setVisibleCount((previous) => Math.max(previous, FIRST_PAGE_SIZE));
      }


      return { error: null };
    },
    [client, episodeNumber, isOnWatchPage, mediaId, openLoginModal, profile, userId],
  );

  const lookups: CommentLookups = {
    reactionFor: (comment) => myReactions[comment.id] ?? null,
    canDeleteFor: (comment) => isSignedIn && comment.user_id === userId,
    repliesFor: (comment) => repliesByParent[comment.id] ?? [],
  };

  const hasMore = total > comments.length;

  return (
    <div id={styles.container}>
      <WriteCommentForm
        isSignedIn={isSignedIn}
        username={username}
        avatarUrl={avatarUrl}
        onGuestAttempt={openLoginModal}
        onSubmit={(submission) => handleCreateComment(submission, null)}
      />

      <div id={styles.all_comments_container}>
        {(comments.length > 0 || isLoading) && (
          <React.Fragment>
            {comments.length > 0 && (
              <div id={styles.comments_heading}>
                {total > 1 && (
                  <div id={styles.custom_select}>
                    <SvgFilter width={16} height={16} alt="Filter" />

                    <select
                      aria-label="Choose How To Sort The Comments"
                      value={sort}
                      onChange={(e) => setSort(e.target.value as CommentsSort)}
                    >
                      <option value="recent">Most Recent</option>
                      <option value="likes">Most Likes</option>
                      <option value="dislikes">Most Dislikes</option>
                    </select>
                  </div>
                )}

                <p>
                  {total} comment{total === 1 ? "" : "s"}
                </p>
              </div>
            )}

            {!isLoading && (
              <ul>
                {comments.map((comment) => (
                  <CommentContainer
                    key={comment.id}
                    comment={comment}
                    lookups={lookups}
                    isSignedIn={isSignedIn}
                    username={username}
                    avatarUrl={avatarUrl}
                    onGuestAttempt={openLoginModal}
                    onReact={handleReact}
                    onDelete={handleDelete}
                    onSubmitReply={(parentId, submission) => handleCreateComment(submission, parentId)}
                  />
                ))}
              </ul>
            )}

            {!isLoading && hasMore && (
              <button type="button" onClick={() => setVisibleCount((previous) => previous + NEXT_PAGE_SIZE)}>
                SEE MORE COMMENTS
              </button>
            )}
          </React.Fragment>
        )}

        {isLoading && (
          <div>
            <SvgLoading width={120} height={120} alt="Loading" />
          </div>
        )}

        {!isLoading && !isUnavailable && comments.length === 0 && (
          <div id={styles.no_comments_container}>
            <p>No Comments Yet</p>
          </div>
        )}

        {!isLoading && isUnavailable && (
          <div id={styles.no_comments_container} data-testid="comments-unavailable">
            <p>Comments are unavailable right now.</p>
          </div>
        )}

        {actionError && <p className={styles.section_error}>{actionError}</p>}
      </div>
    </div>
  );
}
