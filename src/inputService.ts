import * as vscode from 'vscode';
import * as path from 'path';
import { generatePrContent, generateBranchName, generateCommitMessage, generatePrDescription } from './aiService';
import { loadProjectConfig } from './projectConfig';
import { getRecentCommits, getFilesDiff, getBranchDiff, getFileDiff } from './gitService';
import { info, warn, error as logError } from './logger';

export interface CollectedInputs {
  commitMsg: string;
  branchName: string;
  prTitle: string;
  prBody: string;
  prBase: string;
  selectedFiles: string[];
}

function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  // On Windows, uppercase drive letter so path.relative works correctly
  if (/^[a-z]:/.test(resolved)) {
    return resolved.charAt(0).toUpperCase() + resolved.slice(1);
  }
  return resolved;
}

function getWebviewHtml(
  projectConfig: { settings: { defaultBaseBranch: string } },
  changedFiles: { path: string; status: string }[],
  workspaceRoot: string,
  currentBranch: string,
): string {
  const defaultBase = currentBranch || projectConfig.settings.defaultBaseBranch;
  const normalizedRoot = normalizePath(workspaceRoot);
  return /* html */ `
<!DOCTYPE html>
<html lang="zh-CN">
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
    .form-group {
      margin-bottom: 16px;
    }
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
    textarea {
      resize: vertical;
      min-height: 80px;
    }
    .error {
      color: var(--vscode-errorForeground);
      font-size: 12px;
      margin-top: 4px;
      display: none;
    }
    .button-row {
      display: flex;
      gap: 8px;
      margin-top: 24px;
      justify-content: flex-end;
    }
    button {
      border: none;
      padding: 8px 20px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      border-radius: 2px;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    button.ai {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      margin-right: auto;
    }
    button.ai:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.settings {
      background: transparent;
      color: var(--vscode-descriptionForeground);
      padding: 8px 12px;
      font-size: 12px;
      margin-right: auto;
    }
    button.settings:hover {
      color: var(--vscode-editor-foreground);
    }
    h2 {
      margin-top: 0;
      margin-bottom: 20px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .hint {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    .file-list {
      max-height: 200px;
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
    .file-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .file-item input[type="checkbox"] {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
    }
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
    .file-status.added { background: #28a745; color: #fff; }
    .file-status.deleted { background: #cb2431; color: #fff; }
    /* Diff view styles */
    .file-entry { border-bottom: 1px solid var(--vscode-input-border, #333); }
    .file-header {
      display: flex;
      align-items: center;
      padding: 4px 10px;
      cursor: pointer;
      gap: 8px;
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--vscode-sideBar-background);
    }
    .file-header:hover { background: var(--vscode-list-hoverBackground); }
    .file-header input[type="checkbox"] { flex-shrink: 0; width: 16px; height: 16px; cursor: pointer; }
    .file-header .file-path {
      flex: 1;
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file-header .expand-icon {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
      width: 16px;
      text-align: center;
      transition: transform 0.15s;
    }
    .file-header .expand-icon.expanded { transform: rotate(90deg); }
    .file-diff {
      display: none;
      overflow-x: auto;
      border-top: 1px solid var(--vscode-input-border, #333);
    }
    .file-diff.open { display: block; }
    .diff-table {
      width: 100%;
      border-collapse: collapse;
      font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
      font-size: 12px;
      line-height: 1.5;
      table-layout: fixed;
    }
    .diff-table td {
      padding: 0 4px;
      vertical-align: top;
      white-space: pre;
    }
    .diff-gutter {
      width: 40px;
      text-align: right;
      color: var(--vscode-editorLineNumber-foreground, #858585);
      user-select: none;
      background: var(--vscode-sideBar-background);
    }
    .diff-content { width: 50%; }
    .diff-line-add { background: rgba(40, 167, 69, 0.15); }
    .diff-line-del { background: rgba(203, 36, 49, 0.15); }
    .diff-line-mod-left { background: rgba(203, 36, 49, 0.15); }
    .diff-line-mod-right { background: rgba(40, 167, 69, 0.15); }
    .diff-empty-hint {
      padding: 16px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .diff-loading {
      padding: 16px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <h2>Create Pull Request</h2>

  <div class="form-group" id="changedFilesGroup" style="${changedFiles.length === 0 ? 'display:none' : ''}">
    <label>Changed Files (double-click to view diff)</label>
    <div class="file-list" id="fileList">
      ${changedFiles.map((f, i) => `
      <div class="file-entry" data-file-index="${i}">
        <div class="file-header" data-file-path="${normalizePath(f.path)}">
          <input type="checkbox" class="file-checkbox" checked />
          <span class="file-path">${path.relative(normalizedRoot, normalizePath(f.path)).replace(/\\/g, '/')}</span>
          <span class="file-status ${f.status}">${f.status}</span>
          <span class="expand-icon">&#9654;</span>
        </div>
        <div class="file-diff" id="diff-${i}"></div>
      </div>
      `).join('')}
    </div>
    <div class="error" id="fileError">Please select at least one file</div>
    <div class="hint">Uncheck files you don't want to include. Double-click to view diff.</div>
  </div>

  <div class="form-group">
    <label for="commitMsg">Commit message *</label>
    <input type="text" id="commitMsg" placeholder="feat: add user authentication" />
    <div class="error" id="commitMsgError">Commit message is required</div>
  </div>

  <div class="form-group">
    <label for="branchName">New branch name *</label>
    <input type="text" id="branchName" placeholder="feat/user-auth" />
    <div class="error" id="branchNameError">Branch name cannot contain spaces</div>
  </div>

  <div class="form-group">
    <label for="prTitle">PR Title *</label>
    <input type="text" id="prTitle" placeholder="Add user authentication feature" />
    <div class="error" id="prTitleError">PR title is required</div>
  </div>

  <div class="form-group">
    <label for="prBody">PR Body</label>
    <textarea id="prBody" placeholder="Describe the changes..."></textarea>
  </div>

  <div class="form-group">
    <label for="prBase">PR target branch *</label>
    <input type="text" id="prBase" placeholder="main" value="${defaultBase}" />
    <div class="error" id="prBaseError">Target branch is required</div>
  </div>

  <div class="button-row">
    <button class="settings" id="settingsBtn" title="Open Quick PR Studio settings">⚙ Settings</button>
    <button class="ai" id="aiBtn">✨ Generate with AI</button>
    <button class="secondary" id="cancelBtn">Cancel</button>
    <button class="primary" id="submitBtn">Create PR</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('submitBtn').addEventListener('click', () => {
      document.getElementById('submitBtn').disabled = true;
      document.getElementById('submitBtn').textContent = '⏳ Creating PR...';
      validateAndSubmit();
    });
    document.getElementById('cancelBtn').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

    document.getElementById('settingsBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    const aiBtn = document.getElementById('aiBtn');
    if (aiBtn) {
      aiBtn.addEventListener('click', () => {
        aiBtn.disabled = true;
        aiBtn.textContent = '⏳ Generating...';
        vscode.postMessage({
          type: 'generateAi',
          commitMsg: document.getElementById('commitMsg').value,
          branchName: document.getElementById('branchName').value,
          prTitle: document.getElementById('prTitle').value,
          prBody: document.getElementById('prBody').value,
          selectedFiles: getSelectedFiles(),
        });
      });
    }

    // Enter key handling: focus moves to next field, but textarea doesn't submit on enter
    document.querySelectorAll('input').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const fields = ['commitMsg', 'branchName', 'prTitle', 'prBody', 'prBase'];
          const idx = fields.indexOf(input.id);
          if (idx >= 0 && idx < fields.length - 1) {
            const next = document.getElementById(fields[idx + 1]);
            if (next) next.focus();
          } else {
            validateAndSubmit();
          }
        }
      });
    });

    // Listen for AI-generated content — only fill EMPTY fields to preserve user input
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'aiResult') {
        const commitInput = document.getElementById('commitMsg');
        if (msg.commitMsg && commitInput && !commitInput.value) commitInput.value = msg.commitMsg;
        const branchInput = document.getElementById('branchName');
        if (msg.branchName && branchInput && !branchInput.value) branchInput.value = msg.branchName;
        const titleInput = document.getElementById('prTitle');
        if (msg.title && titleInput && !titleInput.value) titleInput.value = msg.title;
        const bodyInput = document.getElementById('prBody');
        if (msg.body && bodyInput && !bodyInput.value) bodyInput.value = msg.body;
      }
      if (msg.type === 'aiComplete') {
        const aiBtn = document.getElementById('aiBtn');
        if (aiBtn) {
          aiBtn.disabled = false;
          aiBtn.textContent = '✨ Generate with AI';
        }
      }
    });

    function getSelectedFiles() {
      const checkboxes = document.querySelectorAll('.file-checkbox');
      const files = [];
      checkboxes.forEach((cb, index) => {
        if (cb.checked) {
          files.push(${JSON.stringify(changedFiles.map(f => f.path))}[index]);
        }
      });
      return files;
    }

    function validateAndSubmit() {
      let valid = true;

      const commitMsg = document.getElementById('commitMsg').value.trim();
      const branchName = document.getElementById('branchName').value.trim();
      const prTitle = document.getElementById('prTitle').value.trim();
      const prBase = document.getElementById('prBase').value.trim();
      const prBody = document.getElementById('prBody').value;
      const selectedFiles = getSelectedFiles();

      // Reset errors
      document.querySelectorAll('.error').forEach(e => e.style.display = 'none');

      if (!commitMsg) {
        document.getElementById('commitMsgError').style.display = 'block';
        valid = false;
      }
      if (!branchName) {
        document.getElementById('branchNameError').style.display = 'block';
        valid = false;
      } else if (/\\s/.test(branchName)) {
        document.getElementById('branchNameError').style.display = 'block';
        valid = false;
      }
      if (!prTitle) {
        document.getElementById('prTitleError').style.display = 'block';
        valid = false;
      }
      if (!prBase) {
        document.getElementById('prBaseError').style.display = 'block';
        valid = false;
      }
      if (selectedFiles.length === 0) {
        document.getElementById('fileError').style.display = 'block';
        document.querySelector('.file-list')?.scrollIntoView({ behavior: 'smooth' });
        valid = false;
      }

      if (valid) {
        vscode.postMessage({
          type: 'submit',
          commitMsg,
          branchName,
          prTitle,
          prBody,
          prBase,
          selectedFiles,
        });
      }
    }

    // Double-click to expand diff
    document.querySelectorAll('.file-header').forEach(header => {
      header.addEventListener('dblclick', function() {
        const entry = this.closest('.file-entry');
        const diffDiv = entry.querySelector('.file-diff');
        const icon = this.querySelector('.expand-icon');
        const isOpen = diffDiv.classList.contains('open');

        if (isOpen) {
          diffDiv.classList.remove('open');
          diffDiv.innerHTML = '';
          icon.classList.remove('expanded');
        } else {
          icon.classList.add('expanded');
          diffDiv.classList.add('open');
          diffDiv.innerHTML = '<div class="diff-loading">Loading diff...</div>';
          const filePath = this.dataset.filePath;
          vscode.postMessage({ type: 'getDiff', filePath: filePath });
        }
      });
    });

    // Listen for diff results
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'diffResult') {
        const allEntries = document.querySelectorAll('.file-entry');
        for (const entry of allEntries) {
          const header = entry.querySelector('.file-header');
          if (header.dataset.filePath === msg.filePath) {
            const diffDiv = entry.querySelector('.file-diff');
            diffDiv.innerHTML = renderDiff(msg.diff);
            break;
          }
        }
      }
    });

    function escapeHtml(text) {
      if (text === null || text === undefined) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/ /g, '&nbsp;');
    }

    function renderDiff(diff) {
      if (!diff || diff.length === 0) {
        return '<div class="diff-empty-hint">No changes to display</div>';
      }

      let html = '<table class="diff-table">';
      for (const pair of diff) {
        const leftContent = escapeHtml(pair.leftContent);
        const rightContent = escapeHtml(pair.rightContent);
        const leftNum = pair.leftLineNum !== null ? pair.leftLineNum : '';
        const rightNum = pair.rightLineNum !== null ? pair.rightLineNum : '';

        let leftClass = 'diff-content';
        let rightClass = 'diff-content';
        if (pair.type === 'deletion') { leftClass += ' diff-line-del'; rightClass += ' diff-line-del'; }
        else if (pair.type === 'addition') { leftClass += ' diff-line-add'; rightClass += ' diff-line-add'; }
        else if (pair.type === 'modification') { leftClass += ' diff-line-mod-left'; rightClass += ' diff-line-mod-right'; }

        html += `<tr>
          <td class="diff-gutter">${leftNum}</td>
          <td class="${leftClass}">${leftContent || ''}</td>
          <td class="diff-gutter">${rightNum}</td>
          <td class="${rightClass}">${rightContent || ''}</td>
        </tr>`;
      }
      html += '</table>';
      return html;
    }
  </script>
</body>
</html>`;
}

