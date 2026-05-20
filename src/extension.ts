import * as vscode from 'vscode';
import { collectInputs } from './inputService';
import {
  getCurrentRepo,
  getChangedFiles,
  createWorktree,
  commitAndPush,
  copyFilesToWorktree,
  deleteWorktree,
  openPrUrl,
} from './gitService';
import { checkGhCli, createPr } from './prService';
import { initLogger, info, error as logError } from './logger';
import { initProjectConfig } from './projectConfig';

export function activate(context: vscode.ExtensionContext) {
  console.log('Quick PR extension activated');

  // Initialize project config files on activation
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  if (workspaceRoot) {
    initProjectConfig(workspaceRoot);
    initLogger(workspaceRoot);
    info('[extension]', 'Project config initialized on activation', { workspaceRoot });
  }

  const disposable = vscode.commands.registerCommand(
    'quick-pr.createPr',
    async () => {
      const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      initLogger(workspaceRoot);
      info('[extension]', 'Starting PR creation flow', { workspaceRoot });

      // Step 2: Check gh CLI
      const ghAvailable = await checkGhCli();
      if (!ghAvailable) return;

      // Step 3: Get current repo status
      const gitStatus = getCurrentRepo();
      if (!gitStatus) return;

      info('[extension]', 'Git status retrieved', { currentBranch: gitStatus.currentBranch });

      // Step 4: Get changed files for user selection
      const changedFiles = getChangedFiles(gitStatus.repo);
      if (changedFiles.length === 0) {
        vscode.window.showWarningMessage('No changes detected in the repository.');
        return;
      }

      info('[extension]', 'Changed files detected', { fileCount: changedFiles.length });

      // Step 5: Collect inputs with file selection
      const inputs = await collectInputs(workspaceRoot, changedFiles, gitStatus.currentBranch);
      if (!inputs) {
        info('[extension]', 'User cancelled input collection');
        return; // user cancelled
      }

      const { commitMsg, branchName, prTitle, prBody, prBase, selectedFiles } = inputs;

      info('[extension]', 'Inputs collected', {
        branchName,
        prBase,
        selectedFilesCount: selectedFiles.length,
        commitMsgPreview: commitMsg.slice(0, 80),
        prTitlePreview: prTitle.slice(0, 80),
      });

      // Steps 6-8: Create worktree, copy files, commit & push, create PR
      const prResult = await vscode.window.withProgress<{ prUrl: string; worktreePath: string } | null>(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Quick PR',
          cancellable: false,
        },
        async (progress) => {
          try {
            // Step 6: Create worktree
            progress.report({ message: 'Creating worktree...' });
            const wtPath = await createWorktree(gitStatus.repo, branchName);
            if (!wtPath) return null;

            info('[extension]', 'Worktree created', { worktreePath: wtPath });

            // Copy selected files from original repo to worktree
            progress.report({ message: 'Copying files...' });
            const filesCopied = await copyFilesToWorktree(
              gitStatus.repo.rootUri.fsPath,
              wtPath,
              selectedFiles,
            );
            if (!filesCopied) return null;

            info('[extension]', 'Files copied to worktree', { fileCount: selectedFiles.length });

            // Commit and push
            progress.report({ message: 'Committing and pushing...' });
            const success = await commitAndPush(wtPath, commitMsg, branchName);
            if (!success) return null;

            info('[extension]', 'Commit and push successful', { branchName });

            // Create PR
            progress.report({ message: 'Creating PR...' });
            const url = await createPr({
              title: prTitle,
              body: prBody,
              base: prBase,
              head: branchName,
              worktreePath: wtPath,
            });
            if (!url) return null;

            info('[extension]', 'PR created', { prUrl: url, base: prBase, head: branchName });
            return { prUrl: url, worktreePath: wtPath };
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            logError('[extension]', 'PR creation flow failed', {
              branchName,
              prBase,
              selectedFilesCount: selectedFiles?.length ?? 0,
            }, e);
            vscode.window.showErrorMessage(`PR creation failed: ${msg}`);
            return null;
          }
        },
      );

      if (!prResult) return;

      // Open PR URL
      await openPrUrl(prResult.prUrl);

      // Cleanup worktree
      const config = vscode.workspace.getConfiguration('quick-pr');
      const autoCleanup = config.get<boolean>(
        'cleanupWorktreeAfterPr',
        true,
      );

      if (autoCleanup) {
        await deleteWorktree(gitStatus.repo.rootUri.fsPath, prResult.worktreePath);
        info('[extension]', 'Worktree auto-cleaned', { worktreePath: prResult.worktreePath });
      } else {
        const keep = await vscode.window.showQuickPick(
          ['Keep worktree', 'Delete worktree'],
          {
            placeHolder:
              'PR created. Delete the temporary worktree?',
          },
        );
        if (keep === 'Delete worktree') {
          await deleteWorktree(gitStatus.repo.rootUri.fsPath, prResult.worktreePath);
          info('[extension]', 'Worktree deleted by user choice', { worktreePath: prResult.worktreePath });
        }
      }
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
