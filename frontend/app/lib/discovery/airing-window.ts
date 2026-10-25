export function calculateAiringWindow(now: number, lastWindowEnd: string | null | undefined, lastStats: any) {
  const truncated = Boolean(lastStats?.seed_truncated && lastStats.oldest_airing_at);
  const from = truncated ? Math.max(0, Math.floor(new Date(lastStats.oldest_airing_at).getTime() / 1000) - 3600) : lastWindowEnd ? Math.max(now - 172800, Math.floor(new Date(lastWindowEnd).getTime() / 1000) - 3600) : now - 2592000;
  return { from, to: now, seeded: !lastWindowEnd || truncated };
}
