export const LEGACY_POS_RUNTIME_CACHE_NAME = 'pos-network-cache';

type CacheRetirementStorage = Pick<CacheStorage, 'delete' | 'has'>;

/** Retire the exact runtime cache used by older app releases and verify it is gone. */
export async function retireLegacyRuntimeCache(
  storage: CacheRetirementStorage | undefined = typeof globalThis.caches === 'undefined' ? undefined : globalThis.caches,
): Promise<void> {
  if (!storage) return;

  await storage.delete(LEGACY_POS_RUNTIME_CACHE_NAME);
  if (await storage.has(LEGACY_POS_RUNTIME_CACHE_NAME)) {
    throw new Error('The previous POS runtime cache is still present.');
  }
}
