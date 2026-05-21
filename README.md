# Quick PR Studio

A VS Code extension that streamlines creating GitHub Pull Requests using a **worktree-based workflow** — no more context switching between your editor and terminal.

Once installed, look for the **Quick PR Studio** icon ($(git-pull-request)) in the VS Code activity bar — all commands and worktree management are available from the sidebar.

## How It Works

Choose between two workflow modes:

**One-Shot Mode** (default):
1. **Select changed files** — pick which modified/staged files to include
2. **Fill in PR details** — commit message, branch name, PR title/body, target branch
3. **One click** — the extension automatically:
   - Creates a temporary git worktree from your current branch
   - Copies selected files to the worktree
   - Commits and pushes to a new branch
   - Creates a PR via GitHub CLI (`gh pr create`)
   - Cleans up the temporary worktree
   - Opens the PR URL in your browser

**Step-by-Step Mode** — for PRs that need multiple commits:
1. **Start** — name your branch and target
2. **Add commits** — select files, write commit messages, repeat as needed
3. **Finalize** — write PR title/body, push, and create the PR

## Prerequisites

| Tool | Required | Notes |
|------|----------|-------|
| [Node.js](https://nodejs.org/) | Yes | For building from source |
| [Git](https://git-scm.com/) | Yes | Must be authenticated with your remote |
| [GitHub CLI (`gh`)](https://cli.github.com/) | Yes | Must be authenticated (`gh auth login`) |

### Authentication

- **gh CLI**: Run `gh auth login` or set `GH_TOKEN` / `GITHUB_TOKEN` environment variable.
- **Git**: Ensure your remote can be pushed to (HTTPS or SSH).

## Usage

### One-Shot Mode

1. Make changes in your repository and stage them in VS Code's Source Control panel
2. Click the **Quick PR Studio** sidebar icon, then click **"Create Pull Request"**, or run the command from the Command Palette (`Ctrl+Shift+P`)
3. Select the files you want to include, view side-by-side diffs by double-clicking file rows
4. Fill in the form and click **Create PR**

### Step-by-Step Mode

1. Click **"Start Step-by-Step PR"** in the sidebar (activity bar), or run the command from the palette
2. Enter a branch name and target branch to create a worktree
3. Use **"Add Commit"** to select files, write commit messages — repeat as needed
4. Click **"Finalize"** to write PR title/body, push, and create the PR
5. Monitor and manage all worktrees from the sidebar

## Features

- **Worktree isolation**: Your working directory stays untouched — all operations happen in a temporary worktree
- **Two workflow modes**: One-shot for quick PRs, step-by-step for multi-commit PRs with sidebar management
- **File-level selection**: Include only the changes you want in each PR
- **Side-by-side diff view**: Double-click any file to preview changes before including them
- **AI-powered generation** (optional): Auto-generate PR title, body, commit message, and branch name using OpenAI-compatible APIs — only fills empty fields, preserving your existing input
- **SSH fallback**: Automatically retries push via SSH if HTTPS connection fails
- **Worktree sidebar**: View and manage all active worktrees from the activity bar
- **Customizable rules**: Project-level PR title/body/commit message/branch name templates via `.quick-pr-studio/` directory
- **Auto-initialized config**: `.quick-pr-studio/` directory with default settings is created automatically on first activation
- **Full debug logging**: Complete AI prompts and raw responses are logged to `.quick-pr-studio/log.log` for troubleshooting
- **Loading indicators**: Buttons disable automatically on click and show progress text; VS Code notifications display real-time progress for each step

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `quick-pr-studio.ai.enabled` | `false` | Enable AI generation for PR title and body |
| `quick-pr-studio.ai.apiKey` | `""` | API key for OpenAI-compatible API |
| `quick-pr-studio.ai.baseUrl` | `""` | Base URL for OpenAI-compatible API |
| `quick-pr-studio.ai.model` | `gpt-4o-mini` | Model name for OpenAI-compatible API |
| `quick-pr-studio.ai.promptTemplate` | *(built-in)* | System prompt for AI generation |
| `quick-pr-studio.cleanupWorktreeAfterPr` | `true` | Delete worktree automatically after PR creation (one-shot) |
| `quick-pr-studio.workflowMode` | `"one-shot"` | PR workflow mode: `one-shot` or `step-by-step` |
| `quick-pr-studio.autoCleanupWorktree` | `false` | Auto-delete worktree after successful PR (step-by-step) |

### Project-level Configuration

Place `.quick-pr-studio/settings.json` in your project root:

```json
{
  "defaultBaseBranch": "main"
}
```

Optional rule files:
- `.quick-pr-studio/PR title rule.md` — Custom title format rules
- `.quick-pr-studio/PR body rule.md` — Custom body template rules
- `.quick-pr-studio/commit message rule.md` — Custom commit message format rules
- `.quick-pr-studio/branch name rule.md` — Custom branch naming rules

## Development

This is a VS Code extension. To run from source:

```bash
# 1. Install dependencies
npm install

# 2. Open the project in VS Code
code .

# 3. Press F5 to launch the Extension Development Host
```

The extension activates on the command `quick-pr-studio.createPr`.

### Build

```bash
npm run build
```

### Project Structure

```
src/
├── extension.ts           # Extension entry point & command registration
├── inputService.ts        # Webview-based PR forms (one-shot + step-by-step)
├── gitService.ts          # Git operations (worktree, commit, push, diff, log)
├── prService.ts           # GitHub CLI interaction (gh pr create)
├── projectConfig.ts       # Project-level configuration loader
├── aiService.ts           # AI-powered PR content generation
├── worktreeManager.ts     # Worktree metadata registry (worktrees.json)
├── worktreeTreeView.ts    # Sidebar TreeDataProvider with actions
├── worktreeWebview.ts     # Worktree detail & operations webview panel
└── logger.ts              # File-based structured logging
```

## License

[MIT](LICENSE)
