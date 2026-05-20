import * as vscode from 'vscode';
import { exec } from 'child_process';

export async function checkGhCli(): Promise<boolean> {
  return new Promise((resolve) => {
    exec('gh --version', (error) => {
      if (error) {
        vscode.window.showErrorMessage(
          'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/',
        );
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

export interface PrCreateOptions {
  title: string;
  body: string;
  base: string;
  head: string;
  worktreePath: string;
}

export async function createPr(options: PrCreateOptions): Promise<string | null> {
  const { title, body, base, head, worktreePath } = options;

  return new Promise((resolve) => {
    const args = [
      'pr', 'create',
      '--base', base,
      '--head', head,
      '--title', title,
      '--body', body,
    ];

    const cmd = `gh ${args.map((a) => `"${a}"`).join(' ')}`;

    exec(cmd, { cwd: worktreePath }, (error, stdout, stderr) => {
      if (error) {
        vscode.window.showErrorMessage(
          `Failed to create PR: ${stderr || error.message}`,
        );
        resolve(null);
        return;
      }
      const url = stdout.trim();
      resolve(url);
    });
  });
}