export async function collectInputs(
  workspaceRoot: string,
  changedFiles: { path: string; status: string }[],
  currentBranch: string,
): Promise<CollectedInputs | null> {
  const projectConfig = loadProjectConfig(workspaceRoot);

  return new Promise<CollectedInputs | null>((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'quickPrInput',
      'Quick PR Studio',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [],
        retainContextWhenHidden: true,
      },
    );

    panel.webview.html = getWebviewHtml(projectConfig, changedFiles, workspaceRoot, currentBranch);

    let resolved = false;
    let panelDisposed = false;

    const disposable = panel.webview.onDidReceiveMessage(async (msg) => {
      if (resolved || panelDisposed) return;
      try {
        if (msg.type === 'openSettings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'quick-pr-studio');
        } else if (msg.type === 'generateAi') {
          info('[inputService]', 'AI generation requested', {
            commitMsgPreview: (msg.commitMsg || '').slice(0, 80),
            branchName: msg.branchName,
            selectedFilesCount: msg.selectedFiles?.length ?? 0,
          });

          const isAiEnabled = vscode.workspace
            .getConfiguration('quick-pr-studio')
            .get<boolean>('ai.enabled', false);

          if (!isAiEnabled) {
            panel.webview.postMessage({ type: 'aiComplete' });
            const action = await vscode.window.showWarningMessage(
              'AI generation is not enabled. Enable it in Quick PR Studio settings to use this feature.',
              'Open Settings',
              'Cancel',
            );
            if (action === 'Open Settings') {
              vscode.commands.executeCommand('workbench.action.openSettings', 'quick-pr-studio.ai');
            }
            return;
          }

          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Quick PR',
              cancellable: false,
            },
            async (progress) => {
              progress.report({ message: 'AI is generating PR content...' });

              // Get diff only for selected files — cached at click time
              const filesDiff = await getFilesDiff(workspaceRoot, msg.selectedFiles || []);

              const aiResult = await generatePrContent(
                msg.commitMsg || '',
                msg.branchName || '',
                msg.prTitle || '',
                msg.prBody || '',
                filesDiff,
                projectConfig.prTitleRule,
                projectConfig.prBodyRule,
                projectConfig.commitMessageRule,
                projectConfig.branchNameRule,
                await getRecentCommits(workspaceRoot),
              );
              if (aiResult) {
                panel.webview.postMessage({
                  type: 'aiResult',
                  commitMsg: aiResult.commitMsg,
                  branchName: aiResult.branchName,
                  title: aiResult.title,
                  body: aiResult.body,
                });
                panel.webview.postMessage({ type: 'aiComplete' });
                info('[inputService]', 'AI result sent to webview');
              } else {
                panel.webview.postMessage({ type: 'aiComplete' });
                warn('[inputService]', 'AI generation returned no result');
              }
            },
          );
        } else if (msg.type === 'getDiff') {
          const filePath = msg.filePath as string;
          const diff = await getFileDiff(workspaceRoot, filePath);
          panel.webview.postMessage({ type: 'diffResult', filePath, diff });
        } else if (msg.type === 'submit') {
          info('[inputService]', 'User submitted PR form', {
            branchName: msg.branchName,
            prBase: msg.prBase,
            selectedFilesCount: msg.selectedFiles?.length ?? 0,
          });
          resolved = true;
          panel.dispose();
          resolve({
            commitMsg: msg.commitMsg,
            branchName: msg.branchName,
            prTitle: msg.prTitle,
            prBody: msg.prBody,
            prBase: msg.prBase,
            selectedFiles: msg.selectedFiles,
          });
        } else if (msg.type === 'cancel') {
          info('[inputService]', 'User cancelled PR creation');
          resolved = true;
          panel.dispose();
          resolve(null);
        } else {
          warn('[inputService]', 'Unknown message type from webview', { type: msg.type });
        }
      } catch (e: unknown) {
        const msgStr = e instanceof Error ? e.message : String(e);
        logError('[inputService]', 'Error handling webview message', {
          messageType: msg.type,
        }, e);
        vscode.window.showErrorMessage(`An error occurred: ${msgStr}`);
      }
    });

    panel.onDidDispose(() => {
      disposable.dispose();
      panelDisposed = true;
      if (!resolved) {
        info('[inputService]', 'Panel disposed without resolution');
        resolve(null);
      }
    });
  });
}

