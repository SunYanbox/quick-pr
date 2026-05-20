import * as vscode from 'vscode';
import * as path from 'path';
import { generatePrContent } from './aiService';
import { loadProjectConfig } from './projectConfig';
import { getRecentCommits } from './gitService';
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
  </style>
</head>
<body>
  <h2>Create Pull Request</h2>

  <div class="form-group" id="changedFilesGroup" style="${changedFiles.length === 0 ? 'display:none' : ''}">
    <label>Changed Files</label>
    <div class="file-list" id="fileList">
      ${changedFiles.map((f, i) => `
      <label class="file-item">
        <input type="checkbox" class="file-checkbox" checked />
        <span class="file-path">${path.relative(normalizedRoot, normalizePath(f.path)).replace(/\\/g, '/')}</span>
        <span class="file-status ${f.status}">${f.status}</span>
      </label>
      `).join('')}
    </div>
    <div class="error" id="fileError">Please select at least one file</div>
    <div class="hint">Uncheck files you don't want to include in this PR</div>
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
    <button class="settings" id="settingsBtn" title="Open Quick PR settings">⚙ Settings</button>
    <button class="ai" id="aiBtn">✨ Generate with AI</button>
    <button class="secondary" id="cancelBtn">Cancel</button>
    <button class="primary" id="submitBtn">Create PR</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('submitBtn').addEventListener('click', () => validateAndSubmit());
    document.getElementById('cancelBtn').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

    document.getElementById('settingsBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    const aiBtn = document.getElementById('aiBtn');
    if (aiBtn) {
      aiBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'generateAi',
          commitMsg: document.getElementById('commitMsg').value,
          branchName: document.getElementById('branchName').value,
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

    // Listen for AI-generated content
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'aiResult') {
        if (msg.commitMsg) document.getElementById('commitMsg').value = msg.commitMsg;
        if (msg.branchName) document.getElementById('branchName').value = msg.branchName;
        if (msg.title) document.getElementById('prTitle').value = msg.title;
        if (msg.body) document.getElementById('prBody').value = msg.body;
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
      'Quick PR',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [],
      },
    );

    panel.webview.html = getWebviewHtml(projectConfig, changedFiles, workspaceRoot, currentBranch);

    let resolved = false;
    let panelDisposed = false;

    const disposable = panel.webview.onDidReceiveMessage(async (msg) => {
      if (resolved || panelDisposed) return;
      try {
        if (msg.type === 'openSettings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'quick-pr');
        } else if (msg.type === 'generateAi') {
          info('[inputService]', 'AI generation requested', {
            commitMsgPreview: (msg.commitMsg || '').slice(0, 80),
            branchName: msg.branchName,
          });

          const isAiEnabled = vscode.workspace
            .getConfiguration('quick-pr')
            .get<boolean>('ai.enabled', false);

          if (!isAiEnabled) {
            const action = await vscode.window.showWarningMessage(
              'AI generation is not enabled. Enable it in Quick PR settings to use this feature.',
              'Open Settings',
              'Cancel',
            );
            if (action === 'Open Settings') {
              vscode.commands.executeCommand('workbench.action.openSettings', 'quick-pr.ai');
            }
            return;
          }

          const aiResult = await generatePrContent(
            msg.commitMsg,
            msg.branchName,
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
            info('[inputService]', 'AI result sent to webview');
          } else {
            warn('[inputService]', 'AI generation returned no result');
          }
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
