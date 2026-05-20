import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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
  createWorktree(options: {
    path: string;
    commitish?: string;
    branch?: string;
  }): Promise<string>;
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
    vscode.window.showErrorMessage('Built-in Git extension not found');
    return null;
  }
  try {
    return gitExt.exports.getAPI(1);
  } catch {
    vscode.window.showErrorMessage('Failed to get Git API (version mismatch?)');
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
    vscode.window.showErrorMessage('No Git repositories found in workspace');
    return null;
  }

  const repo = api.repositories[0];
  const state = repo.state;
  const headName = state.HEAD?.name || 'HEAD';

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
  repo: Repository,
): Promise<boolean> {
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

    // Stage all selected files in the worktree repo
    // Convert original paths to worktree paths for staging
    if (selectedFiles.length > 0) {
      const worktreePaths = selectedFiles.map((f) => {
        const rel = path.relative(originalRoot, f);
        return path.join(worktreePath, rel);
      });
      await repo.add(worktreePaths);
    }

    return true;
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to copy files to worktree: ${e.message}`);
    return false;
  }
}

export async function createWorktree(
  repo: Repository,
  branchName: string,
  rootUri: vscode.Uri,
): Promise<string | null> {
  const worktreeDir = vscode.Uri.joinPath(rootUri, '.quick-pr', 'worktrees');
  const safeName = branchName.replace(/\//g, '-');
  const worktreePath = vscode.Uri.joinPath(worktreeDir, safeName);

  // Ensure .quick-pr/worktrees/ directory exists
  try {
    fs.mkdirSync(worktreeDir.fsPath, { recursive: true });
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to create worktree directory: ${e.message}`);
    return null;
  }

  try {
    const createdPath = await repo.createWorktree({
      path: worktreePath.fsPath,
      commitish: repo.state.HEAD?.name,
      branch: branchName,
    });
    return createdPath;
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to create worktree: ${e.message}`);
    return null;
  }
}

export async function findWorktreeRepo(
  worktreePath: string,
): Promise<Repository | null> {
  const api = getGitApi();
  if (!api) return null;

  return api.repositories.find(
    (r) => r.rootUri.fsPath === worktreePath && r.kind === 'worktree',
  ) || null;
}

export async function commitAndPush(
  repo: Repository,
  commitMsg: string,
  branchName: string,
): Promise<boolean> {
  try {
    await repo.commit(commitMsg);
    await repo.push('origin', branchName, true);
    return true;
  } catch (e: any) {
    vscode.window.showErrorMessage(`Git operation failed: ${e.message}`);
    return false;
  }
}

export async function deleteWorktree(
  repo: Repository,
  path: string,
): Promise<boolean> {
  try {
    await repo.deleteWorktree(path, { force: true });
    return true;
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to delete worktree: ${e.message}`);
    return false;
  }
}

export async function openPrUrl(url: string): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    'PR created successfully!',
    'Open in Browser',
  );
  if (action === 'Open in Browser') {
    vscode.env.openExternal(vscode.Uri.parse(url));
  }
}
