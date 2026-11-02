import './CommandProgress.css';

/**
 * 頁頂的細進度條（#585）：fixed、不佔版面，啟用 250ms 後才顯現，快命令幾乎看不到。
 * 不朗讀；狀態由按鈕停用與頁面 aria-busy 表達。
 */
export function CommandProgress({ active }: { active: boolean }) {
  return (
    <div
      className="command-progress"
      data-active={active ? 'true' : 'false'}
      data-testid="command-progress"
      aria-hidden="true"
    />
  );
}
