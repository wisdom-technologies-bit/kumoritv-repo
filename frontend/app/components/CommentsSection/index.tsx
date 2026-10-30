"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./component.module.css";
import { MediaData } from "@/app/ts/interfaces/anilistMediaData";
import { createBrowserSupabaseClient } from "@/app/lib/supabase/browser";
import { useUser } from "@/app/lib/supabase/AuthProvider";
import { useAppDispatch } from "@/app/lib/redux/hooks";
import { toggleShowLoginModalValue } from "@/app/lib/redux/features/loginModal";
import WriteCommentForm, {
  CommentSubmission,
  CommentSubmitResult,
} from "./components/WriteCommentForm";
import CommentContainer from "./components/CommentContainer";
import Dropdown from "./components/Dropdown";
import {
  CommentFeedRow,
  CommentsSort,
  ReactionValue,
  SORT_OPTIONS,
  addComment,
  clearReaction,
  countComments,
  countReplies,
  listCommentedEpisodes,
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

/** Comments load a page at a time; "Show more comments" asks for the next one. */
export const COMMENTS_PAGE_SIZE = 20;

const ALL_EPISODES = "all";

export function episodeFilterOptions(
  episodeNumbers: number[],
  current?: number | null,
): { value: string; label: string }[] {
  const numbers = [...new Set(episodeNumbers)].sort((a, b) => a - b);
  const ordered =
    current !== null && current !== undefined
      ? [current, ...numbers.filter((value) => value !== current)]
      : numbers;

  return [
    { value: ALL_EPISODES, label: "All episodes" },
    ...ordered.map((value) => ({ value: `${value}`, label: `Episode ${value}` })),
  ];
}

/**
 * Comments for one anime (or one episode). The look follows ani.pm: a big
 * "N Comments" header with a collapse chevron, two underlined menus, and an
 * inline composer over the list.
 */
export default function CommentsSection({
  mediaInfo,
  isOnWatchPage,
  episodeNumber,
}: CommentsSectionTypes) {
  const [client, setClient] = useState<ReturnType<typeof createBrowserSupabaseClient>>(null);
  const { user } = useUser();
  const dispatch = useAppDispatch();

  const userId = user?.id ?? null;
  const profile = user?.user_metadata ?? null;
  const isSignedIn = !!userId;
  const username =
    profile?.username || profile?.display_name || user?.user_metadata?.username || "Anonymous";
  const avatarUrl = profile?.avatar_url || null;

  const mediaId = mediaInfo.id;

  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [sort, setSort] = useState<CommentsSort>("likes");
  const [episodeChoice, setEpisodeChoice] = useState<string>(
    isOnWatchPage && episodeNumber ? `${episodeNumber}` : ALL_EPISODES,
  );
  const [pageLimit, setPageLimit] = useState<number>(COMMENTS_PAGE_SIZE);
  /** Episode a new top-level comment is filed under (composer picker). */
  const [newCommentEpisode, setNewCommentEpisode] = useState<number | null>(
    isOnWatchPage && episodeNumber ? episodeNumber : null,
  );

  const [comments, setComments] = useState<CommentFeedRow[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [repliesByParent, setRepliesByParent] = useState<Record<string, CommentFeedRow[]>>({});
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [loadingReplies, setLoadingReplies] = useState<Record<string, boolean>>({});
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
  const [myReactions, setMyReactions] = useState<Record<string, ReactionValue>>({});
  const [commentedEpisodes, setCommentedEpisodes] = useState<number[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isUnavailable, setIsUnavailable] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const episodeFilter = episodeChoice === ALL_EPISODES ? null : Number(episodeChoice);

  const visibleIdsKey = comments.map((comment) => comment.id).join("|");
  const loadedReplyIds = useMemo(
    () => Object.values(repliesByParent).flat().map((row) => row.id),
    [repliesByParent],
  );
  const loadedReplyIdsKey = loadedReplyIds.join("|");

  const openLoginModal = useCallback(() => {
    dispatch(toggleShowLoginModalValue());
  }, [dispatch]);

  useEffect(() => {
    setClient(createBrowserSupabaseClient());
  }, []);

  // Which episodes actually carry comments (for the left menu).
  useEffect(() => {
    let active = true;
    if (!client) return () => { active = false; };

    (async () => {
      const result = await listCommentedEpisodes(client, { anilistId: mediaId });
      if (!active || result.error) return;
      setCommentedEpisodes(result.data);
    })();

    return () => { active = false; };
  }, [client, mediaId]);

  // The page itself plus the total; both come from the database.
  useEffect(() => {
    let active = true;

    if (!client) {
      setIsUnavailable(true);
      setIsLoading(false);
      return () => { active = false; };
    }

    setIsLoading(true);

    (async () => {
      const [listResult, countResult] = await Promise.all([
        listComments(client, {
          anilistId: mediaId,
          episodeNumber: episodeFilter,
          sort,
          limit: pageLimit,
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

    return () => { active = false; };
  }, [client, mediaId, episodeFilter, sort, pageLimit]);

  // How many replies each visible comment has, and my own reactions.
  useEffect(() => {
    let active = true;
    const ids = visibleIdsKey ? visibleIdsKey.split("|") : [];

    if (!client || ids.length === 0) {
      setReplyCounts({});
      setMyReactions({});
      return () => { active = false; };
    }

    (async () => {
      const reactionIds = [...new Set([...ids, ...loadedReplyIds])];
      const [countResult, reactionResult] = await Promise.all([
        countReplies(client, ids),
        listMyReactions(client, userId, reactionIds),
      ]);

      if (!active) return;
      if (!countResult.error) setReplyCounts(countResult.data);
      if (!reactionResult.error) setMyReactions(reactionResult.data);
    })();

    return () => { active = false; };
  }, [client, userId, visibleIdsKey, loadedReplyIdsKey, loadedReplyIds]);

  useEffect(() => {
    setNewCommentEpisode(episodeFilter);
  }, [episodeFilter]);

  // A new episode, sort or media starts again from the first page.
  useEffect(() => {
    setPageLimit(COMMENTS_PAGE_SIZE);
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
        const parentId = comment.parent_id;
        setRepliesByParent((previous) => ({
          ...previous,
          [parentId]: (previous[parentId] ?? []).filter((row) => row.id !== comment.id),
        }));
        setReplyCounts((previous) => ({
          ...previous,
          [parentId]: Math.max(0, (previous[parentId] ?? 1) - 1),
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

  /** Lazy: the first expand loads this comment's replies, later toggles reuse them. */
  const handleToggleReplies = useCallback(
    async (commentId: string) => {
      const isOpen = !!expandedReplies[commentId];
      setExpandedReplies((previous) => ({ ...previous, [commentId]: !isOpen }));

      if (isOpen) return;
      if (repliesByParent[commentId]) return;

      if (!client) return;

      setLoadingReplies((previous) => ({ ...previous, [commentId]: true }));
      const result = await listReplies(client, [commentId]);
      setLoadingReplies((previous) => ({ ...previous, [commentId]: false }));

      if (result.error) {
        setActionError("Could not load the replies. Please try again.");
        return;
      }

      setRepliesByParent((previous) => ({ ...previous, [commentId]: result.data }));
      setReplyCounts((previous) => ({ ...previous, [commentId]: result.data.length }));
    },
    [client, expandedReplies, repliesByParent],
  );

  const toggleSpoiler = useCallback((commentId: string) => {
    setRevealedSpoilers((previous) => ({ ...previous, [commentId]: !previous[commentId] }));
  }, []);

  const handleCreateComment = useCallback(
    async (submission: CommentSubmission, parentId: string | null): Promise<CommentSubmitResult> => {
      if (!client || !userId) {
        openLoginModal();
        return { error: { message: "Please log in to comment.", code: "not_signed_in" } };
      }

      const parentEpisode = parentId
        ? comments.find((row) => row.id === parentId)?.episode_number ??
          Object.values(repliesByParent)
            .flat()
            .find((row) => row.id === parentId)?.episode_number ??
          null
        : null;

      const result = await addComment(client, {
        anilistId: mediaId,
        userId,
        body: submission.body,
        isSpoiler: submission.isSpoiler,
        // A reply belongs to its parent's episode; a new comment to the picker.
        episodeNumber: parentId ? parentEpisode : newCommentEpisode,
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

      // Optimistic: the new comment shows up immediately.
      if (parentId) {
        setRepliesByParent((previous) => ({
          ...previous,
          [parentId]: [...(previous[parentId] ?? []), created],
        }));
        setReplyCounts((previous) => ({
          ...previous,
          [parentId]: (previous[parentId] ?? 0) + 1,
        }));
        setExpandedReplies((previous) => ({ ...previous, [parentId]: true }));
      } else {
        setComments((previous) => [created, ...previous]);
        setTotal((previous) => previous + 1);
      }

      return { error: null };
    },
    [client, comments, mediaId, newCommentEpisode, openLoginModal, profile, repliesByParent, userId],
  );

  // Media page: an anime-wide comment, or one tied to an episode that has some.
  const composerepisodeOptions = [...new Set(commentedEpisodes)].sort((a, b) => a - b);
  const hasMore = total > comments.length;
  const episodeOptions = episodeFilterOptions(commentedEpisodes, isOnWatchPage ? episodeNumber : null);

  function renderReplies(comment: CommentFeedRow) {
    if (!expandedReplies[comment.id]) return null;

    if (loadingReplies[comment.id]) {
      return <span className={styles.replies_loading}>Loading replies…</span>;
    }

    const rows = repliesByParent[comment.id] ?? [];
    if (!rows.length) return null;

    return (
      <ul className={styles.replies_list}>
        {rows.map((reply) => (
          <CommentContainer
            key={reply.id}
            comment={reply}
            isReply
            isSignedIn={isSignedIn}
            username={username}
            avatarUrl={avatarUrl}
            myReaction={myReactions[reply.id] ?? null}
            canDelete={isSignedIn && reply.user_id === userId}
            isSpoilerRevealed={!!revealedSpoilers[reply.id]}
            onToggleSpoiler={toggleSpoiler}
            onGuestAttempt={openLoginModal}
            onReact={handleReact}
            onDelete={handleDelete}
            onSubmitReply={(parentId, submission) => handleCreateComment(submission, parentId)}
            replyEpisodeNumber={reply.episode_number ?? null}
          />
        ))}
      </ul>
    );
  }

  return (
    <section id={styles.container} aria-labelledby={styles.heading}>
      <div className={styles.header}>
        <h2 id={styles.heading}>
          {total} Comment{total === 1 ? "" : "s"}
        </h2>

        <button
          type="button"
          className={styles.collapse_button}
          aria-expanded={!isCollapsed}
          aria-controls={styles.body}
          aria-label={isCollapsed ? "Expand comments" : "Collapse comments"}
          onClick={() => setIsCollapsed((current) => !current)}
        >
          <span className={styles.chevron} data-open={!isCollapsed} aria-hidden="true">
            ▾
          </span>
        </button>
      </div>

      {!isCollapsed && (
        <div id={styles.body}>
          <div className={styles.controls}>
            <Dropdown
              ariaLabel="Filter comments by episode"
              value={episodeChoice}
              options={episodeOptions}
              onChange={setEpisodeChoice}
            />

            <Dropdown
              ariaLabel="Sort comments"
              value={sort}
              options={SORT_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              onChange={(value) => setSort(value as CommentsSort)}
              align="end"
            />
          </div>

          <WriteCommentForm
            isSignedIn={isSignedIn}
            username={username}
            avatarUrl={avatarUrl}
            episodeNumber={newCommentEpisode}
            episodeOptions={isOnWatchPage ? [] : composerepisodeOptions}
            onEpisodeChange={setNewCommentEpisode}
            onSubmit={(submission) => handleCreateComment(submission, null)}
            onGuestAttempt={openLoginModal}
          />

          {actionError && (
            <p role="alert" className={styles.error}>
              {actionError}
            </p>
          )}

          {isUnavailable && (
            <p className={styles.error}>
              Comments are unavailable right now. Please try again later.
            </p>
          )}

          {isLoading && (
            <ul className={styles.skeleton_list} aria-hidden="true">
              {[0, 1, 2].map((key) => (
                <li key={key} className={styles.skeleton_row}>
                  <span className={styles.skeleton_avatar} />
                  <span className={styles.skeleton_lines}>
                    <span className={styles.skeleton_line} data-width="short" />
                    <span className={styles.skeleton_line} />
                    <span className={styles.skeleton_line} data-width="medium" />
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!isLoading && !isUnavailable && comments.length === 0 && (
            <p className={styles.empty}>No comments yet. Be the first!</p>
          )}

          {!isLoading && comments.length > 0 && (
            <ul className={styles.comments_list}>
              {comments.map((comment) => (
                <CommentContainer
                  key={comment.id}
                  comment={comment}
                  isSignedIn={isSignedIn}
                  username={username}
                  avatarUrl={avatarUrl}
                  myReaction={myReactions[comment.id] ?? null}
                  canDelete={isSignedIn && comment.user_id === userId}
                  replyCount={replyCounts[comment.id] ?? 0}
                  isRepliesOpen={!!expandedReplies[comment.id]}
                  isRepliesLoading={!!loadingReplies[comment.id]}
                  isSpoilerRevealed={!!revealedSpoilers[comment.id]}
                  onToggleSpoiler={toggleSpoiler}
                  onToggleReplies={handleToggleReplies}
                  onGuestAttempt={openLoginModal}
                  onReact={handleReact}
                  onDelete={handleDelete}
                  onSubmitReply={(parentId, submission) => handleCreateComment(submission, parentId)}
                  replyEpisodeNumber={comment.episode_number ?? episodeFilter}
                >
                  {renderReplies(comment)}
                </CommentContainer>
              ))}
            </ul>
          )}

          {hasMore && (
            <button
              type="button"
              className={styles.show_more}
              onClick={() => setPageLimit((current) => current + COMMENTS_PAGE_SIZE)}
            >
              Show more comments
            </button>
          )}
        </div>
      )}
    </section>
  );
}
