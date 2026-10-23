/** The real terminal, file system and clock behind `CliIo`. Nothing here is covered by unit tests; the Emulator spec runs it. */
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { CliIo } from './cli';

const PROMPT = '備份密碼（輸入不會顯示）：';

/** Reads a line from a TTY without echo. Ctrl-C aborts. */
function readHiddenLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';
    process.stderr.write(PROMPT);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stderr.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n' || character === '\u0004') return finish();
        if (character === '\u0003') return finish(new Error('已取消'));
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else value += character;
      }
    };
    stdin.on('data', onData);
  });
}

/** Reads the first line of a pipe (or up to end of input). */
async function readFirstLine(): Promise<string> {
  const chunks: string[] = [];
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    chunks.push(String(chunk));
    const joined = chunks.join('');
    const newline = joined.indexOf('\n');
    if (newline >= 0) return joined.slice(0, newline).replace(/\r$/, '');
  }
  return chunks.join('').replace(/\r?\n$/, '');
}

export function createNodeIo(): CliIo {
  return {
    async readFile(path) { return new Uint8Array(await readFile(path)); },
    async writeFile(path, data) { await writeFile(path, data, 'utf8'); },
    readPassword: () => (process.stdin.isTTY ? readHiddenLine() : readFirstLine()),
    stdout: text => { process.stdout.write(text); },
    stderr: text => { process.stderr.write(text); },
    now: () => performance.now(),
  };
}
