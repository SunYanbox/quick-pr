import * as vscode from 'vscode';
import * as fs from 'fs';

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

export async function stageAllChanges(repo: Repository): Promise<boolean> {
  try {
    const paths = repo.state.workingTreeChanges.map((c) => c.uri.fsPath);
    if (paths.length > 0) {
      await repo.add(paths);
    }
    return true;
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to stage changes: ${e.message}`);
    return false;
  }
}

export async function createWorktree(
  repo: Repository,
  branchName: string,
  rootUri: vscode.Uri,
): Promise<string | null> {
  const worktreeDir = vscode.Uri.joinPath(rootUri, '.quick-pr', 'worktrees');
  const worktreePath = vscode.Uri.joinPath(worktreeDir, branchName);

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
