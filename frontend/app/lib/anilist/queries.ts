export const queryTitles = `title { romaji native english userPreferred }`;
export const queryCoverImage = `coverImage { extraLarge large medium color }`;
export const queryMediaReviews = `reviews { nodes { id summary body(asHtml: true) rating userRating ratingAmount score user { id name about avatar { large medium } bannerImage } } }`;

const mediaFields = `
  ${queryTitles}
  description(asHtml: true)
  isAdult
  isFavourite
  status
  episodes
  chapters
  volumes
  duration
  source
  countryOfOrigin
  trailer { id site thumbnail }
  updatedAt
  favourites
  averageScore
  ${queryMediaReviews}
  nextAiringEpisode { id episode airingAt }
  startDate { year month day }
  endDate { year month day }
  season
  seasonYear
  id
  ${queryCoverImage}
  bannerImage
  type
  format
  genres
  popularity
`;

const mediaListFields = `
  ${queryTitles}
  description(asHtml: false)
  isAdult
  isFavourite
  status
  episodes
  duration
  updatedAt
  favourites
  averageScore
  nextAiringEpisode { id episode airingAt }
  startDate { year month day }
  season
  seasonYear
  id
  ${queryCoverImage}
  bannerImage
  type
  format
  genres
  popularity
`;

// Adult titles are hidden by default. `$isAdult: Boolean` is nullable, so when
// the user enabled adult content the variable is simply omitted and AniList
// applies no filter (sending `isAdult: true` would return adult titles ONLY).
export function requestMedias(otherQueryFields = "", otherMediasFields = "") {
  return `query($type: MediaType, $format: MediaFormat, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $page: Int, $perPage: Int, $status: MediaStatus, $isAdult: Boolean${otherQueryFields}) { Page(page: $page, perPage: $perPage) { media(season: $season, seasonYear: $seasonYear, sort: $sort, type: $type, format: $format, status: $status, isAdult: $isAdult${otherMediasFields}) { ${mediaListFields} } } }`;
}

export function requestMediasByDateRelease() {
  return `query($page: Int, $sort: [AiringSort], $perPage: Int, $airingAt_greater: Int, $airingAt_lesser: Int) { Page(page: $page, perPage: $perPage) { airingSchedules(sort: $sort, airingAt_greater: $airingAt_greater, airingAt_lesser: $airingAt_lesser) { id airingAt timeUntilAiring episode mediaId media { id idMal isAdult description ${queryMediaReviews} ${queryTitles} ${queryCoverImage} trailer { id site thumbnail } bannerImage type format status season seasonYear seasonInt episodes duration chapters volumes countryOfOrigin isLicensed source hashtag updatedAt genres synonyms averageScore meanScore popularity isLocked trending favourites isFavourite isFavouriteBlocked isAdult siteUrl autoCreateForumThread isRecommendationBlocked isReviewBlocked modNotes } } } }`;
}

export function requestMediasByTrendingSort() {
  return `query Page($page: Int, $sort: [MediaTrendSort], $perPage: Int) { Page(page: $page, perPage: $perPage) { mediaTrends(sort: $sort) { mediaId date trending averageScore inProgress releasing episode popularity media { id idMal isAdult ${queryTitles} id ${queryMediaReviews} ${queryCoverImage} trailer { id site thumbnail } bannerImage type format status description season seasonYear seasonInt episodes duration chapters volumes countryOfOrigin isLicensed source hashtag updatedAt genres synonyms averageScore meanScore popularity isLocked trending favourites isFavourite isFavouriteBlocked isAdult siteUrl autoCreateForumThread isRecommendationBlocked isReviewBlocked modNotes } } } }`;
}

export const requestMediaById = () => `query($id: Int) { Media(id: $id) {
  ${queryTitles} description(asHtml: true) isAdult status isFavourite ${queryMediaReviews}
  relations { nodes { id genres type format ${queryTitles} ${queryCoverImage} } }
  characters(sort: [ROLE, FAVOURITES_DESC]) { edges { role node { id name { full } image { large } } voiceActorRoles { voiceActor { id name { full } image { large } } } } }
  recommendations { edges { node { mediaRecommendation { id ${queryTitles} ${queryCoverImage} format genres seasonYear isAdult } } } }
  studios(isMain: true) { edges { node { name id isAnimationStudio siteUrl } } }
  streamingEpisodes { title thumbnail url site }
  nextAiringEpisode { id episode airingAt }
  startDate { year month day } endDate { year month day } season seasonYear episodes chapters volumes duration source countryOfOrigin synonyms
  trailer { id site thumbnail } updatedAt favourites trending id ${queryCoverImage} bannerImage type hashtag format genres popularity averageScore
} }`;
