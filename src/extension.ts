import * as vscode from 'vscode';
import { collectInputs } from './inputService';
import {
  getCurrentRepo,
  getChangedFiles,
  createWorktree,
  findWorktreeRepo,
  commitAndPush,
  copyFilesToWorktree,
  deleteWorktree,
  openPrUrl,
} from './gitService';
import { checkGhCli, createPr } from './prService';

export function activate(context: vscode.ExtensionContext) {
  console.log('Quick PR extension activated');

  const disposable = vscode.commands.registerCommand(
    'quick-pr.createPr',
    async () => {
      const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      // Step 2: Check gh CLI
      const ghAvailable = await checkGhCli();
      if (!ghAvailable) return;

      // Step 3: Get current repo status
      const gitStatus = getCurrentRepo();
      if (!gitStatus) return;

      // Step 4: Get changed files for user selection
      const changedFiles = getChangedFiles(gitStatus.repo);
      if (changedFiles.length === 0) {
        vscode.window.showWarningMessage('No changes detected in the repository.');
        return;
      }

      // Step 5: Collect inputs with file selection
      const inputs = await collectInputs(workspaceRoot, changedFiles);
      if (!inputs) return; // user cancelled

      const { commitMsg, branchName, prTitle, prBody, prBase, selectedFiles } = inputs;

      // Step 6: Create worktree
      const worktreePath = await createWorktree(
        gitStatus.repo,
        branchName,
        gitStatus.repo.rootUri,
      );
      if (!worktreePath) return;

      try {
        // Step 7: Copy selected files to worktree and commit
        const worktreeRepo = await findWorktreeRepo(worktreePath);
        if (!worktreeRepo) {
          vscode.window.showErrorMessage('Could not find worktree repository');
          return;
        }

        // Copy selected files from original repo to worktree
        const filesCopied = await copyFilesToWorktree(
          gitStatus.repo.rootUri.fsPath,
          worktreePath,
          selectedFiles,
          worktreeRepo,
        );
        if (!filesCopied) return;

        const success = await commitAndPush(
          worktreeRepo,
          commitMsg,
          branchName,
        );
        if (!success) return;

        // Step 8: Create PR
        const prUrl = await createPr({
          title: prTitle,
          body: prBody,
          base: prBase,
          head: branchName,
          worktreePath,
        });
        if (!prUrl) return;

        // Step 9: Open PR URL
        await openPrUrl(prUrl);

        // Step 10: Cleanup worktree
        const config = vscode.workspace.getConfiguration('quick-pr');
        const autoCleanup = config.get<boolean>(
          'cleanupWorktreeAfterPr',
          true,
        );

        if (autoCleanup) {
          await deleteWorktree(gitStatus.repo, worktreePath);
        } else {
          const keep = await vscode.window.showQuickPick(
            ['Keep worktree', 'Delete worktree'],
            {
              placeHolder:
                'PR created. Delete the temporary worktree?',
            },
          );
          if (keep === 'Delete worktree') {
            await deleteWorktree(gitStatus.repo, worktreePath);
          }
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Error: ${e.message}`);
      }
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
