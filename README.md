# figma-export

Figma 设计稿批量导出工具，支持按文件、项目、团队三个维度批量导出设计稿为图片。

## Features

- 🎯 **多层级导出** - 支持按文件 / 项目 / 团队三个维度导出
- 🔄 **断点续传** - 已下载的 Frame 自动跳过，支持中断后继续
- 📐 **灵活缩放** - 支持 0.01-4 倍缩放比例
- 🔁 **自动降级** - 渲染超时时自动降低 scale 重试
- 📄 **页面过滤** - 可指定只导出特定页面
- ⚡ **智能并发** - 限制下载并发数，防止带宽争抢
- 🛡️ **速率限制处理** - 自动处理 Figma API 429 限速
- 🔧 **错误重试** - 自动重试 5xx 服务器错误

## Installation

```bash
npm install -g figma-export
```

## Usage

### 配置 Figma Token

获取 Token：前往 [Figma Settings](https://www.figma.com/developers/api#access-tokens) 创建个人访问令牌。

提供 Token 有三种方式（任选其一）：

**方式一：命令行参数（推荐一次性使用）**

```bash
figma-export --token <your_token> --file-key <file_key>
```

**方式二：环境变量（推荐长期使用）**

```bash
# macOS / Linux - 添加到 ~/.bashrc 或 ~/.zshrc
export FIGMA_TOKEN=your_figma_personal_access_token

# Windows PowerShell
$env:FIGMA_TOKEN="your_figma_personal_access_token"
```

**方式三：.env 文件（推荐项目级使用）**

在运行命令的目录下创建 `.env` 文件：

```
FIGMA_TOKEN=your_figma_personal_access_token
```

### 命令行用法

```bash
# 导出单个文件
figma-export --file-key <file_key>

# 导出整个项目
figma-export --project-id <project_id>

# 导出整个团队
figma-export --team-id <team_id>
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--token <token>` | Figma 个人访问令牌 | 环境变量 `FIGMA_TOKEN` |
| `--file-key <key>` | Figma 文件 Key | - |
| `--project-id <id>` | Figma 项目 ID | - |
| `--team-id <id>` | Figma 团队 ID | - |
| `--scale <number>` | 导出缩放比例 (0.01-4) | `0.25` |
| `--output <path>` | 输出目录 | `./output` |
| `--page <name...>` | 只导出指定页面（可多次指定） | 全部页面 |
| `--shard <index/total>` | 分片参数，如 1/3 表示共3片取第1片 | - |

> 注意：`--file-key`、`--project-id`、`--team-id` 三者至少提供一个。

### 示例

```bash
# 导出单个文件，2倍缩放
figma-export --file-key abc123 --scale 2

# 导出项目到指定目录
figma-export --project-id 12345 --output ./designs

# 只导出指定页面
figma-export --file-key abc123 --page "首页" --page "详情页"

# 分片导出（适合大团队并行处理）
figma-export --team-id 67890 --shard 1/3
```

## 如何获取 File Key / Project ID / Team ID

- **File Key**: Figma 文件 URL 中 `figma.com/file/<file_key>/...` 的部分
- **Project ID**: 在 Figma 项目页面 URL 中 `figma.com/files/project/<project_id>/...`
- **Team ID**: 在 Figma 团队页面 URL 中 `figma.com/files/team/<team_id>/...`

## License

[MIT](./LICENSE)
