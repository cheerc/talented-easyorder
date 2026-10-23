// Node resolve hook for the maintenance CLI: the app sources import each other without a file extension
// (bundler style), which Node's native TypeScript loading does not resolve. Only relative imports made from
// inside `frontend/src/` and written without an extension get `.ts` (or `/index.ts`) added; every other
// specifier, including packages and `node:` modules, is resolved exactly as Node would.
const FRONTEND_SRC = '/frontend/src/';
const HAS_EXTENSION = /\.[A-Za-z0-9]+$/;

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!relative || HAS_EXTENSION.test(specifier) || !context.parentURL?.includes(FRONTEND_SRC)) {
    return nextResolve(specifier, context);
  }
  try {
    return await nextResolve(`${specifier}.ts`, context);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return nextResolve(`${specifier}/index.ts`, context);
  }
}
