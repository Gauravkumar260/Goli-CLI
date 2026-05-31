import { createTwoFilesPatch } from 'diff';
import * as readline from 'readline/promises';

export function renderDiff(path: string, before: string, after: string) {
  const patch = createTwoFilesPatch(path, path, before, after, '', '', { context: 3 });
  
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      process.stdout.write(`\x1b[32m${line}\x1b[0m\n`); // green
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      process.stdout.write(`\x1b[31m${line}\x1b[0m\n`); // red
    } else if (line.startsWith('@@')) {
      process.stdout.write(`\x1b[36m${line}\x1b[0m\n`); // cyan
    } else {
      process.stdout.write(line + '\n');
    }
  }
}

export function logTurn(turn: number, totalTurns?: number) {
  const total = totalTurns ? `/${totalTurns}` : '';
  process.stdout.write(`\n\x1b[1m─── Turn ${turn + 1}${total} ──────────────────────────────────────────\x1b[0m\n`);
}

export function logAction(name: string, input: any) {
  process.stdout.write(`\x1b[34m→ ${name}\x1b[0m ${JSON.stringify(input)}\n`);
}

export function logSuccess(message: string) {
  process.stdout.write(`\x1b[32m✓ ${message}\x1b[0m\n`);
}

export function logFailure(message: string) {
  process.stdout.write(`\x1b[31m✗ ${message}\x1b[0m\n`);
}

export async function requestConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\n\x1b[33m? ${message} (y/n): \x1b[0m`);
    return answer.toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}
