import './PageSkeleton.css';

/** lazy 頁面載入時的骨架：保留標題列與兩個內容區塊的高度，避免載入完成時版面跳動。 */
export function PageSkeleton() {
  return (
    <div className="page-skeleton" role="status" aria-label="載入中" aria-busy="true">
      <div className="page-skeleton__block page-skeleton__block--title" />
      <div className="page-skeleton__block page-skeleton__block--body" />
      <div className="page-skeleton__block page-skeleton__block--body" />
    </div>
  );
}
