import process from 'node:process';
import { createInterface } from 'node:readline';

// Interactive y/N confirmation for the mutating CLI commands. The prompt is
// written to stderr so it never corrupts a piped stdout (the diff/summary).

export function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}

export async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question} `, resolve);
    });
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
