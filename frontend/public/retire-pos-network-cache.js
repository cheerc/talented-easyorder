const retiredRuntimeCache = 'pos-network-cache';

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await caches.delete(retiredRuntimeCache);
    if (await caches.has(retiredRuntimeCache)) {
      throw new Error('The previous POS runtime cache is still present.');
    }
  })());
});
