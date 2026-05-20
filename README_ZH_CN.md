# Quick PR — 快速创建 GitHub Pull Request

一款 VS Code 扩展，基于 **worktree（临时工作目录）** 工作流，帮助你在编辑器内快速创建 GitHub Pull Request，无需切换到终端。

## 工作流程

1. **选择变更文件** — 勾选要包含的已修改或已暂存文件
2. **填写 PR 信息** — 提交信息、分支名、PR 标题/内容、目标分支
3. **一键创建** — 扩展自动完成：
   - 从当前分支创建临时 git worktree
   - 将选中的文件复制到 worktree
   - 提交并推送到新分支
   - 通过 GitHub CLI (`gh pr create`) 创建 PR
   - 清理临时 worktree
   - 在浏览器中打开 PR 链接

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

1. 在仓库中修改代码，并在 VS Code 源码管理中暂存文件
2. 从命令面板 (`Ctrl+Shift+P`) 执行 **"Quick PR: Create Pull Request"**
3. 选择要包含的文件
4. 填写表单，点击 **Create PR**

## 功能特性

- **Worktree 隔离**：所有操作在临时 worktree 中进行，不影响你的工作目录
- **文件级选择**：精确控制每次 PR 包含的变更
- **AI 辅助生成**（可选）：基于 OpenAI 兼容 API 自动生成 PR 标题和内容
- **SSH 回退**：HTTPS 推送失败时自动尝试 SSH 方式
- **自定义规则**：通过 `.quick-pr/` 目录配置项目级 PR 标题/内容模板

## 配置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `quick-pr.ai.enabled` | `false` | 启用 AI 生成 PR 标题和内容 |
| `quick-pr.ai.apiKey` | `""` | OpenAI 兼容 API 的密钥 |
| `quick-pr.ai.baseUrl` | `""` | OpenAI 兼容 API 的地址 |
| `quick-pr.ai.promptTemplate` | (内置) | AI 生成的系统提示词 |
| `quick-pr.cleanupWorktreeAfterPr` | `true` | 创建 PR 后自动删除 worktree |

### 项目级配置

在项目根目录放置 `.quick-pr/settings.json`：

```json
{
  "defaultBaseBranch": "main"
}
```

可选规则文件：
- `.quick-pr/PR title rule.md` — 自定义标题格式规则
- `.quick-pr/PR body rule.md` — 自定义内容模板规则

## 开发指南

这是一个 VS Code 扩展。要从源码启动：

```bash
# 1. 安装依赖
npm install

# 2. 在 VS Code 中打开项目
code .

# 3. 按 F5 启动「扩展开发主机」实例
```

扩展通过命令 `quick-pr.createPr` 激活。

### 构建

```bash
npm run build
```

### 项目结构

```
src/
├── extension.ts      # 扩展入口与命令注册
├── inputService.ts   # 基于 Webview 的 PR 表单界面
├── gitService.ts     # Git 操作（worktree、提交、推送）
├── prService.ts      # GitHub CLI 交互（gh pr create）
├── projectConfig.ts  # 项目级配置加载
├── aiService.ts      # AI 生成 PR 内容
└── logger.ts         # 基于文件的日志记录
```

## 许可证

[MIT](LICENSE)
