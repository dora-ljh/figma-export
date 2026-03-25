const path = require('path');
const fse = require('fs-extra');

/**
 * 递归获取目录下所有文件的相对路径
 */
async function getAllFiles(dir, baseDir = dir) {
  const entries = await fse.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await getAllFiles(fullPath, baseDir));
    } else {
      files.push(path.relative(baseDir, fullPath));
    }
  }

  return files;
}

/**
 * 合并多个分片目录到目标目录
 * @param {string[]} inputDirs - 输入目录列表
 * @param {string} outputDir - 输出目录
 */
async function merge(inputDirs, outputDir) {
  // 校验输入目录是否存在
  for (const dir of inputDirs) {
    if (!await fse.pathExists(dir)) {
      throw new Error(`输入目录不存在: ${dir}`);
    }
  }

  await fse.ensureDir(outputDir);

  let totalFiles = 0;
  let copiedFiles = 0;
  let skippedFiles = 0;
  let overwrittenFiles = 0;

  for (const inputDir of inputDirs) {
    console.log(`\n📂 正在处理: ${inputDir}`);
    const files = await getAllFiles(inputDir);

    for (const relPath of files) {
      totalFiles++;
      const srcPath = path.join(inputDir, relPath);
      const destPath = path.join(outputDir, relPath);

      if (await fse.pathExists(destPath)) {
        const srcStat = await fse.stat(srcPath);
        const destStat = await fse.stat(destPath);

        if (srcStat.size === destStat.size) {
          skippedFiles++;
          continue;
        }

        // 大小不同，覆盖并警告
        console.log(`⚠️  覆盖文件（大小不同）: ${relPath}`);
        overwrittenFiles++;
      } else {
        copiedFiles++;
      }

      await fse.ensureDir(path.dirname(destPath));
      await fse.copy(srcPath, destPath, { overwrite: true });
    }
  }

  console.log('\n✅ 合并完成');
  console.log(`   总文件数: ${totalFiles}`);
  console.log(`   新增: ${copiedFiles}`);
  console.log(`   跳过（相同）: ${skippedFiles}`);
  console.log(`   覆盖（不同）: ${overwrittenFiles}`);
  console.log(`   输出目录: ${path.resolve(outputDir)}`);
}

module.exports = { merge };
