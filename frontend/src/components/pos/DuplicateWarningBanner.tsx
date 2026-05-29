import React from "react";

interface DuplicateWarningBannerProps {
  orderedTodayCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}
export const DuplicateWarningBanner = React.memo(function DuplicateWarningBanner({ orderedTodayCount, onConfirm, onCancel }: DuplicateWarningBannerProps) {
  return (
    <div className="dup-warn">
      <div className="dup-warn-icon">⚠</div>
      <div className="dup-warn-body">
        <div className="dup-warn-h">已經訂過 {orderedTodayCount} 次便當</div>
        <div className="dup-warn-sub">
          確定要再訂一份嗎? (家長可能用同一帳號為多位學員訂餐)
        </div>
      </div>
      <div className="dup-warn-btns">
        <button className="btn-cancel" onClick={onCancel}>
          <span>否</span><span className="kbd">Esc</span>
        </button>
        <button className="btn-confirm" onClick={onConfirm}>
          <span>是,再訂一份</span><span className="kbd kbd-light">↵</span>
        </button>
      </div>
    </div>
  );
});
