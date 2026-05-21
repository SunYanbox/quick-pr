import * as vscode from 'vscode';
import { spawn, exec } from 'child_process';
import { debug, info, error as logError } from './logger';

export async function checkGhCli(): Promise<boolean> {
  debug('[prService.checkGhCli]', 'Checking GitHub CLI availability');

  // Check if gh CLI is installed
  const installed = await new Promise<boolean>((resolve) => {
    try {
      debug('[prService.checkGhCli]', 'Running: gh --version');
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
          debug('[prService.checkGhCli]', 'gh --version succeeded');
          resolve(true);
        }
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : '';
      logError('[prService.checkGhCli]', `Unexpected error checking gh CLI: ${msg}`, {
        errorName: e instanceof Error ? e.name : typeof e,
        stack: stack?.slice(0, 500),
      });
      resolve(false);
    }
  });

  if (!installed) return false;

  // Also check if gh is authenticated
  return new Promise((resolve) => {
    try {
      debug('[prService.checkGhCli]', 'Running: gh auth status');
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : '';
      logError('[prService.checkGhCli]', `Unexpected error checking gh auth: ${msg}`, {
        errorName: e instanceof Error ? e.name : typeof e,
        stack: stack?.slice(0, 500),
      });
      resolve(false);
    }
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

    let stdout = '';
    let stderr = '';
    const child = spawn('gh', args, { cwd: worktreePath });
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', (spawnError) => {
      logError('[prService.createPr]', 'Failed to spawn gh process', {
        titlePreview: title.slice(0, 80),
        base,
        head,
        worktreePath,
      }, spawnError);
      vscode.window.showErrorMessage(
        `Failed to create PR: ${spawnError.message}`,
      );
      resolve(null);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const errMsg = stderr || `Exit code ${code}`;
        logError('[prService.createPr]', 'Failed to create PR', {
          titlePreview: title.slice(0, 80),
          base,
          head,
          worktreePath,
          exitCode: code,
          stderr: stderr || '(no stderr)',
        });
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
