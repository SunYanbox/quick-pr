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
        // File exists — copy it (modified or added)
        const targetDir = path.dirname(targetPath);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(filePath, targetPath);
      } else {
        // File doesn't exist — it was deleted, remove from worktree
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
      }
    }

    // Stage all files in the worktree using native git
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

  const worktreeDir = path.join(rootPath, '.quick-pr', 'worktrees');
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
    // Ensure directory exists
    if (!fs.existsSync(worktreeDir)) {
      fs.mkdirSync(worktreeDir, { recursive: true });
    }

    // Try using VSCode Git API first
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

      // Clean up stale worktree directory and git registration from previous failed runs
      if (fs.existsSync(worktreePath)) {
        info('[gitService.createWorktree]', 'Removing stale worktree directory', { worktreePath });
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      // Prune stale worktree registrations in .git/worktrees/
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

      // Branch doesn't exist — normal flow
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

  try {
    // Safety: stage any changes before committing
    await execAsync('git add -A', { cwd: worktreePath, timeout: 30000 });

    // Write commit message to temp file to avoid shell escaping issues
    const msgFile = path.join(worktreePath, '.quick-pr-commit-msg');
    fs.writeFileSync(msgFile, commitMsg, 'utf-8');

    try {
      await execAsync(`git commit -F "${msgFile}"`, { cwd: worktreePath, timeout: 30000 });
    } finally {
      if (fs.existsSync(msgFile)) {
        fs.unlinkSync(msgFile);
      }
    }

    info('[gitService.commitAndPush]', 'Commit successful', { branchName });

    await execAsync(`git push -u origin "${branchName}"`, { cwd: worktreePath, timeout: 60000 });
    info('[gitService.commitAndPush]', 'Push successful', { branchName });

    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('[gitService.commitAndPush]', 'Commit or push failed', {
      worktreePath,
      branchName,
      commitMsgPreview: commitMsg.slice(0, 80),
    }, e);
    vscode.window.showErrorMessage(`Git operation failed: ${msg}`);
    return false;
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
    // If git worktree remove fails, force-remove the directory and prune
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
