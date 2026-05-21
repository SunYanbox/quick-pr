import * as vscode from 'vscode';
import { info, warn, error as logError } from './logger';

interface AiResponse {
  title: string;
  body: string;
  commitMsg: string;
  branchName: string;
}

interface PrDescriptionResponse {
  title: string;
  body: string;
}

function getConfig() {
  const config = vscode.workspace.getConfiguration('quick-pr-studio');
  return {
    enabled: config.get<boolean>('ai.enabled', false),
    apiKey: config.get<string>('ai.apiKey', ''),
    baseUrl: config.get<string>('ai.baseUrl', ''),
    model: config.get<string>('ai.model', 'gpt-4o-mini'),
    promptTemplate: config.get<string>('ai.promptTemplate', ''),
  };
}

async function callAiApi(userPrompt: string): Promise<Record<string, string> | null> {
  const { enabled, apiKey, baseUrl, model, promptTemplate } = getConfig();

  if (!enabled) {
    info('[aiService]', 'AI generation disabled, skipping');
    return null;
  }
  if (!apiKey) {
    warn('[aiService]', 'AI enabled but no API key configured');
    vscode.window.showWarningMessage(
      'AI generation is enabled but no API key is configured (quick-pr-studio.ai.apiKey)',
    );
    return null;
  }

  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions';

  info('[aiService]', `\n---------- FULL PROMPT SENT TO AI ----------\nSystem:\n${promptTemplate || '(empty)'}\n\nUser:\n${userPrompt}\n--------------------------------------------`);

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
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logError('[aiService]', 'AI API returned error', {
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
      logError('[aiService]', 'AI response missing content', {
        responseSnippet: JSON.stringify(data).slice(0, 200),
      });
      vscode.window.showErrorMessage('AI response missing content');
      return null;
    }

    info('[aiService]', `\n---------- AI RAW RESPONSE ----------\n${content}\n-------------------------------------`);
    return JSON.parse(content) as Record<string, string>;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('[aiService]', 'AI request failed', { url }, e);
    vscode.window.showErrorMessage(`AI request failed: ${msg}`);
    return null;
  }
}

export async function generateBranchName(
  branchDescription: string,
  branchNameRule: string = '',
  recentCommits: string[] = [],
): Promise<string | null> {
  if (!branchDescription.trim()) {
    return null;
  }

  const parts: string[] = [
    'Generate a short, descriptive Git branch name from the user\'s description.',
    'The branch name should use kebab-case, be concise (3-5 words max), and follow conventional branch naming.',
    'ONLY use the user\'s description as source — do not fabricate or add unrelated details.',
    '',
    `User description: "${branchDescription}"`,
  ];

  if (branchNameRule) {
    parts.push('');
    parts.push('===== BRANCH NAME RULES =====');
    parts.push(branchNameRule);
  }

  if (recentCommits.length > 0) {
    parts.push('');
    parts.push('===== RECENT COMMIT SUBJECTS (style reference only) =====');
    parts.push(recentCommits.map((c, i) => `${i + 1}. ${c}`).join('\n'));
  }

  parts.push('');
  parts.push('Respond ONLY with a JSON object: { "branchName": "..." }');

  const result = await callAiApi(parts.join('\n'));
  if (!result?.branchName) return null;

  const sanitized = result.branchName.replace(/[\s\/]+/g, '-').toLowerCase();
  info('[aiService.generateBranchName]', 'Branch name generated', { branchName: sanitized });
  return sanitized;
}

export async function generateCommitMessage(
  commitMsg: string,
  filesDiff: string,
  commitMessageRule: string = '',
  recentCommits: string[] = [],
): Promise<string | null> {
  const parts: string[] = [
    'Generate a conventional-commit style commit message for the given diff.',
    'RULE: The DIFF is your ONLY source of content — describe what it actually changes, nothing else.',
    'Return ONLY the commit subject line (first line, < 72 chars).',
    'Use format: type(scope): description (e.g. "feat(auth): add login page").',
    '',
  ];

  if (filesDiff) {
    parts.push('===== DIFF =====');
    parts.push(filesDiff);
    parts.push('');
  } else {
    parts.push('(No diff provided — use the user draft if available)');
    parts.push('');
  }

  if (commitMsg) {
    parts.push(`User draft (use as reference): "${commitMsg}"`);
    parts.push('');
  }

  if (commitMessageRule) {
    parts.push('===== COMMIT MESSAGE RULES =====');
    parts.push(commitMessageRule);
    parts.push('');
  }

  if (recentCommits.length > 0) {
    parts.push('===== RECENT COMMIT SUBJECTS (style reference only) =====');
    parts.push(recentCommits.map((c, i) => `${i + 1}. ${c}`).join('\n'));
    parts.push('');
  }

  parts.push('Respond ONLY with a JSON object: { "commitMsg": "..." }');

  const result = await callAiApi(parts.join('\n'));
  if (!result?.commitMsg) return null;

  info('[aiService.generateCommitMessage]', 'Commit message generated');
  return result.commitMsg;
}

