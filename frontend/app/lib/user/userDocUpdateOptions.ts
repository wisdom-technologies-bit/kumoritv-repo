// Prompt 9: no Firestore here anymore. The AniList login flow (userLoginActions)
// still calls these helpers, so they now write through the Supabase/local data
// layer. An AniList-only user has no Supabase session, so writes land in the guest
// store and merge into the account on the next sign-in.

import { addFavourite, removeFavourite } from "@/app/lib/user-data/favourites";
import { listEntries, removeFromList, setListStatus } from "@/app/lib/user-data/lists";

type UpdateFavourites = {
  mediaData: {
    id: number;
    title: {
      romaji: string;
    };
    format: string;
    description: string;
    coverImage: {
      extraLarge: string;
      large: string;
    };
  };
  userId: string;
  isAddAction: boolean;
};

export async function updateUserFavouriteMedias({
  mediaData,
  isAddAction,
}: UpdateFavourites) {
  try {
    return isAddAction
      ? await addFavourite(mediaData)
      : await removeFavourite(mediaData.id);
  } catch {
    return false;
  }
}

export async function updateUserMediaListByStatus({
  status,
  mediaData,
}: {
  status: string;
  mediaData: UpdateFavourites["mediaData"];
  userId?: string;
}) {
  try {
    return await setListStatus({ snapshot: mediaData, status });
  } catch {
    return false;
  }
}

/** Kept for signature compatibility: removes every entry of `status` that is no
 *  longer part of `newListFiltered`. */
export async function removeMediaOnListByStatus({
  status,
  newListFiltered,
}: {
  status: string;
  newListFiltered: UpdateFavourites["mediaData"] | UpdateFavourites["mediaData"][];
  userId?: string;
}) {
  try {
    const keep = Array.isArray(newListFiltered)
      ? new Set(newListFiltered.map((media) => Number(media?.id)))
      : new Set<number>();
    const entries = (await listEntries()).filter(
      (entry) => entry.status === status.toLowerCase() && !keep.has(Number(entry.id)),
    );
    for (const entry of entries) await removeFromList(entry.id);
    return true;
  } catch {
    return false;
  }
}