export interface StepByStepInputs {
  branchName: string;
  prBase: string;
}

export interface AddCommitInputs {
  commitMsg: string;
  selectedFiles: string[];
}

export interface FinalizePrInputs {
  prTitle: string;
  prBody: string;
}

function getStepByStepHtml(
  projectConfig: { settings: { defaultBaseBranch: string } },
  currentBranch: string,
): string {
  const defaultBase = currentBranch || projectConfig.settings.defaultBaseBranch;
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
    .form-group {
      margin-bottom: 16px;
    }
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
    .error {
      color: var(--vscode-errorForeground);
      font-size: 12px;
      margin-top: 4px;
      display: none;
    }
    .button-row {
      display: flex;
      gap: 8px;
      margin-top: 24px;
      justify-content: flex-end;
    }
    button {
      border: none;
      padding: 8px 20px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      border-radius: 2px;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    button.ai {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      margin-right: auto;
    }
    button.ai:hover {
      background: var(--vscode-button-hoverBackground);
    }
    h2 {
      margin-top: 0;
      margin-bottom: 20px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    .hint {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    .info-banner {
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      padding: 10px 14px;
      margin-bottom: 20px;
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <h2>Start Step-by-Step PR</h2>

  <div class="info-banner">
    Create a new worktree and branch first. You can add commits later, then finalize the PR when ready.
  </div>

  <div class="form-group">
    <label for="branchDescription">Branch Description</label>
    <input type="text" id="branchDescription" placeholder="Describe what this branch is for: add user login page" />
    <div class="hint">Used by AI to generate the branch name</div>
  </div>

  <div class="form-group">
    <label for="branchName">Branch Name *</label>
    <input type="text" id="branchName" placeholder="feat/user-auth" />
    <div class="error" id="branchNameError">Branch name cannot contain spaces</div>
  </div>

  <div class="form-group">
    <label for="prBase">PR Target Branch *</label>
    <input type="text" id="prBase" placeholder="main" value="${defaultBase}" />
    <div class="error" id="prBaseError">Target branch is required</div>
  </div>

  <div class="button-row">
    <button class="ai" id="aiBranchBtn">AI Generate Branch Name</button>
    <button class="secondary" id="cancelBtn">Cancel</button>
    <button class="primary" id="createBtn">Create Worktree</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('createBtn').addEventListener('click', () => {
      const branchName = document.getElementById('branchName').value.trim();
      const prBase = document.getElementById('prBase').value.trim();

      document.querySelectorAll('.error').forEach(e => e.style.display = 'none');

      let valid = true;
      if (!branchName || /\\s/.test(branchName)) {
        document.getElementById('branchNameError').style.display = 'block';
        valid = false;
      }
      if (!prBase) {
        document.getElementById('prBaseError').style.display = 'block';
        valid = false;
      }
      if (valid) {
        vscode.postMessage({ type: 'submit', branchName, prBase });
      }
    });

    document.getElementById('cancelBtn').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

    document.getElementById('aiBranchBtn').addEventListener('click', () => {
      const desc = document.getElementById('branchDescription').value;
      if (!desc) {
        vscode.postMessage({ type: 'showError', message: 'Please enter a branch description first' });
        return;
      }
      const btn = document.getElementById('aiBranchBtn');
      btn.disabled = true;
      btn.textContent = 'Generating...';
      vscode.postMessage({ type: 'generateBranch', branchDescription: desc });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'branchResult') {
        const input = document.getElementById('branchName');
        if (msg.branchName && input && !input.value) input.value = msg.branchName;
      }
      if (msg.type === 'branchComplete') {
        const btn = document.getElementById('aiBranchBtn');
        btn.disabled = false;
        btn.textContent = 'AI Generate Branch Name';
      }
      if (msg.type === 'showError') {
        alert(msg.message);
      }
    });
  </script>
</body>
</html>`;
}

function getAddCommitHtml(
  changedFiles: { path: string; status: string }[],
  workspaceRoot: string,
  worktreeBranch: string,
): string {
  const normalizedRoot = normalizePath(workspaceRoot);
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
    .form-group { margin-bottom: 16px; }
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
    .error {
      color: var(--vscode-errorForeground);
      font-size: 12px;
      margin-top: 4px;
      display: none;
    }
    .button-row {
      display: flex;
      gap: 8px;
      margin-top: 24px;
      justify-content: flex-end;
    }
    button {
      border: none;
      padding: 8px 20px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      border-radius: 2px;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.ai {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      margin-right: auto;
    }
    button.ai:hover { background: var(--vscode-button-hoverBackground); }
    h2 { margin-top: 0; margin-bottom: 20px; font-weight: 600; color: var(--vscode-editor-foreground); }
    .hint { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .file-list {
      max-height: 200px;
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
  </style>
</head>
<body>
  <h2>Add Commit to ${worktreeBranch}</h2>

  <div class="form-group" id="changedFilesGroup" style="${changedFiles.length === 0 ? 'display:none' : ''}">
    <label>Changed Files</label>
    <div class="file-list" id="fileList">
      ${changedFiles.map((f) => `
      <label class="file-item">
        <input type="checkbox" class="file-checkbox" checked />
        <span class="file-path">${path.relative(normalizedRoot, normalizePath(f.path)).replace(/\\/g, '/')}</span>
        <span class="file-status ${f.status}">${f.status}</span>
      </label>
      `).join('')}
    </div>
    <div class="error" id="fileError">Please select at least one file</div>
    <div class="hint">Uncheck files you don't want to include</div>
  </div>

  <div class="form-group">
    <label for="commitMsg">Commit Message *</label>
    <input type="text" id="commitMsg" placeholder="feat: add user authentication" />
    <div class="error" id="commitMsgError">Commit message is required</div>
  </div>

  <div class="button-row">
    <button class="ai" id="aiBtn">AI Generate Commit Message</button>
    <button class="secondary" id="cancelBtn">Cancel</button>
    <button class="primary" id="submitBtn">Commit to Worktree</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const changedFilesData = ${JSON.stringify(changedFiles.map(f => ({ path: f.path, status: f.status })))};

    document.getElementById('submitBtn').addEventListener('click', () => {
      const commitMsg = document.getElementById('commitMsg').value.trim();
      const selectedFiles = getSelectedFiles();

      document.querySelectorAll('.error').forEach(e => e.style.display = 'none');

      let valid = true;
      if (!commitMsg) {
        document.getElementById('commitMsgError').style.display = 'block';
        valid = false;
      }
      if (selectedFiles.length === 0) {
        document.getElementById('fileError').style.display = 'block';
        valid = false;
      }
      if (valid) {
        vscode.postMessage({ type: 'submit', commitMsg, selectedFiles });
      }
    });

    document.getElementById('cancelBtn').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

    document.getElementById('aiBtn').addEventListener('click', () => {
      document.getElementById('aiBtn').disabled = true;
      document.getElementById('aiBtn').textContent = 'Generating...';
      vscode.postMessage({
        type: 'generateAi',
        commitMsg: document.getElementById('commitMsg').value,
        selectedFiles: getSelectedFiles(),
      });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'aiResult') {
        const commitInput = document.getElementById('commitMsg');
        if (msg.commitMsg && commitInput && !commitInput.value) commitInput.value = msg.commitMsg;
      }
      if (msg.type === 'aiComplete') {
        const btn = document.getElementById('aiBtn');
        btn.disabled = false;
        btn.textContent = 'AI Generate Commit Message';
      }
      if (msg.type === 'showError') {
        alert(msg.message);
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

function getFinalizePrHtml(
  branchName: string,
  prBase: string,
  commitCount: number,
  prTitleDraft: string,
  prBodyDraft: string,
): string {
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
    .form-group { margin-bottom: 16px; }
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
    textarea { resize: vertical; min-height: 100px; }
    .error {
      color: var(--vscode-errorForeground);
      font-size: 12px;
      margin-top: 4px;
      display: none;
    }
    .button-row {
      display: flex;
      gap: 8px;
      margin-top: 24px;
      justify-content: flex-end;
    }
    button {
      border: none;
      padding: 8px 20px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      border-radius: 2px;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.ai {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      margin-right: auto;
    }
    button.ai:hover { background: var(--vscode-button-hoverBackground); }
    h2 { margin-top: 0; margin-bottom: 20px; font-weight: 600; color: var(--vscode-editor-foreground); }
    .hint { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .info-banner {
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      padding: 10px 14px;
      margin-bottom: 20px;
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
    .stat { display: inline-block; margin-right: 16px; font-size: 13px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h2>Finalize Pull Request</h2>

  <div class="info-banner">
    <span class="stat">Branch: <strong>${branchName}</strong></span>
    <span class="stat">Target: <strong>${prBase}</strong></span>
    <span class="stat">Commits: <strong>${commitCount}</strong></span>
  </div>

  <div class="form-group">
    <label for="prTitle">PR Title *</label>
    <input type="text" id="prTitle" placeholder="Add user authentication feature" value="${prTitleDraft.replace(/"/g, '&quot;')}" />
    <div class="error" id="prTitleError">PR title is required</div>
  </div>

  <div class="form-group">
    <label for="prBody">PR Body</label>
    <textarea id="prBody" placeholder="Describe the changes...">${prBodyDraft.replace(/"/g, '&quot;')}</textarea>
  </div>

  <div class="button-row">
    <button class="ai" id="aiBtn">AI Generate PR Description</button>
    <button class="secondary" id="cancelBtn">Cancel</button>
    <button class="primary" id="submitBtn">Push & Create PR</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('submitBtn').addEventListener('click', () => {
      const prTitle = document.getElementById('prTitle').value.trim();
      const prBody = document.getElementById('prBody').value;

      document.querySelectorAll('.error').forEach(e => e.style.display = 'none');
      if (!prTitle) {
        document.getElementById('prTitleError').style.display = 'block';
        return;
      }
      vscode.postMessage({ type: 'submit', prTitle, prBody });
    });

    document.getElementById('cancelBtn').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

    document.getElementById('aiBtn').addEventListener('click', () => {
      document.getElementById('aiBtn').disabled = true;
      document.getElementById('aiBtn').textContent = 'Generating...';
      vscode.postMessage({
        type: 'generateAi',
        prTitle: document.getElementById('prTitle').value,
        prBody: document.getElementById('prBody').value,
      });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'aiResult') {
        const titleInput = document.getElementById('prTitle');
        if (msg.title && titleInput && !titleInput.value) titleInput.value = msg.title;
        const bodyInput = document.getElementById('prBody');
        if (msg.body && bodyInput && !bodyInput.value) bodyInput.value = msg.body;
      }
      if (msg.type === 'aiComplete') {
        const btn = document.getElementById('aiBtn');
        btn.disabled = false;
        btn.textContent = 'AI Generate PR Description';
      }
    });
  </script>
</body>
</html>`;
}

export async function collectStepByStepInputs(
  workspaceRoot: string,
  currentBranch: string,
): Promise<StepByStepInputs | null> {
  const projectConfig = loadProjectConfig(workspaceRoot);

  return new Promise<StepByStepInputs | null>((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'quickPrStepByStep',
      'Start Step-by-Step PR',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true },
    );

    panel.webview.html = getStepByStepHtml(projectConfig, currentBranch);

    let resolved = false;

    const disposable = panel.webview.onDidReceiveMessage(async (msg) => {
      if (resolved) return;
      try {
        if (msg.type === 'generateBranch') {
          const branchName = await generateBranchName(
            msg.branchDescription || '',
            projectConfig.branchNameRule,
            await getRecentCommits(workspaceRoot),
          );
          if (branchName) {
            panel.webview.postMessage({ type: 'branchResult', branchName });
          }
          panel.webview.postMessage({ type: 'branchComplete' });
          info('[inputService]', 'AI branch name result sent');
        } else if (msg.type === 'showError') {
          vscode.window.showWarningMessage(msg.message);
        } else if (msg.type === 'submit') {
          resolved = true;
          panel.dispose();
          resolve({ branchName: msg.branchName, prBase: msg.prBase });
        } else if (msg.type === 'cancel') {
          resolved = true;
          panel.dispose();
          resolve(null);
        }
      } catch (e: unknown) {
        const msgStr = e instanceof Error ? e.message : String(e);
        logError('[inputService]', 'Error handling step-by-step webview message', {}, e);
        vscode.window.showErrorMessage(`An error occurred: ${msgStr}`);
      }
    });

    panel.onDidDispose(() => {
      disposable.dispose();
      if (!resolved) resolve(null);
    });
  });
}

export async function collectAddCommitInputs(
  workspaceRoot: string,
  changedFiles: { path: string; status: string }[],
  worktreeBranch: string,
): Promise<AddCommitInputs | null> {
  const projectConfig = loadProjectConfig(workspaceRoot);

  return new Promise<AddCommitInputs | null>((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'quickPrAddCommit',
      'Add Commit',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true },
    );

    panel.webview.html = getAddCommitHtml(changedFiles, workspaceRoot, worktreeBranch);

    let resolved = false;

    const disposable = panel.webview.onDidReceiveMessage(async (msg) => {
      if (resolved) return;
      try {
        if (msg.type === 'generateAi') {
          const filesDiff = await getFilesDiff(workspaceRoot, msg.selectedFiles || []);
          const commitMsg = await generateCommitMessage(
            msg.commitMsg || '',
            filesDiff,
            projectConfig.commitMessageRule,
            await getRecentCommits(workspaceRoot),
          );
          if (commitMsg) {
            panel.webview.postMessage({ type: 'aiResult', commitMsg });
          }
          panel.webview.postMessage({ type: 'aiComplete' });
        } else if (msg.type === 'submit') {
          resolved = true;
          panel.dispose();
          resolve({ commitMsg: msg.commitMsg, selectedFiles: msg.selectedFiles });
        } else if (msg.type === 'cancel') {
          resolved = true;
          panel.dispose();
          resolve(null);
        }
      } catch (e: unknown) {
        const msgStr = e instanceof Error ? e.message : String(e);
        logError('[inputService]', 'Error handling add-commit webview message', {}, e);
        vscode.window.showErrorMessage(`An error occurred: ${msgStr}`);
      }
    });

    panel.onDidDispose(() => {
      disposable.dispose();
      if (!resolved) resolve(null);
    });
  });
}

