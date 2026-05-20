import * as vscode from 'vscode';
import { info, warn, error as logError } from './logger';

interface AiResponse {
  title: string;
  body: string;
}

function getConfig() {
  const config = vscode.workspace.getConfiguration('quick-pr');
  return {
    enabled: config.get<boolean>('ai.enabled', false),
    apiKey: config.get<string>('ai.apiKey', ''),
    baseUrl: config.get<string>('ai.baseUrl', ''),
    promptTemplate: config.get<string>('ai.promptTemplate', ''),
  };
}

function buildUserPrompt(
  commitMsg: string,
  branchName: string,
  prTitleRule: string,
  prBodyRule: string,
): string {
  const parts: string[] = [
    'Generate a pull request title and description for the following changes:',
    '',
    `Commit message: ${commitMsg}`,
    `Branch name: ${branchName}`,
  ];
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
  parts.push('');
  parts.push('Respond ONLY with a JSON object: { "title": "...", "body": "..." }');
  return parts.join('\n');
}

export async function generatePrContent(
  commitMsg: string,
  branchName: string,
  prTitleRule: string,
  prBodyRule: string,
): Promise<AiResponse | null> {
  const { enabled, apiKey, baseUrl, promptTemplate } = getConfig();

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
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.slice(0, 8)}...`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: promptTemplate },
          {
            role: 'user',
            content: buildUserPrompt(commitMsg, branchName, prTitleRule, prBodyRule),
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
    });
    return { title: parsed.title || '', body: parsed.body || '' };
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
