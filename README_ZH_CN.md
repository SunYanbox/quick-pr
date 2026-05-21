# Quick PR Studio — 快速创建 GitHub Pull Request

一款 VS Code 扩展，基于 **worktree（临时工作目录）** 工作流，帮助你在编辑器内快速创建 GitHub Pull Request，无需切换到终端。

安装后，VS Code 活动栏会出现 **Quick PR Studio** 图标 ($(git-pull-request))，所有命令和 worktree 管理均可从侧边栏直接使用。

## 工作流程

两种工作模式可选：

**一键模式**（默认）：
1. **选择变更文件** — 勾选要包含的已修改或已暂存文件
2. **填写 PR 信息** — 提交信息、分支名、PR 标题/内容、目标分支
3. **一键创建** — 扩展自动完成：
   - 从当前分支创建临时 git worktree
   - 将选中的文件复制到 worktree
   - 提交并推送到新分支
   - 通过 GitHub CLI (`gh pr create`) 创建 PR
   - 清理临时 worktree
   - 在浏览器中打开 PR 链接

**分步模式** — 适用于需要多次提交的 PR：
1. **开始** — 命名分支和目标分支
2. **添加提交** — 选择文件、编写提交信息，可重复多次
3. **完成** — 编写 PR 标题/内容，推送到远程并创建 PR

## 环境要求

| 工具 | 必须 | 说明 |
|------|------|------|
| [Node.js](https://nodejs.org/) | 是 | 用于从源码构建 |
| [Git](https://git-scm.com/) | 是 | 需要已认证，能推送远程仓库 |
| [GitHub CLI (`gh`)](https://cli.github.com/) | 是 | 需要已认证 (`gh auth login`) |

### 认证配置

- **gh CLI**：执行 `gh auth login`，或设置 `GH_TOKEN` / `GITHUB_TOKEN` 环境变量
- **Git**：确保能通过 HTTPS 或 SSH 推送到远程仓库

## 使用方法

### 一键模式

1. 在仓库中修改代码，并在 VS Code 源码管理中暂存文件
2. 点击 **Quick PR Studio** 侧边栏图标，选择 **"Create Pull Request"**，或从命令面板 (`Ctrl+Shift+P`) 执行
3. 选择要包含的文件，双击文件行可查看侧边对比 diff
4. 填写表单，点击 **Create PR**

### 分步模式

1. 点击侧边栏中的 **"Start Step-by-Step PR"**，或从命令面板执行该命令
2. 输入分支名和目标分支，创建 worktree
3. 使用 **"Add Commit"** 选择文件、编写提交信息 — 可重复多次
4. 点击 **"Finalize"** 编写 PR 标题/内容，推送到远程并创建 PR
5. 在侧边栏中查看和管理所有 worktree

## 功能特性

- **Worktree 隔离**：所有操作在临时 worktree 中进行，不影响你的工作目录
- **两种工作模式**：一键模式快速创建 PR，分步模式支持多次提交并通过侧边栏管理
- **文件级选择**：精确控制每次 PR 包含的变更
- **侧边对比 diff 视图**：双击文件行即可预览变更内容
- **AI 辅助生成**（可选）：基于 OpenAI 兼容 API 自动生成 PR 标题、内容、提交信息和分支名 — 仅填充空字段，保留用户已有输入
- **SSH 回退**：HTTPS 推送失败时自动尝试 SSH 方式
- **Worktree 侧边栏**：在活动栏中查看和管理所有活跃 worktree
- **自定义规则**：通过 `.quick-pr-studio/` 目录配置项目级 PR 标题/内容/提交信息/分支名模板
- **配置自动初始化**：首次激活时自动创建 `.quick-pr-studio/` 目录及默认配置
- **完整调试日志**：AI 完整提示词和原始回复均记录到 `.quick-pr-studio/log.log`，方便排查问题
- **加载状态提示**：点击按钮后自动禁用并显示进度文字，同时 VS Code 通知区域实时显示当前操作步骤

## 配置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `quick-pr-studio.ai.enabled` | `false` | 启用 AI 生成 PR 标题和内容 |
| `quick-pr-studio.ai.apiKey` | `""` | OpenAI 兼容 API 的密钥 |
| `quick-pr-studio.ai.baseUrl` | `""` | OpenAI 兼容 API 的地址 |
| `quick-pr-studio.ai.model` | `gpt-4o-mini` | OpenAI 兼容 API 的模型名称 |
| `quick-pr-studio.ai.promptTemplate` | (内置) | AI 生成的系统提示词 |
| `quick-pr-studio.cleanupWorktreeAfterPr` | `true` | 一键模式 PR 完成后自动删除 worktree |
| `quick-pr-studio.workflowMode` | `"one-shot"` | 工作流模式：`one-shot` 或 `step-by-step` |
| `quick-pr-studio.autoCleanupWorktree` | `false` | 分步模式 PR 成功后自动删除 worktree |

### 项目级配置

在项目根目录放置 `.quick-pr-studio/settings.json`：

```json
{
  "defaultBaseBranch": "main"
}
```

可选规则文件：
- `.quick-pr-studio/PR title rule.md` — 自定义标题格式规则
- `.quick-pr-studio/PR body rule.md` — 自定义内容模板规则
- `.quick-pr-studio/commit message rule.md` — 自定义提交信息格式规则
- `.quick-pr-studio/branch name rule.md` — 自定义分支命名规则

## 开发指南

这是一个 VS Code 扩展。要从源码启动：

```bash
# 1. 安装依赖
npm install

# 2. 在 VS Code 中打开项目
code .

# 3. 按 F5 启动「扩展开发主机」实例
```

扩展通过多个命令激活（如 `quick-pr-studio.createPr`、`quick-pr-studio.startStepByStep` 等）。

### 构建

```bash
npm run build
```

### 项目结构

```
src/
├── extension.ts           # 扩展入口与命令注册
├── inputService.ts        # Webview 表单（一键 + 分步）
├── gitService.ts          # Git 操作（worktree、提交、推送、diff、日志）
├── prService.ts           # GitHub CLI 交互（gh pr create）
├── projectConfig.ts       # 项目级配置加载
├── aiService.ts           # AI 生成 PR 内容
├── worktreeManager.ts     # Worktree 元数据注册表
├── worktreeTreeView.ts    # 侧边栏 TreeDataProvider
├── worktreeWebview.ts     # Worktree 详情面板
└── logger.ts              # 基于文件的日志记录
```

## 许可证

[MIT](LICENSE)
