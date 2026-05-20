import * as vscode from 'vscode';
import { generatePrContent } from './aiService';
import { loadProjectConfig } from './projectConfig';

export interface CollectedInputs {
  commitMsg: string;
  branchName: string;
  prTitle: string;
  prBody: string;
  prBase: string;
}

export async function collectInputs(
  workspaceRoot: string,
): Promise<CollectedInputs | null> {
  const commitMsg = await vscode.window.showInputBox({
    prompt: 'Commit message',
    placeHolder: 'feat: add user authentication',
    title: 'Quick PR (1/5)',
    validateInput: (value: string) =>
      value.trim() ? null : 'Commit message is required',
  });
  if (!commitMsg) return null;

  const branchName = await vscode.window.showInputBox({
    prompt: 'New branch name',
    placeHolder: 'feat/user-auth',
    title: 'Quick PR (2/5)',
    validateInput: (value: string) =>
      /^[^\s]+$/.test(value.trim()) ? null : 'Branch name cannot contain spaces',
  });
  if (!branchName) return null;

  // Load project config for AI rules and default base branch
  const projectConfig = loadProjectConfig(workspaceRoot);

  // Try AI generation first if enabled
  let prTitle = '';
  let prBody = '';
  let aiGenerated = false;

  const aiEnabled = vscode.workspace
    .getConfiguration('quick-pr')
    .get<boolean>('ai.enabled', false);

  if (aiEnabled) {
    const aiResult = await generatePrContent(
      commitMsg,
      branchName,
      projectConfig.prTitleRule,
      projectConfig.prBodyRule,
    );

    if (aiResult) {
      const confirmedTitle = await vscode.window.showInputBox({
        prompt: 'PR Title (AI generated, edit or confirm)',
        value: aiResult.title,
        title: 'Quick PR (3/5) - AI Generated',
        validateInput: (value: string) =>
          value.trim() ? null : 'PR title is required',
      });
      if (confirmedTitle === undefined) return null;
      prTitle = confirmedTitle;

      const confirmedBody = await vscode.window.showInputBox({
        prompt: 'PR Body (AI generated, edit or confirm)',
        value: aiResult.body,
        title: 'Quick PR (4/5) - AI Generated',
      });
      if (confirmedBody === undefined) return null;
      prBody = confirmedBody;

      aiGenerated = true;
    }
  }

  if (!aiGenerated) {
    prTitle =
      (await vscode.window.showInputBox({
        prompt: 'PR Title',
        placeHolder: 'Add user authentication feature',
        title: 'Quick PR (3/5)',
        validateInput: (value: string) =>
          value.trim() ? null : 'PR title is required',
      })) ?? '';
    if (!prTitle) return null;

    prBody =
      (await vscode.window.showInputBox({
        prompt: 'PR Body (optional)',
        placeHolder: 'Describe the changes...',
        title: 'Quick PR (4/5)',
      })) ?? '';
  }

  // Base branch with pre-fill from project config (user can change)
  const defaultBase = projectConfig.settings.defaultBaseBranch;
  const prBase = await vscode.window.showInputBox({
    prompt: 'PR target branch',
    value: defaultBase,
    title: 'Quick PR (5/5)',
    validateInput: (value: string) =>
      value.trim() ? null : 'Target branch is required',
  });
  if (!prBase) return null;

  return { commitMsg, branchName, prTitle, prBody, prBase };
}
