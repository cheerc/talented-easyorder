// @ts-expect-error 此測試使用 node API 讀取實體檔案，不在瀏覽器型別範圍。
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error 同上。
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// U2b：品牌用語「便當櫃台」→「訂餐櫃台」（spec §8.4）。
// 這裡不只看 index.html 的 <title>：PWA 安裝後顯示的是
// public/manifest.json 的 name／short_name／description，兩邊必須一致。

// tsconfig.app.json 只含 DOM 與 ES2020 lib，沒有 Node 的 __dirname 型別。
declare const __dirname: string;

const frontendRoot = path.resolve(__dirname, '..', '..');

const read = (relative: string): string => readFileSync(path.join(frontendRoot, relative), 'utf8');

const APP_NAME = '訂餐櫃台';
const APP_DESCRIPTION = '校園訂餐 POS 管理系統';

/** 舊的品牌用語，只允許出現在 spec 的用語對照表與範例資料裡。 */
const LEGACY_BRAND = '便當櫃台';

interface PwaManifest {
  name: string;
  short_name: string;
  description: string;
}

describe('PWA 品牌用語（U2b #4）', () => {
  const manifest = JSON.parse(read('public/manifest.json')) as PwaManifest;
  const html = read('index.html');

  it('public/manifest.json 的名稱與說明已是新用語', () => {
    expect(manifest.name).toBe(APP_NAME);
    expect(manifest.short_name).toBe(APP_NAME);
    expect(manifest.description).toBe(APP_DESCRIPTION);
    expect(manifest.name).not.toContain(LEGACY_BRAND);
    expect(manifest.short_name).not.toContain(LEGACY_BRAND);
    expect(manifest.description).not.toContain(LEGACY_BRAND);
  });

  it('index.html 的 title 與 meta description 與 manifest 一致', () => {
    expect(html).toContain(`<title>${APP_NAME}</title>`);
    expect(html).toContain(`content="${APP_DESCRIPTION}"`);
    expect(html).toContain('<link rel="manifest" href="/manifest.json" />');
  });

  it('index.html 不殘留舊的「便當櫃台」品牌名', () => {
    expect(html).not.toContain(LEGACY_BRAND);
  });

  // vite 的 manifest:false 會把 public/ 原樣複製到 dist/，這裡實際核對 build 產物。
  // dist 不存在（例如未跑過 build）時跳過，不讓測試依賴 build 先行的順序。
  const distManifestPath = path.join(frontendRoot, 'dist', 'manifest.json');

  it.runIf(existsSync(distManifestPath))('build 產出的 dist/manifest.json 與來源一致', () => {
    const distManifest = JSON.parse(readFileSync(distManifestPath, 'utf8')) as PwaManifest;
    expect(distManifest).toEqual(manifest);
    expect(distManifest.name).toBe(APP_NAME);
    expect(distManifest.description).toBe(APP_DESCRIPTION);
  });
});