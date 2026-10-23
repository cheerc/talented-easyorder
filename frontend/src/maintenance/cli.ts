/** RED stub: the contract lives in the tests; the behavior arrives with the GREEN commit. */
export interface CliIo {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string): Promise<void>;
  readPassword(): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
  now(): number;
}

export async function main(_argv: string[], io: CliIo): Promise<number> {
  io.stderr('尚未實作\n');
  return 70;
}
