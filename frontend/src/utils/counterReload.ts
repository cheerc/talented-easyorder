// #710：品牌按鈕＝回到櫃台並整頁重新整理。
// 整頁重新整理後預設會落在學生頁（登入、Ctrl+R 都一樣）；要落在櫃台，靠一次性的網址標記 #counter，
// 不另外寫 localStorage／sessionStorage。獨立成模組，單元測試可 mock（jsdom 不能真的重新整理），真正的重新整理由 e2e 驗證。
const COUNTER_HASH = '#counter';

export function isCounterStart(): boolean {
  return window.location.hash === COUNTER_HASH;
}

/** 落在櫃台之後把標記拿掉，不留歷史紀錄；之後的 Ctrl+R 不會再回櫃台。 */
export function clearCounterStart(): void {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
}

export function reloadToCounter(): void {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${COUNTER_HASH}`);
  window.location.reload();
}
