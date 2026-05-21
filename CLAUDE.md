# Quick PR Studio

VS Code extension for creating GitHub PRs using git worktree workflow.

## Source Files

- `src/extension.ts` — Registers all VS Code commands and orchestrates PR creation, step-by-step, add-commit, finalize, retry, cleanup workflows
- `src/gitService.ts` — Git operations: repo status, changed files, worktree CRUD, commit, push with fallbacks, blob-hash diff filtering, branch diff
- `src/inputService.ts` — Webview panels for one-shot PR creation and step-by-step flow (start worktree, add commit, finalize PR)
- `src/logger.ts` — File-based logger (INFO/WARN/ERROR/DEBUG) to `.quick-pr-studio/log.log`
- `src/prService.ts` — GitHub CLI integration: check gh availability, create PR via `gh pr create`
- `src/projectConfig.ts` — Load/save project settings from `.quick-pr-studio/settings.json`
- `src/aiService.ts` — AI-powered generation for branch names, commit messages, PR titles/descriptions
- `src/worktreeManager.ts` — Worktree metadata CRUD in `.quick-pr-studio/worktrees.json`
- `src/worktreeTreeView.ts` — VS Code TreeDataProvider: sidebar with one-shot, step-by-step actions and collapsible per-worktree action buttons
- `src/worktreeWebview.ts` — Webview panel for worktree detail: info display, filtered changed files, commit/finalize/delete actions

## Conventions

- package.json MUST NOT include `activationEvents`. VS Code 1.74+ auto-generates activation events from `contributes` declarations (commands → `onCommand`, views → `onView`). Including `activationEvents` is redundant and risks misconfiguration.
- All `id` values in `viewsContainers` and `views` MUST use only `[a-zA-Z0-9_-]` (alphanumeric, underscore, hyphen). Dots are not allowed in these `id` fields. Use hyphens for namespace separation (e.g., `quick-pr-studio-worktrees`).
- Command identifiers (the `command` field in `contributes.commands`) use dots for namespace separation (e.g., `quick-pr-studio.createPr`).
- Build with `npm run build` (esbuild). Output goes to `dist/extension.js`.
- VS Code engine requirement: `^1.85.0`.
