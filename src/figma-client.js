const axios = require('axios');
const { sleep } = require('./utils');

const MAX_RETRIES = 3;
const BASE_URL = 'https://api.figma.com/v1';

/**
 * 创建带重试逻辑的 Figma API 客户端
 */
function createClient(token) {
  const instance = axios.create({
    baseURL: BASE_URL,
    headers: {
      'X-Figma-Token': token,
    },
    timeout: 60000,
  });

  // 响应拦截器：处理 429 和 5xx 的自动重试
  instance.interceptors.response.use(null, async (error) => {
    const config = error.config;
    config.__retryCount = config.__retryCount || 0;

    if (config.__retryCount >= MAX_RETRIES) {
      throw error;
    }

    const status = error.response?.status;

    // 只对 429（速率限制）和 5xx（服务器错误）重试
    if (status !== 429 && (status < 500 || status >= 600)) {
      throw error;
    }

    config.__retryCount++;

    // 429 优先使用 Retry-After，否则指数退避
    let delay;
    if (status === 429) {
      const retryAfter = parseInt(error.response.headers['retry-after'], 10);
      delay = (retryAfter || 30) * 1000;
      console.log(`⏳ 触发速率限制，${delay / 1000}s 后重试（第 ${config.__retryCount} 次）...`);
    } else {
      delay = Math.pow(2, config.__retryCount) * 1000;
      console.log(`⏳ 服务器错误 ${status}，${delay / 1000}s 后重试（第 ${config.__retryCount} 次）...`);
    }

    await sleep(delay);
    return instance(config);
  });

  return instance;
}

/**
 * 获取 Figma 文件结构
 */
async function getFileStructure(client, fileKey) {
  const response = await client.get(`/files/${fileKey}`);
  return response.data;
}

/**
 * 批量获取节点的图片 URL
 * @param {Array<string>} nodeIds - 节点 ID 列表
 * @param {number} scale - 缩放比例
 * @returns {Object} nodeId -> imageUrl 映射
 */
async function getImageUrls(client, fileKey, nodeIds, scale = 2) {
  const ids = nodeIds.join(',');
  // 直接拼接 URL，避免 axios params 对冒号的编码问题
  const url = `/images/${fileKey}?ids=${ids}&format=png&scale=${scale}`;
  const response = await client.get(url);

  if (response.data.err) {
    throw new Error(`Figma API 错误: ${response.data.err}`);
  }

  return response.data.images;
}

/**
 * 获取团队下所有项目
 */
async function getTeamProjects(client, teamId) {
  const response = await client.get(`/teams/${teamId}/projects`);
  return response.data.projects;
}

/**
 * 获取项目下所有文件
 */
async function getProjectFiles(client, projectId) {
  const response = await client.get(`/projects/${projectId}/files`);
  return response.data;
}

module.exports = {
  createClient,
  getFileStructure,
  getImageUrls,
  getTeamProjects,
  getProjectFiles,
};
