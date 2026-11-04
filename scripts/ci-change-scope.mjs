// docs-only 變更分類：白名單（任何路徑的 *.md，加 docs/ 下的文件素材）。
// 白名單外一律視為非文件，預設走完整 CI（誤判只會多跑，不會少跑）。
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DOCS_ASSET = /^docs\/.+\.(pdf|png|jpe?g|gif|svg|txt)$/i;

export function isDocsPath(path) {
  return /\.md$/i.test(path) || DOCS_ASSET.test(path);
}

export function classify(paths) {
  const list = paths.map((p) => p.trim()).filter(Boolean);
  const nonDocs = list.filter((p) => !isDocsPath(p));
  return { docsOnly: list.length > 0 && nonDocs.length === 0, nonDocs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  const paths = input.split('\n');
  const { docsOnly, nonDocs } = classify(paths);
  const changed = paths.map((p) => p.trim()).filter(Boolean);
  if (changed.length === 0) console.log('No changed files detected, running full CI');
  else if (docsOnly) console.log(`All ${changed.length} changed files are docs (*.md or docs/ assets) -> docs-only`);
  else console.log(`Non-docs changes detected, running full CI:\n${nonDocs.join('\n')}`);
  const line = `docs_only=${docsOnly}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
}
