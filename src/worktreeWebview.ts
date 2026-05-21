import * as vscode from 'vscode';
import * as path from 'path';
import { WorktreeInfo, getWorktree, updateWorktree, removeWorktree } from './worktreeManager';
import { getCurrentRepo, getChangedFiles, filterFilesCommittedToWorktree, copyFilesToWorktree, commitOnly, getFilesDiff, getRecentCommits } from './gitService';
import { generateCommitMessage } from './aiService';
import { loadProjectConfig } from './projectConfig';
import { error as logError } from './logger';

function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  if (/^[a-z]:/.test(resolved)) {
    return resolved.charAt(0).toUpperCase() + resolved.slice(1);
  }
  return resolved;
}

function getWorktreeWebviewHtml(
  info: WorktreeInfo,
  changedFiles: { path: string; status: string }[],
  workspaceRoot: string,
): string {
  const normalizedRoot = normalizePath(workspaceRoot);
  const showRetry = info.status === 'error';
  const canFinalize = info.status === 'committed' || info.status === 'error';

  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-input-foreground);
      background-color: var(--vscode-sideBar-background);
      padding: 20px;
      margin: 0;
    }
    .section { margin-bottom: 24px; }
    .section-title {
      font-weight: 600;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--vscode-input-border, #333);
    }
    .info-grid {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 6px 12px;
      font-size: 13px;
    }
    .info-label { color: var(--vscode-descriptionForeground); }
    .info-value { color: var(--vscode-editor-foreground); }
    .status-badge {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .status-created { background: #1a5fb4; color: #fff; }
    .status-committed { background: #1b7837; color: #fff; }
    .status-error { background: #cb2431; color: #fff; }
    .status-pushing, .status-pr_creating { background: #c68200; color: #fff; }
    .status-pr_created { background: #6f42c1; color: #fff; }
    .form-group { margin-bottom: 12px; }
    label {
      display: block;
      margin-bottom: 4px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    input, textarea {
      width: 100%;
      padding: 6px 10px;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      box-sizing: border-box;
      border-radius: 2px;
    }
    input:focus, textarea:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .file-list {
      max-height: 180px;
      overflow-y: auto;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background);
      border-radius: 2px;
      padding: 4px 0;
    }
    .file-item {
      display: flex;
      align-items: center;
      padding: 4px 10px;
      cursor: pointer;
      gap: 8px;
    }
    .file-item:hover { background: var(--vscode-list-hoverBackground); }
    .file-item input[type="checkbox"] { flex-shrink: 0; width: 16px; height: 16px; }
    .file-path {
      flex: 1;
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file-status {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .file-status.staged { background: #1b7837; color: #fff; }
    .file-status.modified { background: #005cc5; color: #fff; }
    .button-row { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
    button {
      border: none;
      padding: 6px 16px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      border-radius: 2px;
    }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.danger { background: #cb2431; color: #fff; }
    button.danger:hover { background: #e04e3e; }
    button.ai { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button.ai:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .empty-hint {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 8px 0;
    }
    .error-msg {
      background: #cb243122;
      border: 1px solid #cb2431;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      color: #cb2431;
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="section">
    <div class="section-title">Worktree Info</div>
    <div class="info-grid">
      <span class="info-label">Branch</span><span class="info-value">${info.branchName}</span>
      <span class="info-label">Status</span><span class="info-value"><span class="status-badge status-${info.status}">${info.status}</span></span>
      <span class="info-label">Path</span><span class="info-value">${info.worktreePath}</span>
      <span class="info-label">Commits</span><span class="info-value">${info.commitCount}</span>
      <span class="info-label">Created</span><span class="info-value">${info.createdAt}</span>
      <span class="info-label">Last Commit</span><span class="info-value">${info.lastCommitMsg || '(none)'}</span>
    </div>
    ${info.commitCount === 0 ? '<div class="empty-hint">No commits yet — add your first commit below</div>' : ''}
    ${info.errorMessage ? `<div class="error-msg">Error: ${info.errorMessage}</div>` : ''}
  </div>

  <div class="section">
    <div class="section-title">New Commit</div>
    <div class="form-group" ${changedFiles.length === 0 ? 'style="display:none"' : ''}>
      <label>Changed Files</label>
      <div class="file-list">
        ${changedFiles.map((f) => `
        <label class="file-item">
          <input type="checkbox" class="file-checkbox" checked />
          <span class="file-path">${path.relative(normalizedRoot, normalizePath(f.path)).replace(/\\/g, '/')}</span>
          <span class="file-status ${f.status}">${f.status}</span>
        </label>
        `).join('')}
      </div>
    </div>
    ${changedFiles.length === 0 ? '<div class="empty-hint">No changed files in main repository</div>' : ''}
    <div class="form-group">
      <label for="commitMsg">Commit Message</label>
      <input type="text" id="commitMsg" placeholder="feat: describe your changes" />
    </div>
    <div class="button-row">
      <button class="ai" id="aiBtn">AI Generate</button>
      <button class="primary" id="commitBtn">Commit to Worktree</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Actions</div>
    <div class="button-row">
      ${canFinalize ? '<button class="primary" id="finalizeBtn">Finalize PR</button>' : ''}
      ${showRetry ? '<button class="primary" id="retryBtn">Retry</button>' : ''}
      <button class="danger" id="deleteBtn">Delete Worktree</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const changedFilesData = ${JSON.stringify(changedFiles.map(f => ({ path: f.path, status: f.status })))};

    document.getElementById('commitBtn').addEventListener('click', () => {
      const commitMsg = document.getElementById('commitMsg').value.trim();
      const selectedFiles = getSelectedFiles();
      if (!commitMsg || selectedFiles.length === 0) return;
      vscode.postMessage({ type: 'commit', commitMsg, selectedFiles });
    });

    document.getElementById('aiBtn').addEventListener('click', () => {
      document.getElementById('aiBtn').disabled = true;
      document.getElementById('aiBtn').textContent = 'Generating...';
      vscode.postMessage({
        type: 'generateAi',
        commitMsg: document.getElementById('commitMsg').value,
        selectedFiles: getSelectedFiles(),
      });
    });

    const finalizeBtn = document.getElementById('finalizeBtn');
    if (finalizeBtn) {
      finalizeBtn.addEventListener('click', () => vscode.postMessage({ type: 'finalize' }));
    }

    const retryBtn = document.getElementById('retryBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => vscode.postMessage({ type: 'retry' }));
    }

    document.getElementById('deleteBtn').addEventListener('click', () => vscode.postMessage({ type: 'delete' }));

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'aiResult') {
        const commitInput = document.getElementById('commitMsg');
        if (msg.commitMsg && commitInput && !commitInput.value) commitInput.value = msg.commitMsg;
      }
      if (msg.type === 'aiComplete') {
        const btn = document.getElementById('aiBtn');
        btn.disabled = false;
        btn.textContent = 'AI Generate';
      }
    });

    function getSelectedFiles() {
      const checkboxes = document.querySelectorAll('.file-checkbox');
      const files = [];
      checkboxes.forEach((cb, index) => {
        if (cb.checked && changedFilesData[index]) {
          files.push(changedFilesData[index].path);
        }
      });
      return files;
    }
  </script>
</body>
</html>`;
}

export async function openWorktreeWebview(
  workspaceRoot: string,
  worktreeId: string,
  extensionContext: vscode.ExtensionContext,
  onCommit: (info: WorktreeInfo, commitMsg: string, selectedFiles: string[]) => Promise<boolean>,
  onFinalize: (info: WorktreeInfo) => Promise<void>,
  onRetry: (info: WorktreeInfo) => Promise<void>,
  onDelete: (info: WorktreeInfo) => Promise<void>,
): Promise<void> {
  const info = getWorktree(workspaceRoot, worktreeId);
  if (!info) {
    vscode.window.showErrorMessage('Worktree not found');
    return;
  }

  const gitStatus = getCurrentRepo();
  const allChangedFiles = gitStatus ? getChangedFiles(gitStatus.repo) : [];
  const changedFiles = gitStatus
    ? await filterFilesCommittedToWorktree(allChangedFiles, gitStatus.repo.rootUri.fsPath, info.branchName)
    : [];

  const panel = vscode.window.createWebviewPanel(
    'quickPrWorktreeDetail',
    `Worktree: ${info.branchName}`,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
    { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true },
  );

  panel.webview.html = getWorktreeWebviewHtml(info, changedFiles, workspaceRoot);

  let disposed = false;

  panel.onDidDispose(() => { disposed = true; });

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (disposed) return;
    try {
      if (msg.type === 'generateAi') {
        const workspaceRoot2 = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || workspaceRoot;
        const filesDiff = await getFilesDiff(workspaceRoot2, msg.selectedFiles || []);
        const projectConfig = loadProjectConfig(workspaceRoot2);
        const commitMsg = await generateCommitMessage(
          msg.commitMsg || '',
          filesDiff,
          projectConfig.commitMessageRule,
          await getRecentCommits(workspaceRoot2),
        );
        if (commitMsg) {
          panel.webview.postMessage({ type: 'aiResult', commitMsg });
        }
        panel.webview.postMessage({ type: 'aiComplete' });
      } else if (msg.type === 'commit') {
        const success = await onCommit(info, msg.commitMsg, msg.selectedFiles);
        if (success) {
          const updated = getWorktree(workspaceRoot, worktreeId);
          if (updated) {
            const newAllChangedFiles = gitStatus ? getChangedFiles(gitStatus.repo) : [];
            const newChangedFiles = gitStatus
              ? await filterFilesCommittedToWorktree(newAllChangedFiles, gitStatus.repo.rootUri.fsPath, updated.branchName)
              : [];
            panel.webview.html = getWorktreeWebviewHtml(updated, newChangedFiles, workspaceRoot);
          }
          vscode.window.showInformationMessage(`Commit added to ${info.branchName}`);
        }
      } else if (msg.type === 'finalize') {
        panel.dispose();
        await onFinalize(info);
      } else if (msg.type === 'retry') {
        panel.dispose();
        await onRetry(info);
      } else if (msg.type === 'delete') {
        const confirm = await vscode.window.showWarningMessage(
          `Delete worktree "${info.branchName}"? This will remove the worktree directory and its branch.`,
          { modal: true },
          'Delete',
        );
        if (confirm === 'Delete') {
          panel.dispose();
          await onDelete(info);
        }
      }
    } catch (e: unknown) {
      const msgStr = e instanceof Error ? e.message : String(e);
      logError('[worktreeWebview]', 'Error handling message', {}, e);
      vscode.window.showErrorMessage(`An error occurred: ${msgStr}`);
    }
  });
}
