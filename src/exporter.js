const path = require('path');
const { createClient, getFileStructure, getImageUrls, getTeamProjects, getProjectFiles } = require('./figma-client');
const { sanitizeFileName, ensureOutputDir, downloadFile, parallelLimit } = require('./utils');

// 每批请求的最大节点数
const BATCH_SIZE = 50;
// 并发下载数（过高会因带宽争抢导致全部超时）
const DOWNLOAD_CONCURRENCY = 2;
// 渲染超时时尝试的 scale 降级序列
const SCALE_FALLBACKS = [1, 0.75, 0.5, 0.25];

/**
 * 判断是否为 Figma 渲染超时错误
 */
function isRenderTimeout(err) {
  return err.response?.status === 400 && err.response?.data?.err?.includes('timeout');
}

/**
 * 获取单个 Frame 的图片 URL，渲染超时时自动降低 scale 重试
 * @returns {{ imageUrl: string, usedScale: number } | null}
 */
async function getImageUrlWithScaleFallback(client, fileKey, frame, requestedScale) {
  // 先用原始 scale 尝试
  try {
    const urls = await getImageUrls(client, fileKey, [frame.nodeId], requestedScale);
    if (urls[frame.nodeId]) {
      return { imageUrl: urls[frame.nodeId], usedScale: requestedScale };
    }
  } catch (err) {
    if (!isRenderTimeout(err)) throw err;
  }

  // 原始 scale 渲染超时，尝试更小的 scale
  const fallbacks = SCALE_FALLBACKS.filter((s) => s < requestedScale);
  for (const fallbackScale of fallbacks) {
    console.log(`      ↻ ${frame.frameName} 渲染超时，尝试 scale=${fallbackScale}...`);
    try {
      const urls = await getImageUrls(client, fileKey, [frame.nodeId], fallbackScale);
      if (urls[frame.nodeId]) {
        console.log(`      ✓ ${frame.frameName} 在 scale=${fallbackScale} 下渲染成功`);
        return { imageUrl: urls[frame.nodeId], usedScale: fallbackScale };
      }
    } catch (retryErr) {
      if (!isRenderTimeout(retryErr)) throw retryErr;
    }
  }

  console.log(`      ✗ ${frame.frameName} 所有 scale 均渲染失败`);
  return null;
}

/**
 * 从文件结构中提取所有顶层 Frame
 */
function extractTopFrames(fileData, pageFilter) {
  const pages = fileData.document.children;
  const frames = [];

  for (const page of pages) {
    // 如果指定了页面过滤，跳过不匹配的
    if (pageFilter.length > 0 && !pageFilter.includes(page.name)) {
      continue;
    }

    // 统计同名 Frame 用于去重
    const nameCount = {};
    const pageFrames = (page.children || []).filter((node) => node.type === 'FRAME');

    // 先统计名称出现次数
    for (const frame of pageFrames) {
      nameCount[frame.name] = (nameCount[frame.name] || 0) + 1;
    }

    // 记录已使用的名称次数（用于编号）
    const nameUsed = {};

    for (const frame of pageFrames) {
      nameUsed[frame.name] = (nameUsed[frame.name] || 0) + 1;

      // 如果有重名，追加序号
      let fileName = frame.name;
      if (nameCount[frame.name] > 1) {
        fileName = `${frame.name}_${nameUsed[frame.name]}`;
      }

      frames.push({
        pageNname: page.name,
        frameName: fileName,
        nodeId: frame.id,
      });
    }
  }

  return frames;
}

/**
 * 将数组分批
 */
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * 导出单个 Figma 文件
 * @returns {{ success: number, fail: number }} 导出统计
 */
