// Test double for `next/cache`: `unstable_cache` needs the Next incremental cache
// store, which does not exist under `node --test`, so every wrapper is a passthrough.
type Loader = (...args: never[]) => unknown;

export function unstable_cache<T extends Loader>(load: T): T {
  return load;
}

export function revalidateTag() {}
export function revalidatePath() {}
export function unstable_noStore() {}
