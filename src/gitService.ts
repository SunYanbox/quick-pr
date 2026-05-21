import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { info, warn, error as logError } from './logger';

const execAsync = promisify(exec);

interface GitAPI {
  getAPI(version: number): GitExtensionAPI;
}

interface GitExtensionAPI {
  repositories: Repository[];
}

interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
  add(paths: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  push(remote: string, branch: string, setUpstream: boolean): Promise<void>;
  createWorktree(path: string, options?: { commitish?: string; branch?: string }): Promise<string>;
  deleteWorktree(path: string, options?: { force?: boolean }): Promise<void>;
  kind: string;
}

interface RepositoryState {
  HEAD: { name?: string; commit?: string } | undefined;
  indexChanges: { uri: vscode.Uri }[];
  workingTreeChanges: { uri: vscode.Uri }[];
}

function getGitApi(): GitExtensionAPI | null {
  const gitExt = vscode.extensions.getExtension<GitAPI>('vscode.git');
  if (!gitExt?.exports) {
    const msg = 'Built-in Git extension not found';
    logError('[gitService.getGitApi]', msg, { extensionExists: !!gitExt, hasExports: !!gitExt?.exports });
    vscode.window.showErrorMessage(msg);
    return null;
  }
  try {
    return gitExt.exports.getAPI(1);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('[gitService.getGitApi]', 'Failed to get Git API (version mismatch?)', {}, e);
    vscode.window.showErrorMessage(`Failed to get Git API: ${msg}`);
    return null;
  }
}

export interface GitStatus {
  hasStagedChanges: boolean;
  hasWorkingChanges: boolean;
  currentBranch: string;
  repo: Repository;
}

export interface ChangedFile {
  path: string;
  status: 'staged' | 'modified';
}

export function getChangedFiles(repo: Repository): ChangedFile[] {
  const files = new Map<string, ChangedFile>();

  for (const change of repo.state.indexChanges) {
    const path = change.uri.fsPath;
    const status: ChangedFile['status'] = 'staged';
    files.set(path, { path, status });
  }

  for (const change of repo.state.workingTreeChanges) {
    const path = change.uri.fsPath;
    if (!files.has(path)) {
      const status: ChangedFile['status'] = 'modified';
      files.set(path, { path, status });
    }
  }

  return Array.from(files.values());
}

export function getCurrentRepo(): GitStatus | null {
  const api = getGitApi();
  if (!api || api.repositories.length === 0) {
    const msg = 'No Git repositories found in workspace';
    logError('[gitService.getCurrentRepo]', msg, { apiAvailable: !!api, repoCount: api?.repositories?.length ?? 0 });
    vscode.window.showErrorMessage(msg);
    return null;
  }

  const repo = api.repositories[0];
  const state = repo.state;
  const headName = state.HEAD?.name || 'HEAD';

  info('[gitService.getCurrentRepo]', 'Current repo resolved', {
    root: repo.rootUri.fsPath,
    branch: headName,
    stagedCount: state.indexChanges.length,
    workingCount: state.workingTreeChanges.length,
  });

  return {
    hasStagedChanges: state.indexChanges.length > 0,
    hasWorkingChanges: state.workingTreeChanges.length > 0,
    currentBranch: headName,
    repo,
  };
}

export async function copyFilesToWorktree(
  originalRoot: string,
  worktreePath: string,
  selectedFiles: string[],
): Promise<boolean> {
  info('[gitService.copyFilesToWorktree]', 'Copying files to worktree', {
    originalRoot,
    worktreePath,
    fileCount: selectedFiles.length,
    files: selectedFiles.slice(0, 5),
  });

  try {
    for (const filePath of selectedFiles) {
      const relativePath = path.relative(originalRoot, filePath);
      const targetPath = path.join(worktreePath, relativePath);

      if (fs.existsSync(filePath)) {
        const targetDir = path.dirname(targetPath);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(filePath, targetPath);
      } else {
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
      }
    }

    if (selectedFiles.length > 0) {
      await execAsync('git add -A', { cwd: worktreePath, timeout: 30000 });
    }

    info('[gitService.copyFilesToWorktree]', 'Files copied and staged successfully');
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('[gitService.copyFilesToWorktree]', 'Failed to copy files to worktree', {
      originalRoot,
      worktreePath,
      fileCount: selectedFiles.length,
    }, e);
    vscode.window.showErrorMessage(`Failed to copy files to worktree: ${msg}`);
    return false;
  }
}

