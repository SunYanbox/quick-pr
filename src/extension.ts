import * as vscode from 'vscode';
import { collectInputs, collectStepByStepInputs, collectAddCommitInputs, collectFinalizePrInputs } from './inputService';
import {
  getCurrentRepo,
  getChangedFiles,
  createWorktree,
  commitOnly,
  pushWithFallbacks,
  copyFilesToWorktree,
  deleteWorktree,
  openPrUrl,
} from './gitService';
import { checkGhCli, createPr } from './prService';
import { initLogger, info, error as logError } from './logger';
import { initProjectConfig } from './projectConfig';
import { WorktreeTreeDataProvider } from './worktreeTreeView';
import { openWorktreeWebview } from './worktreeWebview';
import {
  addWorktree,
  updateWorktree,
  removeWorktree,
  getActiveWorktree,
  getWorktree,
  WorktreeInfo,
} from './worktreeManager';

export function activate(context: vscode.ExtensionContext) {
  console.log('Quick PR Studio extension activated');

  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  if (workspaceRoot) {
    initProjectConfig(workspaceRoot);
    initLogger(workspaceRoot);
    info('[extension]', 'Project config initialized on activation', { workspaceRoot });
  }

  const treeDataProvider = new WorktreeTreeDataProvider(
    workspaceRoot || '',
  );
  const treeView = vscode.window.createTreeView('quick-pr-studio-worktreeList', {
    treeDataProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  const createPrDisposable = vscode.commands.registerCommand(
    'quick-pr-studio.createPr',
    async () => {
      const wsRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!wsRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      initLogger(wsRoot);
      info('[extension]', 'Starting PR creation flow', { workspaceRoot: wsRoot });

      const ghAvailable = await checkGhCli();
      if (!ghAvailable) return;

      const gitStatus = getCurrentRepo();
      if (!gitStatus) return;

      info('[extension]', 'Git status retrieved', { currentBranch: gitStatus.currentBranch });

      const changedFiles = getChangedFiles(gitStatus.repo);
      if (changedFiles.length === 0) {
        vscode.window.showWarningMessage('No changes detected in the repository.');
        return;
      }

      info('[extension]', 'Changed files detected', { fileCount: changedFiles.length });

      const inputs = await collectInputs(wsRoot, changedFiles, gitStatus.currentBranch);
      if (!inputs) {
        info('[extension]', 'User cancelled input collection');
        return;
      }

      const { commitMsg, branchName, prTitle, prBody, prBase, selectedFiles } = inputs;

      info('[extension]', 'Inputs collected', {
        branchName,
        prBase,
        selectedFilesCount: selectedFiles.length,
        commitMsgPreview: commitMsg.slice(0, 80),
        prTitlePreview: prTitle.slice(0, 80),
      });

      const prResult = await vscode.window.withProgress<{ prUrl: string; worktreePath: string } | null>(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Quick PR Studio',
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: 'Creating worktree...' });
            const wtPath = await createWorktree(gitStatus.repo, branchName);
            if (!wtPath) return null;

            info('[extension]', 'Worktree created', { worktreePath: wtPath });

            progress.report({ message: 'Copying files...' });
            const filesCopied = await copyFilesToWorktree(
              gitStatus.repo.rootUri.fsPath,
              wtPath,
              selectedFiles,
            );
            if (!filesCopied) return null;

            info('[extension]', 'Files copied to worktree', { fileCount: selectedFiles.length });

            progress.report({ message: 'Committing and pushing...' });
            const committed = await commitOnly(wtPath, commitMsg);
            if (!committed) return null;

            const pushed = await pushWithFallbacks(wtPath, branchName);
            if (!pushed) return null;

            info('[extension]', 'Commit and push successful', { branchName });

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

      await openPrUrl(prResult.prUrl);

      const config = vscode.workspace.getConfiguration('quick-pr-studio');
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
      treeDataProvider.refresh();
    },
  );
  context.subscriptions.push(createPrDisposable);

  const startStepByStepDisposable = vscode.commands.registerCommand(
    'quick-pr-studio.startStepByStep',
    async () => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!wsRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      initLogger(wsRoot);
      info('[extension.startStepByStep]', 'Starting step-by-step workflow');

      const ghAvailable = await checkGhCli();
      if (!ghAvailable) return;

      const gitStatus = getCurrentRepo();
      if (!gitStatus) return;

      const inputs = await collectStepByStepInputs(wsRoot);
      if (!inputs) {
        info('[extension.startStepByStep]', 'User cancelled');
        return;
      }

      const { branchName, prBase } = inputs;
      const commitish = gitStatus.repo.state.HEAD?.name || 'HEAD';

      const wtPath = await vscode.window.withProgress<string | null>(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Quick PR Studio',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Creating worktree...' });
          return createWorktree(gitStatus.repo, branchName);
        },
      );

      if (!wtPath) return;

      const safeId = branchName.replace(/\//g, '-');

      const worktreeInfo: WorktreeInfo = {
        id: safeId,
        branchName,
        worktreePath: wtPath,
        baseCommitish: commitish,
        prBase,
        status: 'created',
        commitCount: 0,
        lastCommitMsg: '',
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      };
      addWorktree(wsRoot, worktreeInfo);
      treeDataProvider.refresh();

      info('[extension.startStepByStep]', 'Worktree created (step-by-step)', {
        branchName,
        worktreePath: wtPath,
        baseCommitish: commitish,
      });

      vscode.window.showInformationMessage(
        `Worktree "${branchName}" created. Use "Add Commit" in the sidebar to add your first commit.`,
      );
    },
  );
  context.subscriptions.push(startStepByStepDisposable);

  const addCommitDisposable = vscode.commands.registerCommand(
    'quick-pr-studio.addCommit',
    async () => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!wsRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      initLogger(wsRoot);

      const active = getActiveWorktree(wsRoot);
      if (!active) {
        vscode.window.showWarningMessage(
          'No active worktree. Create one first with "Start Step-by-Step PR" in the sidebar.',
        );
        return;
      }

      const gitStatus = getCurrentRepo();
      if (!gitStatus) return;

      const changedFiles = getChangedFiles(gitStatus.repo);
      if (changedFiles.length === 0) {
        vscode.window.showWarningMessage('No changes detected in the repository.');
        return;
      }

      const inputs = await collectAddCommitInputs(wsRoot, changedFiles, active.branchName);
      if (!inputs) {
        info('[extension.addCommit]', 'User cancelled commit');
        return;
      }

      const { commitMsg, selectedFiles } = inputs;

      const success = await vscode.window.withProgress<boolean>(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Quick PR Studio',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Copying files...' });
          const copied = await copyFilesToWorktree(
            gitStatus.repo.rootUri.fsPath,
            active.worktreePath,
            selectedFiles,
          );
          if (!copied) return false;

          progress.report({ message: 'Committing...' });
          const committed = await commitOnly(active.worktreePath, commitMsg);
          if (!committed) return false;

          return true;
        },
      );

      if (success) {
        updateWorktree(wsRoot, active.id, {
          status: 'committed',
          commitCount: active.commitCount + 1,
          lastCommitMsg: commitMsg,
          lastActivityAt: new Date().toISOString(),
        });
        treeDataProvider.refresh();
        vscode.window.showInformationMessage(`Commit added to "${active.branchName}" (${active.commitCount + 1} total)`);
      }
    },
  );
  context.subscriptions.push(addCommitDisposable);

  const finalizePrDisposable = vscode.commands.registerCommand(
    'quick-pr-studio.finalizePr',
    async () => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!wsRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      initLogger(wsRoot);

      const active = getActiveWorktree(wsRoot);
      if (!active) {
        vscode.window.showWarningMessage('No active worktree to finalize.');
        return;
      }

      if (active.commitCount === 0) {
        vscode.window.showWarningMessage('No commits in this worktree. Add at least one commit first.');
        return;
      }

      const inputs = await collectFinalizePrInputs(
        wsRoot,
        active.branchName,
        active.prBase,
        active.commitCount,
        active.worktreePath,
        active.baseCommitish,
      );
      if (!inputs) {
        info('[extension.finalizePr]', 'User cancelled finalization');
        return;
      }

      const { prTitle, prBody } = inputs;

      const result = await vscode.window.withProgress<string | null>(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Quick PR Studio',
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: 'Pushing...' });
            updateWorktree(wsRoot, active.id, { status: 'pushing' });

            const pushed = await pushWithFallbacks(active.worktreePath, active.branchName);
            if (!pushed) {
              updateWorktree(wsRoot, active.id, {
                status: 'error',
                errorMessage: 'Push failed — check network or remote permissions',
                lastActivityAt: new Date().toISOString(),
              });
              return null;
            }

            progress.report({ message: 'Creating PR...' });
            updateWorktree(wsRoot, active.id, { status: 'pr_creating' });

            const url = await createPr({
              title: prTitle,
              body: prBody,
              base: active.prBase,
              head: active.branchName,
              worktreePath: active.worktreePath,
            });
            if (!url) {
              updateWorktree(wsRoot, active.id, {
                status: 'error',
                errorMessage: 'PR creation failed — check gh CLI authentication',
                lastActivityAt: new Date().toISOString(),
              });
              return null;
            }

            updateWorktree(wsRoot, active.id, {
              status: 'pr_created',
              lastActivityAt: new Date().toISOString(),
            });

            return url;
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            updateWorktree(wsRoot, active.id, {
              status: 'error',
              errorMessage: msg,
              lastActivityAt: new Date().toISOString(),
            });
            logError('[extension.finalizePr]', 'Finalize failed', { branchName: active.branchName }, e);
            return null;
          }
        },
      );

      treeDataProvider.refresh();

      if (result) {
        await openPrUrl(result);

        const config = vscode.workspace.getConfiguration('quick-pr-studio');
        const autoCleanup = config.get<boolean>('autoCleanupWorktree', false);
        if (autoCleanup) {
          await deleteWorktree(wsRoot, active.worktreePath);
          removeWorktree(wsRoot, active.id);
          treeDataProvider.refresh();
          info('[extension.finalizePr]', 'Worktree auto-cleaned');
        }
      }
    },
  );
  context.subscriptions.push(finalizePrDisposable);

  const openWorktreeDisposable = vscode.commands.registerCommand(
    'quick-pr-studio.openWorktree',
    async (worktreeId?: string) => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!wsRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      initLogger(wsRoot);

      const id = worktreeId || getActiveWorktree(wsRoot)?.id;
      if (!id) {
        vscode.window.showWarningMessage('No worktree selected');
        return;
      }

      const info = getWorktree(wsRoot, id);
      if (!info) {
        vscode.window.showErrorMessage('Worktree not found');
        return;
      }

      await openWorktreeWebview(
        wsRoot,
        id,
        context,
        async (wtInfo, commitMsg, selectedFiles) => {
          const copied = await copyFilesToWorktree(wsRoot, wtInfo.worktreePath, selectedFiles);
          if (!copied) return false;
          const committed = await commitOnly(wtInfo.worktreePath, commitMsg);
          if (committed) {
            updateWorktree(wsRoot, id, {
              status: wtInfo.commitCount === 0 ? 'committed' : wtInfo.status,
              commitCount: wtInfo.commitCount + 1,
              lastCommitMsg: commitMsg,
              lastActivityAt: new Date().toISOString(),
            });
            treeDataProvider.refresh();
          }
          return committed;
        },
        async (wtInfo) => {
          vscode.commands.executeCommand('quick-pr-studio.finalizePr');
        },
        async (wtInfo) => {
          vscode.commands.executeCommand('quick-pr-studio.retryWorktree');
        },
        async (wtInfo) => {
          const gitStatus = getCurrentRepo();
          if (gitStatus) {
            await deleteWorktree(gitStatus.repo.rootUri.fsPath, wtInfo.worktreePath);
          }
          removeWorktree(wsRoot, id);
          treeDataProvider.refresh();
          vscode.window.showInformationMessage(`Worktree "${wtInfo.branchName}" deleted`);
        },
      );
    },
  );
  context.subscriptions.push(openWorktreeDisposable);

  const retryWorktreeDisposable = vscode.commands.registerCommand(
    'quick-pr-studio.retryWorktree',
    async () => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!wsRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      initLogger(wsRoot);

      const active = getActiveWorktree(wsRoot);
      if (!active || active.status !== 'error') {
        vscode.window.showWarningMessage('No failed worktree to retry.');
        return;
      }

      const result = await vscode.window.withProgress<string | null>(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Quick PR Studio',
          cancellable: false,
        },
        async (progress) => {
          try {
            const prevStatus = active.errorMessage?.includes('PR creation') ? 'pr_creating' : 'committed';

            if (prevStatus === 'committed') {
              progress.report({ message: 'Retrying push...' });
              updateWorktree(wsRoot, active.id, { status: 'pushing', errorMessage: undefined });

              const pushed = await pushWithFallbacks(active.worktreePath, active.branchName);
              if (!pushed) {
                updateWorktree(wsRoot, active.id, {
                  status: 'error',
                  errorMessage: 'Push failed on retry',
                  lastActivityAt: new Date().toISOString(),
                });
                return null;
              }
            }

            progress.report({ message: 'Creating PR...' });
            updateWorktree(wsRoot, active.id, { status: 'pr_creating', errorMessage: undefined });

            const inputs = await collectFinalizePrInputs(
              wsRoot,
              active.branchName,
              active.prBase,
              active.commitCount,
              active.worktreePath,
              active.baseCommitish,
            );
            if (!inputs) return null;

            const url = await createPr({
              title: inputs.prTitle,
              body: inputs.prBody,
              base: active.prBase,
              head: active.branchName,
              worktreePath: active.worktreePath,
            });
            if (!url) {
              updateWorktree(wsRoot, active.id, {
                status: 'error',
                errorMessage: 'PR creation failed on retry',
                lastActivityAt: new Date().toISOString(),
              });
              return null;
            }

            updateWorktree(wsRoot, active.id, {
              status: 'pr_created',
              errorMessage: undefined,
              lastActivityAt: new Date().toISOString(),
            });

            return url;
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            updateWorktree(wsRoot, active.id, {
              status: 'error',
              errorMessage: msg,
              lastActivityAt: new Date().toISOString(),
            });
            return null;
          }
        },
      );

      treeDataProvider.refresh();

      if (result) {
        await openPrUrl(result);
      }
    },
  );
  context.subscriptions.push(retryWorktreeDisposable);

  const cleanupWorktreeDisposable = vscode.commands.registerCommand(
    'quick-pr-studio.cleanupWorktree',
    async () => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
      if (!wsRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      initLogger(wsRoot);

      const active = getActiveWorktree(wsRoot);
      if (!active) {
        vscode.window.showWarningMessage('No active worktree to clean up.');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete worktree "${active.branchName}"? This will remove the worktree directory and its branch.`,
        { modal: true },
        'Delete',
      );
      if (confirm !== 'Delete') return;

      const gitStatus = getCurrentRepo();
      let deleted = true;
      if (gitStatus) {
        deleted = await deleteWorktree(gitStatus.repo.rootUri.fsPath, active.worktreePath);
      }
      if (deleted) {
        removeWorktree(wsRoot, active.id);
        treeDataProvider.refresh();
        vscode.window.showInformationMessage(`Worktree "${active.branchName}" cleaned up`);
      }
    },
  );
  context.subscriptions.push(cleanupWorktreeDisposable);

  const refreshWorktreesDisposable = vscode.commands.registerCommand(
    'quick-pr-studio.refreshWorktrees',
    () => {
      treeDataProvider.refresh();
    },
  );
  context.subscriptions.push(refreshWorktreesDisposable);
}

export function deactivate() {}