export async function collectFinalizePrInputs(
  workspaceRoot: string,
  branchName: string,
  prBase: string,
  commitCount: number,
  worktreePath: string,
  baseCommitish: string,
): Promise<FinalizePrInputs | null> {
  const projectConfig = loadProjectConfig(workspaceRoot);

  return new Promise<FinalizePrInputs | null>((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'quickPrFinalize',
      'Finalize PR',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true },
    );

    panel.webview.html = getFinalizePrHtml(branchName, prBase, commitCount, '', '');

    let resolved = false;

    const disposable = panel.webview.onDidReceiveMessage(async (msg) => {
      if (resolved) return;
      try {
        if (msg.type === 'generateAi') {
          const branchDiff = await getBranchDiff(worktreePath, baseCommitish);
          const result = await generatePrDescription(
            msg.prTitle || '',
            msg.prBody || '',
            branchName,
            branchDiff,
            projectConfig.prTitleRule,
            projectConfig.prBodyRule,
            await getRecentCommits(workspaceRoot),
          );
          if (result) {
            panel.webview.postMessage({ type: 'aiResult', title: result.title, body: result.body });
          }
          panel.webview.postMessage({ type: 'aiComplete' });
        } else if (msg.type === 'submit') {
          resolved = true;
          panel.dispose();
          resolve({ prTitle: msg.prTitle, prBody: msg.prBody });
        } else if (msg.type === 'cancel') {
          resolved = true;
          panel.dispose();
          resolve(null);
        }
      } catch (e: unknown) {
        const msgStr = e instanceof Error ? e.message : String(e);
        logError('[inputService]', 'Error handling finalize webview message', {}, e);
        vscode.window.showErrorMessage(`An error occurred: ${msgStr}`);
      }
    });

    panel.onDidDispose(() => {
      disposable.dispose();
      if (!resolved) resolve(null);
    });
  });
}
