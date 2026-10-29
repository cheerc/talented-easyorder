const [scope, docsOnly, shards, ...extra] = process.argv.slice(2);
if (extra.length === 0 && scope === 'success'
  && ((docsOnly === 'true' && shards === 'skipped') || (docsOnly === 'false' && shards === 'success'))) {
  console.log(docsOnly === 'true' ? 'Docs-only change: browser suites intentionally skipped.' : 'All browser suites passed.');
} else {
  console.error('Browser gate failed: change classification or required suites were incomplete or unsuccessful.');
  process.exitCode = 1;
}
