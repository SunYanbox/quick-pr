import * as vscode from 'vscode';
import { getActiveWorktree, getAllWorktrees, WorktreeInfo } from './worktreeManager';

type TreeNode = ActionNode | WorktreeNode;

interface ActionNode {
  type: 'action';
  label: string;
  command: string;
  icon?: string;
  tooltip?: string;
}

interface WorktreeNode {
  type: 'worktree';
  info: WorktreeInfo;
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
      item.command = {
        command: element.command,
        title: element.label,
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

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
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

    item.command = {
      command: 'quick-pr-studio.openWorktree',
      title: 'Open Worktree',
      arguments: [info.id],
    };

    item.contextValue = info.status;

    return item;
  }

  getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
    if (element) return [];

    const nodes: TreeNode[] = [];
    const active = getActiveWorktree(this.workspaceRoot);
    const all = getAllWorktrees(this.workspaceRoot);

    nodes.push({
      type: 'action',
      label: 'Create Pull Request',
      command: 'quick-pr-studio.createPr',
      icon: 'git-pull-request-create',
      tooltip: 'Create a PR in one shot (all changes in a single commit)',
    });

    if (active) {
      nodes.push({ type: 'action', label: '', command: '', icon: undefined });

      if (active.status === 'created' || active.status === 'committed') {
        nodes.push({
          type: 'action',
          label: `Add Commit to ${active.branchName}`,
          command: 'quick-pr-studio.addCommit',
          icon: 'git-commit',
          tooltip: 'Select files and commit to this worktree',
        });

        if (active.status === 'committed') {
          nodes.push({
            type: 'action',
            label: `Finalize ${active.branchName}`,
            command: 'quick-pr-studio.finalizePr',
            icon: 'cloud-upload',
            tooltip: 'Push commits and create the PR',
          });
        }
      }

      if (active.status === 'error') {
        nodes.push({
          type: 'action',
          label: `Retry ${active.branchName}`,
          command: 'quick-pr-studio.retryWorktree',
          icon: 'debug-rerun',
          tooltip: active.errorMessage || 'Retry the failed step',
        });
        nodes.push({
          type: 'action',
          label: `Cleanup ${active.branchName}`,
          command: 'quick-pr-studio.cleanupWorktree',
          icon: 'trash',
          tooltip: 'Delete this worktree and its branch',
        });
      }

      nodes.push({ type: 'action', label: '', command: '', icon: undefined });
    } else {
      nodes.push({ type: 'action', label: '', command: '', icon: undefined });
      nodes.push({
        type: 'action',
        label: 'Start Step-by-Step PR',
        command: 'quick-pr-studio.startStepByStep',
        icon: 'repo-create',
        tooltip: 'Create a new worktree and branch, add commits over time',
      });
      nodes.push({ type: 'action', label: '', command: '', icon: undefined });
    }

    for (const info of all) {
      nodes.push({ type: 'worktree', info });
    }

    return nodes;
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
