import * as vscode from 'vscode';
import { exec } from 'child_process';
import { info, error as logError } from './logger';

export async function checkGhCli(): Promise<boolean> {
  return new Promise((resolve) => {
    exec('gh --version', (error) => {
      if (error) {
        logError('[prService.checkGhCli]', 'GitHub CLI (gh) is not installed', {
          code: (error as any)?.code,
          message: error.message,
        });
        vscode.window.showErrorMessage(
          'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/',
        );
        resolve(false);
      } else {
        info('[prService.checkGhCli]', 'GitHub CLI is available');
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

  info('[prService.createPr]', 'Creating PR', {
    titlePreview: title.slice(0, 80),
    base,
    head,
    worktreePath,
    bodyLength: body.length,
  });

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
        const errMsg = stderr || error.message;
        logError('[prService.createPr]', 'Failed to create PR', {
          titlePreview: title.slice(0, 80),
          base,
          head,
          worktreePath,
          exitCode: (error as any)?.code,
          stderr: stderr || '(no stderr)',
        }, error);
        vscode.window.showErrorMessage(
          `Failed to create PR: ${errMsg}`,
        );
        resolve(null);
        return;
      }
      const url = stdout.trim();
      info('[prService.createPr]', 'PR created successfully', { url });
      resolve(url);
    });
  });
}
