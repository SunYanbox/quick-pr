import * as vscode from 'vscode';
import { exec } from 'child_process';
import { info, error as logError } from './logger';

export async function checkGhCli(): Promise<boolean> {
  // Check if gh CLI is installed
  const installed = await new Promise<boolean>((resolve) => {
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
        resolve(true);
      }
    });
  });

  if (!installed) return false;

  // Also check if gh is authenticated
  return new Promise((resolve) => {
    exec('gh auth status', (authError: Error | null) => {
      if (authError) {
        const hint = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
          ? 'Make sure your GH_TOKEN or GITHUB_TOKEN environment variable is valid and has not expired.'
          : 'Run "gh auth login" to authenticate, or set the GH_TOKEN environment variable.';
        logError('[prService.checkGhCli]', 'GitHub CLI is not authenticated', {
          hint,
          stderr: authError.message,
        });
        vscode.window.showErrorMessage(
          `GitHub CLI (gh) is not authenticated. ${hint}`,
        );
        resolve(false);
      } else {
        info('[prService.checkGhCli]', 'GitHub CLI is installed and authenticated');
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
