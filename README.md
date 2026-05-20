# Quick PR

A VS Code extension that streamlines creating GitHub Pull Requests using a **worktree-based workflow** — no more context switching between your editor and terminal.

## How It Works

1. **Select changed files** — pick which modified/staged files to include
2. **Fill in PR details** — commit message, branch name, PR title/body, target branch
3. **One click** — the extension automatically:
   - Creates a temporary git worktree from your current branch
   - Copies selected files to the worktree
   - Commits and pushes to a new branch
   - Creates a PR via GitHub CLI (`gh pr create`)
   - Cleans up the temporary worktree
   - Opens the PR URL in your browser

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

1. Make changes in your repository and stage them in VS Code's Source Control panel
2. Run command **"Quick PR: Create Pull Request"** from the Command Palette (`Ctrl+Shift+P`)
3. Select the files you want to include
4. Fill in the form and click **Create PR**

## Features

- **Worktree isolation**: Your working directory stays untouched — all operations happen in a temporary worktree
- **File-level selection**: Include only the changes you want in each PR
- **AI-powered generation** (optional): Auto-generate PR title, body, commit message, and branch name using OpenAI-compatible APIs — only fills empty fields, preserving your existing input
- **SSH fallback**: Automatically retries push via SSH if HTTPS connection fails
- **Customizable rules**: Project-level PR title/body/commit message/branch name templates via `.quick-pr/` directory
- **Auto-initialized config**: `.quick-pr/` directory with default settings is created automatically on first activation
- **Full debug logging**: Complete AI prompts and raw responses are logged to `.quick-pr/log.log` for troubleshooting

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `quick-pr.ai.enabled` | `false` | Enable AI generation for PR title and body |
| `quick-pr.ai.apiKey` | `""` | API key for OpenAI-compatible API |
| `quick-pr.ai.baseUrl` | `""` | Base URL for OpenAI-compatible API |
| `quick-pr.ai.model` | `gpt-4o-mini` | Model name for OpenAI-compatible API |
| `quick-pr.ai.promptTemplate` | *(built-in)* | System prompt for AI generation |
| `quick-pr.cleanupWorktreeAfterPr` | `true` | Delete worktree automatically after PR creation |

### Project-level Configuration

Place `.quick-pr/settings.json` in your project root:

```json
{
  "defaultBaseBranch": "main"
}
```

Optional rule files:
- `.quick-pr/PR title rule.md` — Custom title format rules
- `.quick-pr/PR body rule.md` — Custom body template rules
- `.quick-pr/commit message rule.md` — Custom commit message format rules
- `.quick-pr/branch name rule.md` — Custom branch naming rules

## Development

This is a VS Code extension. To run from source:

```bash
# 1. Install dependencies
npm install

# 2. Open the project in VS Code
code .

# 3. Press F5 to launch the Extension Development Host
```

The extension activates on the command `quick-pr.createPr`.

### Build

```bash
npm run build
```

### Project Structure

```
src/
├── extension.ts      # Extension entry point & command registration
├── inputService.ts   # Webview-based PR form UI
├── gitService.ts     # Git operations (worktree, commit, push, diff, log)
├── prService.ts      # GitHub CLI interaction (gh pr create)
├── projectConfig.ts  # Project-level configuration loader
├── aiService.ts      # AI-powered PR content generation (title, body, commit msg, branch name)
└── logger.ts         # File-based structured logging
```

## License

[MIT](LICENSE)
