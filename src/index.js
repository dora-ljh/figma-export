require('dotenv').config();
const { program } = require('commander');
const { run } = require('./exporter');

program
  .option('--file-key <key>', 'Figma 文件 key（导出单个文件）')
  .option('--project-id <id>', '项目 ID（导出项目下所有文件）')
  .option('--team-id <id>', '团队 ID（导出团队下所有项目的所有文件）')
  .option('--scale <number>', '导出缩放比例（0.01-4）', '2')
  .option('--output <path>', '输出目录', './output')
  .option('--page <name...>', '只导出指定页面（可多次指定）')
  .parse(process.argv);

const opts = program.opts();

// 校验：至少提供一个目标参数
if (!opts.fileKey && !opts.projectId && !opts.teamId) {
  console.error('❌ 请提供以下参数之一：--file-key、--project-id、--team-id');
  console.error('\n用法示例：');
  console.error('  node src/index.js --file-key <key>          # 导出单个文件');
  console.error('  node src/index.js --project-id <id>         # 导出整个项目');
  console.error('  node src/index.js --team-id <id>            # 导出整个团队');
  process.exit(1);
}

// 校验 token
const token = process.env.FIGMA_TOKEN;
if (!token || token === 'your_figma_token_here') {
  console.error('❌ 请在 .env 文件中设置 FIGMA_TOKEN');
  process.exit(1);
}

// 校验 scale
const scale = parseFloat(opts.scale);
if (isNaN(scale) || scale < 0.01 || scale > 4) {
  console.error('❌ scale 参数必须在 0.01-4 之间');
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
}).catch((err) => {
  console.error('\n❌ 导出失败:', err.message);
  if (err.response?.status === 403) {
    console.error('   Token 无效或权限不足，请检查 FIGMA_TOKEN');
  } else if (err.response?.status === 404) {
    console.error('   资源不存在，请检查 ID 是否正确');
  }
  process.exit(1);
});
