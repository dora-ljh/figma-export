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
async function downloadFile(url, filePath, timeoutMs = 120000) {
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

module.exports = {
  sanitizeFileName,
  ensureOutputDir,
  sleep,
  downloadFile,
  parallelLimit,
};
