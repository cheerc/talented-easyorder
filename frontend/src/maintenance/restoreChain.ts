/**
 * The restore chain: the encrypted P14 increments that, replayed in order, rebuild a dataset. Reading and checking
 * the chain is offline and read-only; every rule fails closed with a message that names the rule, never data.
 */
import path from 'node:path';
import {
  BackupValidationError, decryptBackup, recalculateBackupTotals, replayBackupProjections, sha256Hex, stableJson,
  type BackupCommandRecord, type BackupManifest,
} from '../firebase/cloudBackup';

export const RESTORE_CHAIN_FORMAT = 'easyorder-restore-chain' as const;

export class RestoreChainError extends Error {
  constructor(message: string) { super(message); this.name = 'RestoreChainError'; }
}

export interface RestoreChainEntry { file: string; sha256: string | null }
export interface RestoreChainFile { datasetId: string; packages: RestoreChainEntry[] }

export interface LoadedPackage {
  file: string;
  sha256: string;
  manifest: BackupManifest;
}

export interface LoadedChain {
  datasetId: string;
  commandSchemaVersion: number;
  packages: LoadedPackage[];
  /** Every command record of the chain in seq order, 1..lastSeq. */
  records: BackupCommandRecord[];
  lastSeq: number;
  decryptMs: number;
}

export interface ChainIo {
  readFile(filePath: string): Promise<Uint8Array<ArrayBuffer>>;
  now(): number;
}

export interface Replayed {
  toSeq: number;
  /** The packages whose toSeq equals H, as a 1-based package number; null when H is not a package boundary. */
  boundaryPackage: number | null;
  projections: Record<string, unknown>;
  totals: Record<string, Record<string, number>>;
  replayMs: number;
}

/** Parses the local chain file (the `--manifest` of the CLI). */
export function parseChainFile(text: string): RestoreChainFile {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new RestoreChainError('還原鏈檔不是有效的 JSON'); }
  const chain = value as Record<string, unknown> | null;
  if (!chain || typeof chain !== 'object' || chain.format !== RESTORE_CHAIN_FORMAT || chain.version !== 1) {
    throw new RestoreChainError(`還原鏈檔格式不支援（需要 format ${RESTORE_CHAIN_FORMAT}、version 1）`);
  }
  if (typeof chain.datasetId !== 'string' || chain.datasetId.length === 0) throw new RestoreChainError('還原鏈檔缺少 datasetId');
  if (!Array.isArray(chain.packages) || chain.packages.length === 0) throw new RestoreChainError('還原鏈檔沒有任何備份包（packages 為空）');
  const packages = chain.packages.map((entry: unknown, index: number): RestoreChainEntry => {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item !== 'object' || typeof item.file !== 'string' || item.file.length === 0
      || (item.sha256 !== undefined && !(typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256)))) {
      throw new RestoreChainError(`還原鏈檔第 ${index + 1} 包的 file 或 sha256 格式不正確`);
    }
    return { file: item.file, sha256: typeof item.sha256 === 'string' ? item.sha256 : null };
  });
  return { datasetId: chain.datasetId, packages };
}

