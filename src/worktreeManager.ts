import * as fs from 'fs';
import * as path from 'path';
import { info, warn, error as logError } from './logger';

export type WorktreeStatus = 'created' | 'committed' | 'pushing' | 'pr_creating' | 'pr_created' | 'error';

export interface WorktreeInfo {
  id: string;
  branchName: string;
  worktreePath: string;
  baseCommitish: string;
  prBase: string;
  status: WorktreeStatus;
  commitCount: number;
  lastCommitMsg: string;
  createdAt: string;
  lastActivityAt: string;
  errorMessage?: string;
}

interface WorktreesData {
  activeId: string | null;
  worktrees: Record<string, WorktreeInfo>;
}

function getWorktreesPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.quick-pr-studio', 'worktrees.json');
}

function emptyData(): WorktreesData {
  return { activeId: null, worktrees: {} };
}

export function loadWorktrees(workspaceRoot: string): WorktreesData {
  const filePath = getWorktreesPath(workspaceRoot);
  try {
    if (!fs.existsSync(filePath)) {
      return emptyData();
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      activeId: parsed.activeId || null,
      worktrees: parsed.worktrees || {},
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    warn('[worktreeManager.loadWorktrees]', 'Failed to load worktrees.json, using empty', { filePath }, e);
    return emptyData();
  }
}

function saveWorktrees(workspaceRoot: string, data: WorktreesData): void {
  const filePath = getWorktreesPath(workspaceRoot);
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    info('[worktreeManager.saveWorktrees]', 'Worktrees data saved', { count: Object.keys(data.worktrees).length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('[worktreeManager.saveWorktrees]', 'Failed to save worktrees.json', { filePath }, e);
  }
}

export function getWorktree(workspaceRoot: string, id: string): WorktreeInfo | null {
  const data = loadWorktrees(workspaceRoot);
  return data.worktrees[id] || null;
}

export function getActiveWorktree(workspaceRoot: string): WorktreeInfo | null {
  const data = loadWorktrees(workspaceRoot);
  if (!data.activeId) return null;
  return data.worktrees[data.activeId] || null;
}

export function addWorktree(workspaceRoot: string, wtInfo: WorktreeInfo): void {
  const data = loadWorktrees(workspaceRoot);
  data.worktrees[wtInfo.id] = wtInfo;
  data.activeId = wtInfo.id;
  saveWorktrees(workspaceRoot, data);
  info('[worktreeManager.addWorktree]', 'Worktree added', { id: wtInfo.id, branchName: wtInfo.branchName });
}

export function updateWorktree(workspaceRoot: string, id: string, updates: Partial<WorktreeInfo>): void {
  const data = loadWorktrees(workspaceRoot);
  if (!data.worktrees[id]) {
    warn('[worktreeManager.updateWorktree]', 'Worktree not found for update', { id });
    return;
  }
  Object.assign(data.worktrees[id], updates);
  saveWorktrees(workspaceRoot, data);
  info('[worktreeManager.updateWorktree]', 'Worktree updated', { id, updates: Object.keys(updates) });
}

export function removeWorktree(workspaceRoot: string, id: string): void {
  const data = loadWorktrees(workspaceRoot);
  delete data.worktrees[id];
  if (data.activeId === id) {
    data.activeId = null;
  }
  saveWorktrees(workspaceRoot, data);
  info('[worktreeManager.removeWorktree]', 'Worktree removed', { id });
}

export function setActive(workspaceRoot: string, id: string): void {
  const data = loadWorktrees(workspaceRoot);
  if (!data.worktrees[id]) {
    warn('[worktreeManager.setActive]', 'Worktree not found for setActive', { id });
    return;
  }
  data.activeId = id;
  saveWorktrees(workspaceRoot, data);
  info('[worktreeManager.setActive]', 'Active worktree set', { id });
}

export function getAllWorktrees(workspaceRoot: string): WorktreeInfo[] {
  const data = loadWorktrees(workspaceRoot);
  return Object.values(data.worktrees);
}