export async function generatePrDescription(
  prTitle: string,
  prBody: string,
  branchName: string,
  filesDiff: string,
  prTitleRule: string = '',
  prBodyRule: string = '',
  recentCommits: string[] = [],
): Promise<PrDescriptionResponse | null> {
  const parts: string[] = [
    'Generate a pull request title and body describing the cumulative changes in the diff below.',
    'RULE: The DIFF is your ONLY source of content — describe what it actually shows, nothing else.',
    '',
  ];

  if (filesDiff) {
    parts.push('===== DIFF (entire branch changes) =====');
    parts.push(filesDiff);
    parts.push('');
  }

  parts.push('===== CONTEXT =====');
  parts.push(`Branch name: ${branchName}`);
  if (prTitle) parts.push(`User draft title: "${prTitle}"`);
  if (prBody) parts.push(`User draft body: "${prBody}"`);
  parts.push('');

  if (prTitleRule) {
    parts.push('===== TITLE RULES =====');
    parts.push(prTitleRule);
    parts.push('');
  }
  if (prBodyRule) {
    parts.push('===== BODY RULES =====');
    parts.push(prBodyRule);
    parts.push('');
  }

  if (recentCommits.length > 0) {
    parts.push('===== RECENT COMMIT SUBJECTS (style reference only) =====');
    parts.push(recentCommits.map((c, i) => `${i + 1}. ${c}`).join('\n'));
    parts.push('');
  }

  parts.push('Respond ONLY with a JSON object: { "title": "...", "body": "..." }');

  const result = await callAiApi(parts.join('\n'));
  if (!result) return null;

  info('[aiService.generatePrDescription]', 'PR description generated');
  return {
    title: result.title || prTitle,
    body: result.body || prBody,
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
    'You are generating a pull request. Your task is to describe what the DIFF below changed.',
    'RULE: The DIFF is your ONLY source of content — describe what it actually shows, nothing else.',
    '',
  ];

  if (filesDiff) {
    parts.push('===== DIFF (read this, describe what it changes) =====');
    parts.push(filesDiff);
    parts.push('');
  }

  parts.push('===== EXISTING FIELD VALUES =====');
  parts.push('These are the user\'s current inputs. Only fill EMPTY fields.');
  parts.push('IMPORTANT: Treat these as BLANK SLATE format holders. Ignore their content — they may contain examples from unrelated work.');
  parts.push(`- Commit message: "${commitMsg || '(empty)'}"`);
  parts.push(`- Branch name: "${branchName || '(empty)'}"`);
  parts.push(`- PR title: "${prTitle || '(empty)'}"`);
  parts.push(`- PR body: "${prBody || '(empty)'}"`);

  if (recentCommits.length > 0) {
    parts.push('');
    parts.push('===== RECENT COMMIT SUBJECTS (conventional-commit style reference — IGNORE their content, only note the format pattern) =====');
    parts.push(recentCommits.map((c, i) => `${i + 1}. ${c}`).join('\n'));
  }

  if (commitMessageRule) {
    parts.push('');
    parts.push('===== COMMIT MESSAGE RULES =====');
    parts.push(commitMessageRule);
  }

  if (branchNameRule) {
    parts.push('');
    parts.push('===== BRANCH NAME RULES =====');
    parts.push(branchNameRule);
  }

  if (prTitleRule) {
    parts.push('');
    parts.push('===== TITLE RULES =====');
    parts.push(prTitleRule);
  }
  if (prBodyRule) {
    parts.push('');
    parts.push('===== BODY RULES =====');
    parts.push(prBodyRule);
  }
  parts.push('');
  parts.push('Respond ONLY with a JSON object: { "commitMsg": "...", "branchName": "...", "title": "...", "body": "..." }');
  parts.push('FINAL REMINDER: Everything above EXCEPT the DIFF is format/rule reference. The DIFF alone determines what content to write. If the diff is empty or trivial, generate nothing — do not fabricate changes from other sections.');
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
      'AI generation is enabled but no API key is configured (quick-pr-studio.ai.apiKey)',
    );
    return null;
  }

  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions';

  const userPrompt = buildUserPrompt(commitMsg, branchName, prTitle, prBody, filesDiff, prTitleRule, prBodyRule, commitMessageRule, branchNameRule, recentCommits);

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

  info('[aiService.generatePrContent]', `\n---------- FULL PROMPT SENT TO AI ----------\nSystem:\n${promptTemplate || '(empty)'}\n\nUser:\n${userPrompt}\n--------------------------------------------`);

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
            content: userPrompt,
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

    info('[aiService.generatePrContent]', `\n---------- AI RAW RESPONSE ----------\n${content}\n-------------------------------------`);

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