async function branchExists(branchName: string, cwd: string): Promise<boolean> {
  try {
    await execAsync(`git rev-parse --verify "${branchName}"`, { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function createWorktree(
  repo: Repository,
  branchName: string,
): Promise<string | null> {
  if (!branchName || !branchName.trim()) {
    logError('[gitService.createWorktree]', 'Branch name is empty');
    vscode.window.showErrorMessage('Branch name cannot be empty');
    return null;
  }

  const safeName = branchName.replace(/\//g, '-');
  if (!safeName) {
    logError('[gitService.createWorktree]', 'Invalid branch name after sanitization', { branchName, safeName });
    vscode.window.showErrorMessage('Invalid branch name for worktree');
    return null;
  }

  const rootPath = repo.rootUri.fsPath;
  if (!rootPath) {
    logError('[gitService.createWorktree]', 'Repository root path is empty');
    vscode.window.showErrorMessage('Invalid repository root path');
    return null;
  }

  const worktreeDir = path.join(rootPath, '.quick-pr-studio', 'worktrees');
  const worktreePath = path.join(worktreeDir, safeName);

  const commitish = repo.state.HEAD?.name;
  if (!commitish) {
    logError('[gitService.createWorktree]', 'HEAD has no branch name (detached or empty repo)', { rootPath });
    vscode.window.showErrorMessage('Repository has no commits (HEAD is detached or empty)');
    return null;
  }

  info('[gitService.createWorktree]', 'Creating worktree', {
    worktreePath,
    branchName,
    commitish,
    rootPath,
  });

  try {
    if (!fs.existsSync(worktreeDir)) {
      fs.mkdirSync(worktreeDir, { recursive: true });
    }

    try {
      await repo.createWorktree(worktreePath, {
        commitish: commitish,
        branch: branchName,
      });
      info('[gitService.createWorktree]', 'Worktree created via VSCode API', { worktreePath });
      return worktreePath;
    } catch (apiError: unknown) {
      const apiMsg = apiError instanceof Error ? apiError.message : String(apiError);
      warn('[gitService.createWorktree]', 'VSCode Git API failed, falling back to native git', {
        apiError: apiMsg,
        worktreePath,
        branchName,
      });

      if (fs.existsSync(worktreePath)) {
        info('[gitService.createWorktree]', 'Removing stale worktree directory', { worktreePath });
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      await execAsync('git worktree prune', { cwd: rootPath, timeout: 10000 });
      info('[gitService.createWorktree]', 'Stale worktree registrations pruned');

      const branchAlreadyExists = await branchExists(branchName, rootPath);
      if (branchAlreadyExists) {
        info('[gitService.createWorktree]', 'Branch already exists, adding worktree without -b', { branchName });
        const command = `git worktree add "${worktreePath}" "${branchName}"`;
        info('[gitService.createWorktree]', 'Executing native git command', { command });

        const { stderr } = await execAsync(command, {
          cwd: rootPath,
          timeout: 30000,
        });

        if (stderr && !stderr.includes('Preparing worktree')) {
          warn('[gitService.createWorktree]', 'Git worktree stderr', { stderr });
        }

        info('[gitService.createWorktree]', 'Worktree created via native git (existing branch)', { worktreePath });
        return worktreePath;
      }

      const command = `git worktree add -b "${branchName}" "${worktreePath}" "${commitish}"`;
      info('[gitService.createWorktree]', 'Executing native git command', { command });

      const { stderr } = await execAsync(command, {
        cwd: rootPath,
        timeout: 30000,
      });

      if (stderr && !stderr.includes('Preparing worktree')) {
        warn('[gitService.createWorktree]', 'Git worktree stderr', { stderr });
      }

      info('[gitService.createWorktree]', 'Worktree created via native git', { worktreePath });
      return worktreePath;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('[gitService.createWorktree]', 'Failed to create worktree', {
      worktreePath,
      branchName,
      commitish,
      rootPath,
    }, e);
    vscode.window.showErrorMessage(`Failed to create worktree: ${msg}`);
    return null;
  }
}

function httpsToSshUrl(httpsUrl: string): string | null {
  const match = /^https:\/\/([^\/]+)\/(.+?)(?:\.git)?$/.exec(httpsUrl);
  if (!match) return null;
  const [, host, path] = match;
  return `git@${host}:${path}.git`;
}

async function detectProxy(cwd: string): Promise<string | null> {
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy ||
                   process.env.HTTP_PROXY || process.env.http_proxy ||
                   process.env.ALL_PROXY || process.env.all_proxy;
  if (envProxy) return envProxy;

  try {
    const { stdout } = await execAsync('git config --get http.proxy', { cwd, timeout: 5000 });
    const proxy = stdout.trim();
    if (proxy) return proxy;
  } catch {
    // No git proxy configured
  }

  return null;
}

export async function checkRemoteBranch(worktreePath: string, branchName: string): Promise<boolean> {
  try {
    await execAsync(`git ls-remote --heads origin "${branchName}"`, {
      cwd: worktreePath,
      timeout: 15000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function commitOnly(
  worktreePath: string,
  commitMsg: string,
): Promise<boolean> {
  info('[gitService.commitOnly]', 'Starting commit', {
    worktreePath,
    commitMsgPreview: commitMsg.slice(0, 80),
  });

  try {
    await execAsync('git add -A', { cwd: worktreePath, timeout: 30000 });

    const { stdout: statusOut } = await execAsync('git status --porcelain', {
      cwd: worktreePath,
      timeout: 10000,
    });

    if (!statusOut.trim()) {
      info('[gitService.commitOnly]', 'No changes to commit');
      return true;
    }

    const msgFile = path.join(worktreePath, '.quick-pr-studio-commit-msg');
    fs.writeFileSync(msgFile, commitMsg, 'utf-8');

    try {
      await execAsync(`git commit -F "${msgFile}"`, { cwd: worktreePath, timeout: 30000 });
    } finally {
      if (fs.existsSync(msgFile)) {
        fs.unlinkSync(msgFile);
      }
    }

    info('[gitService.commitOnly]', 'Commit successful');
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('[gitService.commitOnly]', 'Commit failed', {
      worktreePath,
      commitMsgPreview: commitMsg.slice(0, 80),
    }, e);
    vscode.window.showErrorMessage(`Git commit failed: ${msg}`);
    return false;
  }
}

export async function pushWithFallbacks(
  worktreePath: string,
  branchName: string,
): Promise<boolean> {
  info('[gitService.pushWithFallbacks]', 'Starting push', {
    worktreePath,
    branchName,
  });

  try {
    const remoteExists = await checkRemoteBranch(worktreePath, branchName);

    const pushArgs = remoteExists
      ? `git push origin "${branchName}"`
      : `git push -u origin "${branchName}"`;

    try {
      await execAsync(pushArgs, { cwd: worktreePath, timeout: 60000 });
      info('[gitService.pushWithFallbacks]', 'Push successful');
      return true;
    } catch (pushError: unknown) {
      const pushMsg = pushError instanceof Error ? pushError.message : String(pushError);
      warn('[gitService.pushWithFallbacks]', 'Initial push failed, attempting fallbacks', {
        branchName,
        error: pushMsg,
      });

      const { stdout: remoteUrl } = await execAsync('git remote get-url origin', {
        cwd: worktreePath,
        timeout: 10000,
      }).catch(() => ({ stdout: '' }));

      const sshUrl = remoteUrl.trim() && httpsToSshUrl(remoteUrl.trim());

      if (sshUrl) {
        try {
          info('[gitService.pushWithFallbacks]', 'Retrying push via SSH', { sshUrl });
          if (remoteExists) {
            await execAsync(`git push "${sshUrl}" "${branchName}"`, {
              cwd: worktreePath,
              timeout: 60000,
            });
          } else {
            await execAsync(`git push -u "${sshUrl}" "${branchName}"`, {
              cwd: worktreePath,
              timeout: 60000,
            });
          }
          info('[gitService.pushWithFallbacks]', 'SSH push successful', { branchName });

          await execAsync(`git remote set-url origin "${sshUrl}"`, {
            cwd: worktreePath,
            timeout: 10000,
          }).catch(() => {});

          return true;
        } catch (sshError: unknown) {
          const sshMsg = sshError instanceof Error ? sshError.message : String(sshError);
          warn('[gitService.pushWithFallbacks]', 'SSH fallback failed', { error: sshMsg });
        }
      }

      const proxy = await detectProxy(worktreePath);
      if (proxy) {
        try {
          info('[gitService.pushWithFallbacks]', 'Retrying push via proxy');
          const proxyArgs = remoteExists
            ? `git -c http.proxy="${proxy}" push origin "${branchName}"`
            : `git -c http.proxy="${proxy}" push -u origin "${branchName}"`;
          await execAsync(proxyArgs, { cwd: worktreePath, timeout: 60000 });
          info('[gitService.pushWithFallbacks]', 'Proxy push successful', { branchName });
          return true;
        } catch (proxyError: unknown) {
          const proxyMsg = proxyError instanceof Error ? proxyError.message : String(proxyError);
          warn('[gitService.pushWithFallbacks]', 'Proxy fallback failed', { error: proxyMsg });
        }
      }

      throw pushError;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('[gitService.pushWithFallbacks]', 'Push failed', {
      worktreePath,
      branchName,
    }, e);
    vscode.window.showErrorMessage(`Git push failed: ${msg}`);
    return false;
  }
}

export async function commitAndPush(
  worktreePath: string,
  commitMsg: string,
  branchName: string,
): Promise<boolean> {
  info('[gitService.commitAndPush]', 'Starting commit and push', {
    worktreePath,
    branchName,
    commitMsgPreview: commitMsg.slice(0, 80),
  });

  const committed = await commitOnly(worktreePath, commitMsg);
  if (!committed) return false;

  return pushWithFallbacks(worktreePath, branchName);
}

export async function getBranchDiff(
  worktreePath: string,
  baseCommitish: string,
  maxLength: number = 8000,
): Promise<string> {
  try {
    const { stdout } = await execAsync(`git diff ${baseCommitish}..HEAD`, {
      cwd: worktreePath,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    const trimmed = stdout.trim();
    if (!trimmed) return '';
    if (trimmed.length > maxLength) {
      return trimmed.slice(0, maxLength) + '\n...(diff truncated)';
    }
    return trimmed;
  } catch (e: unknown) {
    warn('[gitService.getBranchDiff]', 'Failed to get branch diff', { baseCommitish });
    return '';
  }
}

export async function deleteWorktree(
  mainRepoPath: string,
  worktreePath: string,
): Promise<boolean> {
  info('[gitService.deleteWorktree]', 'Deleting worktree', { worktreePath });

  try {
    await execAsync(`git worktree remove --force "${worktreePath}"`, {
      cwd: mainRepoPath,
      timeout: 30000,
    });
    info('[gitService.deleteWorktree]', 'Worktree deleted', { worktreePath });
    return true;
  } catch (e: unknown) {
    try {
      warn('[gitService.deleteWorktree]', 'git worktree remove failed, trying force cleanup', { worktreePath });
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      await execAsync('git worktree prune', { cwd: mainRepoPath, timeout: 10000 });
      info('[gitService.deleteWorktree]', 'Worktree force-removed', { worktreePath });
      return true;
    } catch (rmError: unknown) {
      const msg = rmError instanceof Error ? rmError.message : String(rmError);
      logError('[gitService.deleteWorktree]', 'Failed to delete worktree', { worktreePath }, rmError);
      vscode.window.showErrorMessage(`Failed to delete worktree: ${msg}`);
      return false;
    }
  }
}

export async function openPrUrl(url: string): Promise<void> {
  info('[gitService.openPrUrl]', 'Prompting user to open PR URL', { url });
  const action = await vscode.window.showInformationMessage(
    'PR created successfully!',
    'Open in Browser',
  );
  if (action === 'Open in Browser') {
    info('[gitService.openPrUrl]', 'User chose to open in browser', { url });
    vscode.env.openExternal(vscode.Uri.parse(url));
  } else {
    info('[gitService.openPrUrl]', 'User dismissed PR URL prompt');
  }
}

export async function getFilesDiff(
  workspaceRoot: string,
  selectedFiles: string[],
  maxLength: number = 8000,
): Promise<string> {
  if (selectedFiles.length === 0) return '';

  try {
    const relativePaths = selectedFiles.map(f => path.relative(workspaceRoot, f));
    const parts: string[] = [];

    const trackedFiles: string[] = [];
    const untrackedFiles: string[] = [];

    for (const fp of relativePaths) {
      const { stdout: tracked } = await execAsync(
        `git ls-files --error-unmatch "${fp}"`,
        { cwd: workspaceRoot, timeout: 5000 },
      ).catch(() => ({ stdout: '' }));
      if (tracked) {
        trackedFiles.push(fp);
      } else {
        untrackedFiles.push(fp);
      }
    }

    if (trackedFiles.length > 0) {
      const { stdout } = await execAsync(
        `git diff HEAD -- ${trackedFiles.map(p => `"${p}"`).join(' ')}`,
        { cwd: workspaceRoot, timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      if (stdout.trim()) parts.push(stdout.trim());
    }

    for (const fp of untrackedFiles) {
      const fullPath = path.join(workspaceRoot, fp);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const diffHeader = `diff --git a/${fp} b/${fp}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/${fp}\n`;
        const body = lines.map(l => `+${l}`).join('\n');
        parts.push(diffHeader + body);
      }
    }

    if (parts.length === 0) return '';
    const combined = parts.join('\n');
    if (combined.length > maxLength) {
      return combined.slice(0, maxLength) + '\n...(diff truncated)';
    }
    return combined;
  } catch (e: unknown) {
    warn('[gitService.getFilesDiff]', 'Failed to get file diff', {
      fileCount: selectedFiles.length,
    });
    return '';
  }
}

export async function getRecentCommits(workspaceRoot: string, count: number = 5): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `git log -${count} --format=%s`,
      { cwd: workspaceRoot, timeout: 10000 },
    );
    const commits = stdout
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    info('[gitService.getRecentCommits]', 'Recent commits fetched', { count: commits.length });
    return commits;
  } catch (e: unknown) {
    warn('[gitService.getRecentCommits]', 'Failed to fetch recent commits', { count });
    return [];
  }
}
