// docs-only 變更分類：白名單（任何路徑的 *.md，加 docs/ 下的文件素材）。
// 白名單外一律視為非文件，預設走完整 CI（誤判只會多跑，不會少跑）。
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MARKDOWN = /\.md$/;
const DOCS_ASSET = /^docs\/.+\.(pdf|png|jpe?g|gif|svg|txt)$/i;

export function isDocsPath(path) {
  return MARKDOWN.test(path) || DOCS_ASSET.test(path);
}

export function classify(paths) {
  // 只丟掉完全空白的行；不修剪路徑，帶空白或 \r 的路徑視為非 docs。
  const list = paths.filter((p) => p !== '');
  const nonDocs = list.filter((p) => !isDocsPath(p));
  return { docsOnly: list.length > 0 && nonDocs.length === 0, nonDocs };
}

// main push：只有「before 非全零、diff 非空且全為 docs、before 有成功的 push run」才繼承父 commit 結果。
// 非 docs 檔與 before 相同，代表程式 tree 已在 main 上完整驗證過（與 commit 數量無關）。任一條件不成立即完整 CI。
export function decidePush({ before, paths, parentGreen }) {
  if (typeof before !== 'string' || before === '' || /^0+$/.test(before)) {
    return { docsOnly: false, reason: 'no usable before SHA (new branch push), running full CI' };
  }
  const { docsOnly, nonDocs } = classify(paths);
  if (!docsOnly) {
    return { docsOnly: false, reason: nonDocs.length ? `non-docs changes since ${before}, running full CI` : 'empty diff, running full CI' };
  }
  if (parentGreen !== true) {
    return { docsOnly: false, reason: `parent ${before} has no successful push run, running full CI` };
  }
  return { docsOnly: true, reason: `docs-only push; parent ${before} has a successful CI push run (inherits its full validation, not re-run)` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  const paths = input.split('\n');
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('--push')) {
    const { docsOnly, reason } = decidePush({ before: opt('--before'), paths, parentGreen: opt('--parent-green') === 'true' });
    console.log(reason);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `change-scope (push): ${reason}\n`);
    const out = `docs_only=${docsOnly}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
    else process.stdout.write(out);
    process.exit(0);
  }
  const { docsOnly, nonDocs } = classify(paths);
  const changed = paths.filter((p) => p !== '');
  if (changed.length === 0) console.log('No changed files detected, running full CI');
  else if (docsOnly) console.log(`All ${changed.length} changed files are docs (*.md or docs/ assets) -> docs-only`);
  else console.log(`Non-docs changes detected, running full CI:\n${nonDocs.join('\n')}`);
  const line = `docs_only=${docsOnly}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
}