async function exportFile(client, fileKey, scale, outputDir, pageFilter) {
  // 获取文件结构
  console.log('\n📂 获取文件结构...');
  const fileData = await getFileStructure(client, fileKey);
  const fileName = sanitizeFileName(fileData.name);
  console.log(`   文件名: ${fileData.name}`);

  // 提取顶层 Frame
  const frames = extractTopFrames(fileData, pageFilter);
  if (frames.length === 0) {
    console.log('   ⚠️  未找到任何顶层 Frame，跳过');
    return { success: 0, fail: 0 };
  }
  console.log(`   找到 ${frames.length} 个顶层 Frame`);

  // 分批获取图片 URL（渲染超时时自动降级为逐个请求，再降 scale 重试）
  console.log('   🖼️  获取图片 URL...');
  const batches = chunk(frames, BATCH_SIZE);
  const imageUrlMap = {};
  // 记录每个 frame 实际使用的 scale（降级后可能不同）
  const frameScaleMap = {};

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const nodeIds = batch.map((f) => f.nodeId);
    console.log(`   批次 ${i + 1}/${batches.length}（${nodeIds.length} 个节点）`);

    try {
      const urls = await getImageUrls(client, fileKey, nodeIds, scale);
      Object.assign(imageUrlMap, urls);
      for (const id of nodeIds) frameScaleMap[id] = scale;
    } catch (err) {
      // 渲染超时，降级为逐个请求
      if (isRenderTimeout(err)) {
        console.log('   ⚠️  批量渲染超时，切换为逐个请求...');
        for (let j = 0; j < batch.length; j++) {
          const frame = batch[j];
          console.log(`   逐个请求 ${j + 1}/${batch.length}: ${frame.frameName}`);
          const url = await getImageUrlWithScaleFallback(client, fileKey, frame, scale);
          if (url) {
            imageUrlMap[frame.nodeId] = url.imageUrl;
            frameScaleMap[frame.nodeId] = url.usedScale;
          }
        }
      } else {
        throw err;
      }
    }
  }

  // 下载图片
  console.log('   ⬇️  下载图片...');
  let success = 0;
  let fail = 0;
  const failures = [];

  const downloadTasks = frames.map((frame) => {
    return async () => {
      const url = imageUrlMap[frame.nodeId];
      if (!url) {
        fail++;
        failures.push({ frame, reason: '未获取到图片 URL（可能渲染失败）' });
        return;
      }

      // 输出路径：outputDir/文件名/页面名/Frame名.png
      const dirPath = await ensureOutputDir(path.join(outputDir, fileName), frame.pageNname);
      const framePngName = `${sanitizeFileName(frame.frameName)}.png`;
      const filePath = path.join(dirPath, framePngName);

      try {
        await downloadFile(url, filePath);
        success++;
        const scaleNote = frameScaleMap[frame.nodeId] !== scale ? ` (scale=${frameScaleMap[frame.nodeId]})` : '';
        console.log(`   ✅ ${fileName}/${frame.pageNname}/${framePngName}${scaleNote}`);
      } catch (err) {
        fail++;
        failures.push({ frame, reason: err.message });
        console.log(`   ❌ ${fileName}/${frame.pageNname}/${framePngName} - ${err.message}`);
      }
    };
  });

  await parallelLimit(downloadTasks, DOWNLOAD_CONCURRENCY);

  if (failures.length > 0) {
    console.log('   ❌ 失败列表:');
    for (const f of failures) {
      console.log(`      - ${f.frame.pageNname}/${f.frame.frameName}: ${f.reason}`);
    }
  }

  return { success, fail };
}

/**
 * 主导出流程
 */
async function run(options) {
  const { token, fileKey, projectId, teamId, scale, output, page } = options;
  const pageFilter = page || [];
  const client = createClient(token);

  console.log(`🚀 Figma 批量导出工具`);
  console.log(`   缩放比例: ${scale}x | 输出目录: ${output}`);

  // 收集要导出的文件列表 [{ key, name }]
  let files = [];

  if (teamId) {
    // 团队模式：获取所有项目 → 所有文件
    console.log(`\n📋 获取团队 ${teamId} 下的所有项目...`);
    const projects = await getTeamProjects(client, teamId);
    console.log(`   找到 ${projects.length} 个项目`);

    for (const project of projects) {
      console.log(`\n   📁 项目: ${project.name}`);
      const projectData = await getProjectFiles(client, project.id);
      for (const file of projectData.files) {
        files.push({ key: file.key, name: file.name, projectName: project.name });
      }
      console.log(`      ${projectData.files.length} 个文件`);
    }
  } else if (projectId) {
    // 项目模式：获取项目下所有文件
    console.log(`\n📋 获取项目 ${projectId} 下的文件...`);
    const projectData = await getProjectFiles(client, projectId);
    console.log(`   项目: ${projectData.name}，共 ${projectData.files.length} 个文件`);
    for (const file of projectData.files) {
      files.push({ key: file.key, name: file.name, projectName: projectData.name });
    }
  } else if (fileKey) {
    // 单文件模式
    files.push({ key: fileKey, name: '', projectName: '' });
  }

  if (files.length === 0) {
    console.log('⚠️  未找到任何文件');
    return;
  }

  console.log(`\n📊 共 ${files.length} 个文件待导出\n${'─'.repeat(50)}`);

  // 逐个文件导出
  let totalSuccess = 0;
  let totalFail = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`\n[${i + 1}/${files.length}] 📄 ${file.projectName ? file.projectName + ' / ' : ''}${file.name || file.key}`);

    try {
      // 项目/团队模式下，输出路径加上项目名
      const fileOutputDir = file.projectName
        ? path.join(output, sanitizeFileName(file.projectName))
        : output;

      const result = await exportFile(client, file.key, scale, fileOutputDir, pageFilter);
      totalSuccess += result.success;
      totalFail += result.fail;
    } catch (err) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : '';
      console.log(`   ❌ 文件导出失败: ${err.message} ${detail}`);
      totalFail++;
    }
  }

  // 总摘要
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 全部导出完成！`);
  console.log(`   文件数: ${files.length} | 成功: ${totalSuccess} | 失败: ${totalFail}`);
}

module.exports = { run };
