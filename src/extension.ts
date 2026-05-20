import * as vscode from 'vscode';
import { collectInputs } from './inputService';
import {
  getCurrentRepo,
  stageAllChanges,
  createWorktree,
  findWorktreeRepo,
  commitAndPush,
  deleteWorktree,
  openPrUrl,
} from './gitService';
import { checkGhCli, createPr } from './prService';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    'quick-pr.createPr',
    async () => {
      const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      // Step 1: Collect inputs from user
      const inputs = await collectInputs(workspaceRoot);
      if (!inputs) return; // user cancelled

      const { commitMsg, branchName, prTitle, prBody, prBase } = inputs;

      // Step 2: Check gh CLI
      const ghAvailable = await checkGhCli();
      if (!ghAvailable) return;

      // Step 3: Get current repo status
      const gitStatus = getCurrentRepo();
      if (!gitStatus) return;

      // Step 4: Handle changes
      const hasStaged = gitStatus.hasStagedChanges;
      const hasWorking = gitStatus.hasWorkingChanges;

      if (!hasStaged && !hasWorking) {
        const action = await vscode.window.showWarningMessage(
          'No changes detected in the repository.',
          { modal: true },
        );
        return;
      }

      if (hasWorking && !hasStaged) {
        const action = await vscode.window.showWarningMessage(
          'You have unstaged changes. Stage all and proceed?',
          { modal: true },
          'Yes, stage all',
        );
        if (action !== 'Yes, stage all') return;

        const staged = await stageAllChanges(gitStatus.repo);
        if (!staged) return;
      }

      // Step 5: Create worktree
      const worktreePath = await createWorktree(
        gitStatus.repo,
        branchName,
        gitStatus.repo.rootUri,
      );
      if (!worktreePath) return;

      try {
        // Step 6: Find worktree repo and commit+push
        const worktreeRepo = await findWorktreeRepo(worktreePath);
        if (!worktreeRepo) {
          vscode.window.showErrorMessage(
            'Could not find worktree repository',
          );
          return;
        }

        const success = await commitAndPush(
          worktreeRepo,
          commitMsg,
          branchName,
        );
        if (!success) return;

        // Step 7: Create PR
        const prUrl = await createPr({
          title: prTitle,
          body: prBody,
          base: prBase,
          head: branchName,
          worktreePath,
        });
        if (!prUrl) return;

        // Step 8: Open PR URL
        await openPrUrl(prUrl);

        // Step 9: Cleanup worktree
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
