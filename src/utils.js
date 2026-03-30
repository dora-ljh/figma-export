const axios = require('axios');
const fse = require('fs-extra');
const path = require('path');

/**
 * 清洗文件名，去除操作系统不允许的字符
 */
function sanitizeFileName(name) {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim();
}

/**
 * 确保输出目录存在
 */
async function ensureOutputDir(basePath, pageName) {
  const dirPath = path.join(basePath, sanitizeFileName(pageName));
  await fse.ensureDir(dirPath);
  return dirPath;
}

/**
 * 延迟指定毫秒
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 下载文件到本地
 */
async function downloadOnce(url, filePath, timeoutMs) {
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: timeoutMs,
  });

  const writer = fse.createWriteStream(filePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response.data.destroy();
      writer.close();
      // 删除不完整的文件
      fse.remove(filePath).catch(() => {});
      reject(err);
    };

    const timer = setTimeout(() => fail(new Error('下载超时')), timeoutMs);

    writer.on('finish', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
    writer.on('error', (err) => fail(err));
    response.data.on('error', (err) => fail(err));
  });
}

/**
 * 带重试的下载，每次重试增加超时时间
 */
const DOWNLOAD_MAX_RETRIES = 3;
const DOWNLOAD_BASE_TIMEOUT = 300000; // 5分钟

async function downloadFile(url, filePath) {
  for (let attempt = 0; attempt <= DOWNLOAD_MAX_RETRIES; attempt++) {
    try {
      // 每次重试超时翻倍：3分钟 → 6分钟 → 12分钟
      const timeoutMs = DOWNLOAD_BASE_TIMEOUT * Math.pow(2, attempt);
      await downloadOnce(url, filePath, timeoutMs);
      return;
    } catch (err) {
      if (attempt < DOWNLOAD_MAX_RETRIES) {
        const waitSec = (attempt + 1) * 3;
        console.log(`      ↻ 下载失败（${err.message}），${waitSec}s 后第 ${attempt + 1} 次重试...`);
        await sleep(waitSec * 1000);
      } else {
        throw err;
      }
    }
  }
}

/**
 * 限制并发数的批量执行
 */
async function parallelLimit(tasks, limit) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = task().then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    );
    results.push(p);
    executing.add(p);
    p.finally(() => executing.delete(p));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

const CACHE_FILE_NAME = '.figma-export-cache.json';

/**
 * 加载缓存文件，不存在或损坏返回 null
 */
async function loadCache(outputDir) {
  try {
    const cachePath = path.join(outputDir, CACHE_FILE_NAME);
    const cache = await fse.readJson(cachePath);
    if (cache.version !== 1) return null;
    return cache;
  } catch {
    return null;
  }
}

/**
 * 保存缓存文件
 */
async function saveCache(outputDir, cacheData) {
  await fse.ensureDir(outputDir);
  cacheData.updatedAt = new Date().toISOString();
  const cachePath = path.join(outputDir, CACHE_FILE_NAME);
  await fse.writeJson(cachePath, cacheData, { spaces: 2 });
}

/**
 * 校验缓存是否与当前选项匹配
 */
function isCacheValid(cache, currentOptions) {
  if (!cache || !cache.options) return false;
  const cached = cache.options;
  // 比较影响目录结构的参数
  if ((cached.teamId || null) !== (currentOptions.teamId || null)) return false;
  if ((cached.projectId || null) !== (currentOptions.projectId || null)) return false;
  if ((cached.fileKey || null) !== (currentOptions.fileKey || null)) return false;
  // 比较 page 数组（排序后对比）
  const cachedPage = [...(cached.page || [])].sort();
  const currentPage = [...(currentOptions.page || [])].sort();
  if (cachedPage.length !== currentPage.length) return false;
  for (let i = 0; i < cachedPage.length; i++) {
    if (cachedPage[i] !== currentPage[i]) return false;
  }
  return true;
}

module.exports = {
  sanitizeFileName,
  ensureOutputDir,
  sleep,
  downloadFile,
  parallelLimit,
  loadCache,
  saveCache,
  isCacheValid,
};
