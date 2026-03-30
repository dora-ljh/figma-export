#!/usr/bin/env node
require('dotenv').config();
const { Command } = require('commander');
const { run } = require('./exporter');
const { merge } = require('./merger');

const { version, description } = require('../package.json');

const program = new Command();

program
  .name('figma-export')
  .description(description)
  .version(version, '-v, --version');

// export 子命令（也是默认行为）
const exportCmd = program
  .command('export', { isDefault: true })
  .description('导出 Figma 设计稿')
  .option('--file-key <key>', 'Figma 文件 key（导出单个文件）')
  .option('--project-id <id>', '项目 ID（导出项目下所有文件）')
  .option('--team-id <id>', '团队 ID（导出团队下所有项目的所有文件）')
  .option('--token <token>', 'Figma 个人访问令牌（也可通过环境变量 FIGMA_TOKEN 设置）')
  .option('--scale <number>', '导出缩放比例（0.01-4）', '0.25')
  .option('--output <path>', '输出目录', './output')
  .option('--page <name...>', '只导出指定页面（可多次指定）')
  .option('--shard <index/total>', '分片参数，如 1/3 表示共3片取第1片')
  .option('--max-width <number>', '导出图片最大宽度（超过时自动降低 scale）', '3840')
  .option('--max-retries <number>', 'API 请求最大重试次数（0 为无限重试）', '3')
  .option('--no-cache', '忽略缓存，强制重新获取文件结构')
  .action((opts) => {
    // 校验：至少提供一个目标参数
    if (!opts.fileKey && !opts.projectId && !opts.teamId) {
      console.error('❌ 请提供以下参数之一：--file-key、--project-id、--team-id');
      console.error('\n用法示例：');
      console.error('  figma-export --file-key <key>          # 导出单个文件');
      console.error('  figma-export --project-id <id>         # 导出整个项目');
      console.error('  figma-export --team-id <id>            # 导出整个团队');
      process.exit(1);
    }

    // 校验 token（优先使用 --token 参数，其次读取环境变量）
    const token = opts.token || process.env.FIGMA_TOKEN;
    if (!token || token === 'your_figma_token_here') {
      console.error('❌ 请通过 --token 参数或环境变量 FIGMA_TOKEN 提供 Figma 访问令牌');
      console.error('   figma-export --token <your_token> --file-key <key>');
      console.error('   或设置环境变量：export FIGMA_TOKEN=<your_token>');
      process.exit(1);
    }

    // 校验 shard
    let shard = null;
    if (opts.shard) {
      const match = opts.shard.match(/^(\d+)\/(\d+)$/);
      if (!match) {
        console.error('❌ --shard 格式错误，应为 index/total，如 1/3');
        process.exit(1);
      }
      const shardIndex = parseInt(match[1], 10);
      const shardTotal = parseInt(match[2], 10);
      if (shardIndex < 1 || shardIndex > shardTotal || shardTotal < 1) {
        console.error('❌ --shard 参数无效，index 必须在 1 到 total 之间');
        process.exit(1);
      }
      shard = { index: shardIndex, total: shardTotal };
    }

    // 校验 scale
    const scale = parseFloat(opts.scale);
    if (isNaN(scale) || scale < 0.01 || scale > 4) {
      console.error('❌ scale 参数必须在 0.01-4 之间');
      process.exit(1);
    }

    // 校验 maxWidth
    const maxWidth = parseInt(opts.maxWidth, 10);
    if (isNaN(maxWidth) || maxWidth < 1) {
      console.error('❌ max-width 参数必须为正整数');
      process.exit(1);
    }

    // 校验 maxRetries
    const maxRetries = parseInt(opts.maxRetries, 10);
    if (isNaN(maxRetries) || maxRetries < 0) {
      console.error('❌ max-retries 参数必须为非负整数');
      process.exit(1);
    }

    // 启动导出
    run({
      token,
      fileKey: opts.fileKey,
      projectId: opts.projectId,
      teamId: opts.teamId,
      scale,
      output: opts.output,
      page: opts.page,
      shard,
      maxWidth,
      maxRetries,
      noCache: opts.cache === false,
    }).catch((err) => {
      console.error('\n❌ 导出失败:', err.message);
      if (err.response?.status === 403) {
        console.error('   Token 无效或权限不足，请检查 FIGMA_TOKEN');
      } else if (err.response?.status === 404) {
        console.error('   资源不存在，请检查 ID 是否正确');
      }
      process.exit(1);
    });
  });

// merge 子命令
program
  .command('merge')
  .description('合并多个分片导出目录')
  .requiredOption('-i, --input <dirs...>', '输入目录列表（多个目录用空格分隔）')
  .option('-o, --output <path>', '合并输出目录', './merged')
  .action((opts) => {
    merge(opts.input, opts.output).catch((err) => {
      console.error('\n❌ 合并失败:', err.message);
      process.exit(1);
    });
  });

program.parse(process.argv);
