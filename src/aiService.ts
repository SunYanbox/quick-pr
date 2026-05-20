import * as vscode from 'vscode';
import { info, warn, error as logError } from './logger';

interface AiResponse {
  title: string;
  body: string;
  commitMsg: string;
  branchName: string;
}

function getConfig() {
  const config = vscode.workspace.getConfiguration('quick-pr');
  return {
    enabled: config.get<boolean>('ai.enabled', false),
    apiKey: config.get<string>('ai.apiKey', ''),
    baseUrl: config.get<string>('ai.baseUrl', ''),
    model: config.get<string>('ai.model', 'gpt-4o-mini'),
    promptTemplate: config.get<string>('ai.promptTemplate', ''),
  };
}

function buildUserPrompt(
  commitMsg: string,
  branchName: string,
  prTitle: string,
  prBody: string,
  filesDiff: string,
  prTitleRule: string,
  prBodyRule: string,
  commitMessageRule: string,
  branchNameRule: string,
  recentCommits: string[],
): string {
  const parts: string[] = [
    'Generate a pull request title, description, commit message, and branch name for the following changes:',
    '',
    'Existing field values (only fill fields that are empty or need improvement; reuse existing values if they are already good):',
    `- Commit message: "${commitMsg || '(empty)'}"`,
    `- Branch name: "${branchName || '(empty)'}"`,
    `- PR title: "${prTitle || '(empty)'}"`,
    `- PR body: "${prBody || '(empty)'}"`,
  ];

  if (recentCommits.length > 0) {
    parts.push('');
    parts.push('Recent commit history (use as style reference for the commit message):');
    parts.push(recentCommits.map((c, i) => `${i + 1}. ${c}`).join('\n'));
  }

  if (commitMessageRule) {
    parts.push('');
    parts.push('Commit message rules:');
    parts.push(commitMessageRule);
  }

  if (branchNameRule) {
    parts.push('');
    parts.push('Branch name rules:');
    parts.push(branchNameRule);
  }

  if (prTitleRule) {
    parts.push('');
    parts.push('Title rules:');
    parts.push(prTitleRule);
  }
  if (prBodyRule) {
    parts.push('');
    parts.push('Body rules:');
    parts.push(prBodyRule);
  }
  if (filesDiff) {
    parts.push('');
    parts.push('Diff of selected changes:');
    parts.push(filesDiff);
  }
  parts.push('');
  parts.push('Respond ONLY with a JSON object: { "commitMsg": "...", "branchName": "...", "title": "...", "body": "..." }');
  return parts.join('\n');
}

export async function generatePrContent(
  commitMsg: string,
  branchName: string,
  prTitle: string,
  prBody: string,
  filesDiff: string,
  prTitleRule: string,
  prBodyRule: string,
  commitMessageRule: string = '',
  branchNameRule: string = '',
  recentCommits: string[] = [],
): Promise<AiResponse | null> {
  const { enabled, apiKey, baseUrl, model, promptTemplate } = getConfig();

  if (!enabled) {
    info('[aiService.generatePrContent]', 'AI generation disabled, skipping');
    return null;
  }
  if (!apiKey) {
    warn('[aiService.generatePrContent]', 'AI enabled but no API key configured', {
      baseUrl: baseUrl || 'default (api.openai.com)',
    });
    vscode.window.showWarningMessage(
      'AI generation is enabled but no API key is configured (quick-pr.ai.apiKey)',
    );
    return null;
  }

  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions';

  info('[aiService.generatePrContent]', 'Sending AI request', {
    commitMsgPreview: commitMsg.slice(0, 80),
    branchName,
    url,
    hasPromptTemplate: !!promptTemplate,
    hasTitleRule: !!prTitleRule,
    hasBodyRule: !!prBodyRule,
    hasCommitMessageRule: !!commitMessageRule,
    hasBranchNameRule: !!branchNameRule,
    recentCommitsCount: recentCommits.length,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: promptTemplate },
          {
            role: 'user',
            content: buildUserPrompt(commitMsg, branchName, prTitle, prBody, filesDiff, prTitleRule, prBodyRule, commitMessageRule, branchNameRule, recentCommits),
          },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logError('[aiService.generatePrContent]', 'AI API returned error', {
        status: response.status,
        statusText: response.statusText,
        url,
      });
      vscode.window.showErrorMessage(`AI API error (${response.status}): ${errText}`);
      return null;
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      logError('[aiService.generatePrContent]', 'AI response missing content', {
        responseSnippet: JSON.stringify(data).slice(0, 200),
      });
      vscode.window.showErrorMessage('AI response missing content');
      return null;
    }

    const parsed = JSON.parse(content) as AiResponse;
    info('[aiService.generatePrContent]', 'AI content generated successfully', {
      hasTitle: !!parsed.title,
      hasBody: !!parsed.body,
      hasCommitMsg: !!parsed.commitMsg,
      hasBranchName: !!parsed.branchName,
    });
    return {
      commitMsg: parsed.commitMsg || commitMsg,
      branchName: parsed.branchName || branchName,
      title: parsed.title || '',
      body: parsed.body || '',
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('[aiService.generatePrContent]', 'AI request failed', {
      commitMsgPreview: commitMsg.slice(0, 80),
      branchName,
      url,
    }, e);
    vscode.window.showErrorMessage(`AI request failed: ${msg}`);
    return null;
  }
}
