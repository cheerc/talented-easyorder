import React from "react";
import { AppShell } from "../AppShell";
import type { StorageMode } from "../../appMode";
import { useFace, useSimulationDate } from "../../store/selectors";
import { faceDeviceLabel } from "../../domain/faceOrder";
import { formatTaipeiDateTime } from "../../utils/dateTime";
import { ChartColumn, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';

interface TopBarProps {
  tab: string;
  navigationLocked?: boolean;
  setTab: (tab: string) => void;
  online: boolean;
  syncing: boolean;
  lastSync: string;
  todayCount: number;
  /** 其他餐點份數；固定顯示在第二行（0 也顯示）。 */
  todayOtherCount?: number;
  viewDate: string;
  setViewDate: (date: string) => void;
  queuedCount?: number;
  failedSyncCount?: number;
  conflictSyncCount?: number;
  onDashboard?: () => void;
  /** 資料保存位置；非 cloud 時不顯示任何雲端同步狀態。 */
  storageMode?: StorageMode;
  /** 今日菜單（或菜單名稱 snapshot）。 */
  todayMenu?: { itemName: string } | null;
  todayMenuName?: string;
}
export const TopBar = React.memo(function TopBar({ tab, setTab, navigationLocked, online, syncing, lastSync, todayCount, todayOtherCount = 0, viewDate, setViewDate, queuedCount = 0, failedSyncCount = 0, conflictSyncCount = 0, onDashboard, storageMode = 'cloud', todayMenu, todayMenuName }: TopBarProps) {
  const simulationDate = useSimulationDate();
  const { faceDevices } = useFace();
  const faceDeviceList = Object.values(faceDevices).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  const menuName = (todayMenuName ?? todayMenu?.itemName ?? '').trim();
  const todayMealLabel = menuName ? `今日餐點（${menuName}）` : '今日餐點（未設定）';
  return (
    <AppShell active={tab} select={setTab} disabled={navigationLocked} brand={<div className="brand">
        <div className="brand-mark" aria-hidden="true">●</div>
        <div className="brand-text">
          <div className="brand-name">訂餐櫃台</div>
          <div className="brand-sub" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              className="topbar-date"
              type="date"
              value={viewDate}
              onChange={e => setViewDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: 'inherit', fontFamily: 'inherit', cursor: 'pointer' }}
            />
            <button
              className="db-trigger"
              title="前一天" aria-label="前一天"
              style={{ width: '22px', height: '22px', fontSize: '10px', borderRadius: '4px' }}
              onClick={() => {
                const d = new Date(viewDate);
                d.setDate(d.getDate() - 1);
                setViewDate(d.toISOString().split('T')[0]);
              }}
            ><ChevronLeft size={14} aria-hidden="true" /></button>
            <button
              className="db-trigger"
              title="後一天" aria-label="後一天"
              style={{ width: '22px', height: '22px', fontSize: '10px', borderRadius: '4px' }}
              onClick={() => {
                const d = new Date(viewDate);
                d.setDate(d.getDate() + 1);
                setViewDate(d.toISOString().split('T')[0]);
              }}
            ><ChevronRight size={14} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
      } status={<div className="status">
        {storageMode === 'cloud' ? (
          <div className={'sync ' + (online ? 'sync-on' : 'sync-off')}>
            <span className={'dot ' + (syncing ? 'dot-pulse' : '') + (!online ? ' dot-red' : '')}></span>
            <div className="sync-txt">
              <div className="sync-label">{online ? '雲端已同步' : <><TriangleAlert size={14} aria-hidden="true" /> 離線中</>}</div>
              <div className="sync-meta">{syncing ? '推送中…' : online ? `上次 ${lastSync}` : '等待連線恢復…'}</div>
            </div>
          </div>
        ) : (
          // M0／F06：本機模式沒有遠端確認，不顯示「已同步／推送中」。
          <div className="sync sync-local" data-storage-mode={storageMode}>
            <span className="dot"></span>
            <div className="sync-txt">
              <div className="sync-label">{storageMode === 'prototype' ? '本機練習 · 僅此瀏覽器' : '本機模式 · 未連雲端'}</div>
              <div className="sync-meta">{storageMode === 'prototype' && simulationDate ? `練習營業日 ${simulationDate}` : '資料只存在這個瀏覽器'}</div>
            </div>
          </div>
        )}
        {(failedSyncCount > 0 || conflictSyncCount > 0) && (
          <div className="sync sync-err" style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: 'var(--r)', background: 'var(--red-soft)', border: '1px solid var(--red)', fontSize: '12px', color: 'var(--red)' }}>
            <span><TriangleAlert size={14} aria-hidden="true" /> 同步異常</span>
            <span style={{ marginLeft: '4px' }}>
              {failedSyncCount > 0 && `${failedSyncCount} 筆失敗`}
              {failedSyncCount > 0 && conflictSyncCount > 0 && '、'}
              {conflictSyncCount > 0 && `${conflictSyncCount} 筆衝突`}
            </span>
          </div>
        )}
        {/* 刷臉平板只顯示在線／離線（CheerC 2026-10-13：頂部不放刷臉統計數字）。沒有平板登記時不顯示。 */}
        {faceDeviceList.map(d => {
          const detail = [
            `最後上線 ${formatTaipeiDateTime(d.lastSeenAt) || '—'}`,
            d.appVersion ? `App ${d.appVersion}` : '',
            d.modelVersion ? `模型 ${d.modelVersion}` : '',
          ].filter(Boolean).join(' · ');
          return (
            <div
              key={d.deviceId}
              className={'face-device ' + (d.online ? 'face-device-on' : 'face-device-off')}
              title={`${faceDeviceLabel(d.deviceId)}：${detail}`}
              aria-label={`${faceDeviceLabel(d.deviceId)} ${d.online ? '在線' : '離線'}，${detail}`}
            >
              <span className="dot"></span>
              <span>{faceDeviceList.length > 1 ? faceDeviceLabel(d.deviceId) : '刷臉平板'} · {d.online ? '在線' : '離線'}</span>
            </div>
          );
        })}
        <div className="counter" data-testid="topbar-counter">
          <div className="counter-row">
            <span className="counter-name" title={todayMealLabel}>{todayMealLabel}</span>
            <span className="counter-val">{todayCount}</span>
          </div>
          <div className="counter-row">
            <span className="counter-name" title="其他餐點">其他餐點</span>
            <span className="counter-val">{todayOtherCount}</span>
          </div>
          {queuedCount > 0 && (
            <div className="counter-queued">{queuedCount} 筆待傳</div>
          )}
        </div>
        {onDashboard && (
          <button className="db-trigger" disabled={navigationLocked} onClick={onDashboard} title="今日營運概覽 (F6)" aria-label="今日營運概覽">
            <ChartColumn size={18} aria-hidden="true" />
          </button>
        )}
      </div>} />
  );
});
