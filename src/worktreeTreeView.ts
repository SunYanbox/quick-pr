import * as vscode from 'vscode';
import { getAllWorktrees, WorktreeInfo } from './worktreeManager';

type TreeNode = ActionNode | WorktreeNode | WorktreeActionNode;

interface ActionNode {
  type: 'action';
  label: string;
  command?: string;
  icon?: string;
  tooltip?: string;
}

interface WorktreeNode {
  type: 'worktree';
  info: WorktreeInfo;
}

interface WorktreeActionNode {
  type: 'worktreeAction';
  worktreeId: string;
  label: string;
  command: string;
  icon?: string;
  tooltip?: string;
}

export class WorktreeTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === 'action') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      if (element.command) {
        item.command = {
          command: element.command,
          title: element.label,
        };
      }
      if (element.icon) {
        item.iconPath = new vscode.ThemeIcon(element.icon);
      }
      if (element.tooltip) {
        item.tooltip = element.tooltip;
      }
      return item;
    }

    if (element.type === 'worktreeAction') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.command = {
        command: element.command,
        title: element.label,
        arguments: [element.worktreeId],
      };
      if (element.icon) {
        item.iconPath = new vscode.ThemeIcon(element.icon);
      }
      if (element.tooltip) {
        item.tooltip = element.tooltip;
      }
      return item;
    }

    const { info } = element;
    const statusIcon = this.getStatusIcon(info.status);
    const badge = info.commitCount > 0 ? `(${info.commitCount} commits)` : '(empty)';
    const label = `${info.branchName} ${badge}`;

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon(statusIcon, new vscode.ThemeColor(this.getStatusColor(info.status)));
    item.tooltip = [
      `Branch: ${info.branchName}`,
      `Status: ${info.status}`,
      `Path: ${info.worktreePath}`,
      `Commits: ${info.commitCount}`,
      info.lastCommitMsg ? `Last: ${info.lastCommitMsg}` : '',
      `Created: ${info.createdAt}`,
      info.errorMessage ? `Error: ${info.errorMessage}` : '',
    ].filter(Boolean).join('\n');

    item.contextValue = info.status;

    return item;
  }

  getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
    if (!element) {
      const nodes: TreeNode[] = [];

      nodes.push({
        type: 'action',
        label: 'Create Pull Request',
        command: 'quick-pr-studio.createPr',
        icon: 'git-pull-request-create',
        tooltip: 'Create a PR in one shot (all changes in a single commit)',
      });

      nodes.push({
        type: 'action',
        label: 'Start Step-by-Step PR',
        command: 'quick-pr-studio.startStepByStep',
        icon: 'repo-create',
        tooltip: 'Create a new worktree and branch, add commits over time',
      });

      for (const info of getAllWorktrees(this.workspaceRoot)) {
        nodes.push({ type: 'worktree', info });
      }

      return nodes;
    }

    if (element.type === 'worktree') {
      const actions: WorktreeActionNode[] = [];
      const { info } = element;

      actions.push({
        type: 'worktreeAction',
        worktreeId: info.id,
        label: `Open ${info.branchName}`,
        command: 'quick-pr-studio.openWorktree',
        icon: 'link-external',
        tooltip: 'Open worktree detail and management page',
      });

      if (info.status === 'created' || info.status === 'committed') {
        actions.push({
          type: 'worktreeAction',
          worktreeId: info.id,
          label: `Add Commit to ${info.branchName}`,
          command: 'quick-pr-studio.addCommit',
          icon: 'git-commit',
          tooltip: 'Select files and commit to this worktree',
        });
      }

      if (info.status === 'committed') {
        actions.push({
          type: 'worktreeAction',
          worktreeId: info.id,
          label: `Finalize ${info.branchName}`,
          command: 'quick-pr-studio.finalizePr',
          icon: 'cloud-upload',
          tooltip: 'Push commits and create the PR',
        });
      }

      if (info.status === 'error') {
        actions.push({
          type: 'worktreeAction',
          worktreeId: info.id,
          label: `Retry ${info.branchName}`,
          command: 'quick-pr-studio.retryWorktree',
          icon: 'debug-rerun',
          tooltip: info.errorMessage || 'Retry the failed step',
        });
      }

      actions.push({
        type: 'worktreeAction',
        worktreeId: info.id,
        label: `Delete ${info.branchName}`,
        command: 'quick-pr-studio.cleanupWorktree',
        icon: 'trash',
        tooltip: 'Delete this worktree and its branch',
      });

      return actions;
    }

    return [];
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'created': return 'circle-outline';
      case 'committed': return 'git-commit';
      case 'pushing': return 'cloud-upload';
      case 'pr_creating': return 'loading';
      case 'pr_created': return 'check';
      case 'error': return 'error';
      default: return 'circle-outline';
    }
  }

  private getStatusColor(status: string): string {
    switch (status) {
      case 'created': return 'charts.blue';
      case 'committed': return 'charts.green';
      case 'pushing': return 'charts.orange';
      case 'pr_creating': return 'charts.orange';
      case 'pr_created': return 'charts.purple';
      case 'error': return 'charts.red';
      default: return 'foreground';
    }
  }
}
