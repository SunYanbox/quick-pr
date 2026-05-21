import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { info, error as logError } from './logger';

export interface ProjectSettings {
  defaultBaseBranch: string;
  prTitleRulePath: string;
  prBodyRulePath: string;
  commitMessageRulePath: string;
  branchNameRulePath: string;
}

export interface ProjectConfigData {
  settings: ProjectSettings;
  prTitleRule: string;
  prBodyRule: string;
  commitMessageRule: string;
  branchNameRule: string;
}

const DEFAULT_SETTINGS: ProjectSettings = {
  defaultBaseBranch: 'main',
  prTitleRulePath: '.quick-pr-studio/PR title rule.md',
  prBodyRulePath: '.quick-pr-studio/PR body rule.md',
  commitMessageRulePath: '.quick-pr-studio/commit message rule.md',
  branchNameRulePath: '.quick-pr-studio/branch name rule.md',
};

export function initProjectConfig(workspaceRoot: string): void {
  const configDir = path.join(workspaceRoot, '.quick-pr-studio');

  // Create .quick-pr-studio directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    info('[projectConfig.initProjectConfig]', 'Created .quick-pr-studio directory', { configDir });
  }

  // Create settings.json with defaults if it doesn't exist
  const settingsPath = path.join(configDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
    info('[projectConfig.initProjectConfig]', 'Created default settings.json', { settingsPath });
  }

  // Create .gitignore inside .quick-pr-studio to exclude its contents from git tracking
  const gitignorePath = path.join(configDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '# Created by Quick PR Studio\n*\n', 'utf-8');
    info('[projectConfig.initProjectConfig]', 'Created .gitignore for .quick-pr-studio', { gitignorePath });
  }
}

export function loadProjectConfig(workspaceRoot: string): ProjectConfigData {
  const configDir = path.join(workspaceRoot, '.quick-pr-studio');
  const settingsPath = path.join(configDir, 'settings.json');

  info('[projectConfig.loadProjectConfig]', 'Loading project config', { workspaceRoot, settingsPath });

  let settings: ProjectSettings = { ...DEFAULT_SETTINGS };

  if (fs.existsSync(settingsPath)) {
    let raw = '';
    try {
      raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      settings = { ...DEFAULT_SETTINGS, ...parsed };
      info('[projectConfig.loadProjectConfig]', 'Settings loaded', { defaultBaseBranch: settings.defaultBaseBranch });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logError('[projectConfig.loadProjectConfig]', 'Failed to parse settings.json', {
        settingsPath,
        fileExists: fs.existsSync(settingsPath),
        contentPreview: raw ? raw.slice(0, 200) : '(empty)',
      }, e);
      vscode.window.showWarningMessage(`Failed to parse .quick-pr-studio/settings.json: ${msg}. Using defaults.`);
    }
  } else {
    info('[projectConfig.loadProjectConfig]', 'No settings.json found, using defaults', { configDir });
  }

  const readOptionalFile = (filePath: string): string => {
    const resolvedPath = path.resolve(workspaceRoot, filePath);
    if (fs.existsSync(resolvedPath)) {
      info('[projectConfig.loadProjectConfig]', 'Reading rule file', { path: resolvedPath });
      return fs.readFileSync(resolvedPath, 'utf-8');
    }
    const altPath = path.join(configDir, path.basename(filePath));
    if (fs.existsSync(altPath)) {
      info('[projectConfig.loadProjectConfig]', 'Reading rule file from alt path', { path: altPath });
      return fs.readFileSync(altPath, 'utf-8');
    }
    info('[projectConfig.loadProjectConfig]', 'Rule file not found', { primary: resolvedPath, alt: altPath });
    return '';
  };

  const prTitleRule = readOptionalFile(settings.prTitleRulePath);
  const prBodyRule = readOptionalFile(settings.prBodyRulePath);
  const commitMessageRule = readOptionalFile(settings.commitMessageRulePath);
  const branchNameRule = readOptionalFile(settings.branchNameRulePath);

  info('[projectConfig.loadProjectConfig]', 'Config loaded', {
    hasTitleRule: !!prTitleRule,
    hasBodyRule: !!prBodyRule,
    hasCommitMessageRule: !!commitMessageRule,
    hasBranchNameRule: !!branchNameRule,
    titleRuleLength: prTitleRule.length,
    bodyRuleLength: prBodyRule.length,
  });

  return {
    settings,
    prTitleRule,
    prBodyRule,
    commitMessageRule,
    branchNameRule,
  };
}