/** Reads, hash-checks, decrypts and links every package. The password is asked for once, after the chain file parsed. */
export async function loadChain(
  chainPath: string, chainFile: RestoreChainFile, askPassword: () => Promise<string>, io: ChainIo,
): Promise<LoadedChain> {
  const directory = path.dirname(chainPath);
  const files: Array<{ entry: RestoreChainEntry; bytes: Uint8Array<ArrayBuffer>; sha256: string }> = [];
  for (const entry of chainFile.packages) {
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = await io.readFile(path.resolve(directory, entry.file)); }
    catch { throw new RestoreChainError(`讀不到備份包 ${entry.file}`); }
    const sha256 = await sha256Hex(bytes);
    if (entry.sha256 !== null && entry.sha256 !== sha256) {
      throw new RestoreChainError(`備份包 ${entry.file} 的 SHA-256 與還原鏈檔記載的不同`);
    }
    files.push({ entry, bytes, sha256 });
  }
  const password = await askPassword();
  const startedAt = io.now();
  const packages: LoadedPackage[] = [];
  for (const { entry, bytes, sha256 } of files) {
    const manifest = await decryptBackup(bytes, password);
    packages.push({ file: entry.file, sha256, manifest });
  }
  const decryptMs = io.now() - startedAt;
  linkPackages(chainFile.datasetId, packages);
  const records = packages.flatMap(item => item.manifest.records);
  records.forEach((record, index) => {
    if (record.seq !== index + 1) throw new RestoreChainError(`命令鏈在 seq ${index + 1} 中斷或重複`);
  });
  const first = packages[0]!.manifest;
  return {
    datasetId: chainFile.datasetId, commandSchemaVersion: first.commandSchemaVersion, packages, records,
    lastSeq: packages[packages.length - 1]!.manifest.toSeq, decryptMs,
  };
}

/** Rules R5: one dataset, one schema, a first package from seq 0, and every package continuing the previous one. */
function linkPackages(datasetId: string, packages: LoadedPackage[]): void {
  packages.forEach((current, index) => {
    const number = index + 1;
    const manifest = current.manifest;
    if (manifest.datasetId !== datasetId) {
      throw new RestoreChainError(`第 ${number} 包的 datasetId 與還原鏈檔不一致（備份包 ${current.file}）`);
    }
    if (manifest.commandSchemaVersion !== packages[0]!.manifest.commandSchemaVersion) {
      throw new RestoreChainError(`第 ${number} 包的 commandSchemaVersion 與第一包不同`);
    }
    if (index === 0) {
      if (manifest.fromSeq !== 0 || manifest.previousPackageSha256 !== null) {
        throw new RestoreChainError(`第一包必須從 seq 0 開始且沒有前包（目前 fromSeq=${manifest.fromSeq}）`);
      }
      return;
    }
    const previous = packages[index - 1]!;
    if (manifest.fromSeq !== previous.manifest.toSeq) {
      throw new RestoreChainError(`第 ${number} 包的 fromSeq（${manifest.fromSeq}）與前包 toSeq（${previous.manifest.toSeq}）不接`);
    }
    if (manifest.previousPackageSha256 !== previous.sha256) {
      throw new RestoreChainError(`第 ${number} 包的 previousPackageSha256 不是前一包的 SHA-256`);
    }
    if (stableJson(manifest.baseState) !== stableJson(previous.manifest.projectionState)) {
      throw new RestoreChainError(`第 ${number} 包的 baseState 與前包 projectionState 不同`);
    }
  });
}

/** Replays the first H commands from an empty state and, at a package boundary, checks the package's own projection. */
export function replayTo(chain: LoadedChain, toSeq: number, io: Pick<ChainIo, 'now'>): Replayed {
  if (!Number.isSafeInteger(toSeq) || toSeq < 0) throw new RestoreChainError('--to-seq 必須是非負整數');
  if (toSeq > chain.lastSeq) throw new RestoreChainError(`--to-seq ${toSeq} 超過最後一包的 toSeq（${chain.lastSeq}）`);
  const startedAt = io.now();
  const projections = replayBackupProjections(chain.records.slice(0, toSeq), {});
  const totals = recalculateBackupTotals(projections);
  const index = toSeq > 0 ? chain.packages.findIndex(item => item.manifest.toSeq === toSeq) : -1;
  if (index >= 0) {
    const manifest = chain.packages[index]!.manifest;
    if (stableJson(projections) !== stableJson(manifest.projectionState) || stableJson(totals) !== stableJson(manifest.totals)) {
      throw new BackupValidationError(`重播到 seq ${toSeq} 的結果與第 ${index + 1} 包的 projectionState 不同`);
    }
  }
  return { toSeq, boundaryPackage: index >= 0 ? index + 1 : null, projections, totals, replayMs: io.now() - startedAt };
}
