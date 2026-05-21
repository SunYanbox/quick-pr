# Quick PR Studio

VS Code extension for creating GitHub PRs using git worktree workflow.

## Conventions

- package.json MUST NOT include `activationEvents`. VS Code 1.74+ auto-generates activation events from `contributes` declarations (commands → `onCommand`, views → `onView`). Including `activationEvents` is redundant and risks misconfiguration.
- All `id` values in `viewsContainers` and `views` MUST use only `[a-zA-Z0-9_-]` (alphanumeric, underscore, hyphen). Dots are not allowed in these `id` fields. Use hyphens for namespace separation (e.g., `quick-pr-studio-worktrees`).
- Command identifiers (the `command` field in `contributes.commands`) use dots for namespace separation (e.g., `quick-pr-studio.createPr`).
- Build with `npm run build` (esbuild). Output goes to `dist/extension.js`.
- VS Code engine requirement: `^1.85.0`.
