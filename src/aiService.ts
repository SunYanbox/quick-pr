import * as vscode from 'vscode';

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

  if (!enabled) return null;
  if (!apiKey) {
    vscode.window.showWarningMessage(
      'AI generation is enabled but no API key is configured (quick-pr.ai.apiKey)',
    );
    return null;
  }

  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
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
      vscode.window.showErrorMessage(`AI API error (${response.status}): ${errText}`);
      return null;
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      vscode.window.showErrorMessage('AI response missing content');
      return null;
    }

    const parsed = JSON.parse(content) as AiResponse;
    return { title: parsed.title || '', body: parsed.body || '' };
  } catch (e: any) {
    vscode.window.showErrorMessage(`AI request failed: ${e.message}`);
    return null;
  }
}
