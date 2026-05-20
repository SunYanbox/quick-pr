import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectSettings {
  defaultBaseBranch: string;
  prTitleRulePath: string;
  prBodyRulePath: string;
}

export interface ProjectConfigData {
  settings: ProjectSettings;
  prTitleRule: string;
  prBodyRule: string;
}

const DEFAULT_SETTINGS: ProjectSettings = {
  defaultBaseBranch: 'main',
  prTitleRulePath: '.quick-pr/PR title rule.md',
  prBodyRulePath: '.quick-pr/PR body rule.md',
};

export function loadProjectConfig(workspaceRoot: string): ProjectConfigData {
  const configDir = path.join(workspaceRoot, '.quick-pr');
  const settingsPath = path.join(configDir, 'settings.json');

  let settings: ProjectSettings = { ...DEFAULT_SETTINGS };

  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      settings = { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
      vscode.window.showWarningMessage(`Failed to parse .quick-pr/settings.json: ${e}`);
    }
  }

  const readOptionalFile = (filePath: string): string => {
    const resolvedPath = path.resolve(workspaceRoot, filePath);
    if (fs.existsSync(resolvedPath)) {
      return fs.readFileSync(resolvedPath, 'utf-8');
    }
    const altPath = path.join(configDir, path.basename(filePath));
    if (fs.existsSync(altPath)) {
      return fs.readFileSync(altPath, 'utf-8');
    }
    return '';
  };

  return {
    settings,
    prTitleRule: readOptionalFile(settings.prTitleRulePath),
    prBodyRule: readOptionalFile(settings.prBodyRulePath),
  };
}
