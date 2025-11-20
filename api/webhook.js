// api/webhook.js
export const config = { runtime: 'nodejs' };

// === 1. 从环境变量加载配置 ===
const {
  GITEE_TOKEN,
  GITEE_OWNER,
  GITEE_REPO,
  GITEE_FILE_PATH = 'bookmarks.html',
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_FILE_PATH = 'mock_data.js',
  GITHUB_BRANCH = 'main',
} = process.env;

// 验证必要环境变量
const requiredEnv = [
  'GITEE_TOKEN', 'GITEE_OWNER', 'GITEE_REPO',
  'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'
];
const missing = requiredEnv.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ 缺少必要环境变量:', missing);
  throw new Error(`Missing env vars: ${missing.join(', ')}`);
}

// === 2. 工具函数 ===
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// 轻量级书签 HTML 解析器（不依赖 DOMParser）
function parseBookmarks(html) {
  // 移除换行和多余空格，便于正则匹配
  html = html.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ');

  const categories = [];
  let folderMatch;
  const folderRegex = /<DT><H3[^>]*>([^<]+)<\/H3>\s*<DL>([\s\S]*?)<\/DL>/gi;

  let order = 0;
  while ((folderMatch = folderRegex.exec(html)) !== null) {
    const folderName = folderMatch[1].trim();
    const folderContent = folderMatch[2];

    const sites = [];
    let siteMatch;
    const siteRegex = /<DT><A HREF="([^"]+)"[^>]*>([^<]+)<\/A>/gi;

    while ((siteMatch = siteRegex.exec(folderContent)) !== null) {
      const url = siteMatch[1].trim();
      const name = siteMatch[2].trim();

      // 跳过无效链接
      if (!url || url.startsWith('javascript:') || url === '#') continue;

      try {
        new URL(url); // 验证是否为合法 URL
      } catch {
        continue;
      }

      const hostname = new URL(url).hostname;
      const icon = `https://www.faviconextractor.com/favicon/${hostname}`;

      sites.push({
        id: `site-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: name || url,
        url,
        description: '',
        icon,
      });
    }

    categories.push({
      id: `folder-${folderName.replace(/\s+/g, '-').toLowerCase()}-${order}`,
      name: folderName,
      icon: '📁',
      order,
      sites,
    });
    order++;
  }

  return categories;
}

function generateMockDataJS(categories) {
  const data = {
    categories,
    title: "龙的导航🐱"
  };
  const jsonStr = JSON.stringify(data, null, 2)
    .replace(/"icon":\s*"([^"]+)"/g, '"icon": "$1"')
    .replace(/"id":\s*"([^"]+)"/g, '"id": "$1"');
  return `export const mockData = ${jsonStr};\n`;
}

// 从 Gitee 获取文件内容
async function fetchFileFromGitee() {
  const url = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${encodeURIComponent(GITEE_FILE_PATH)}?access_token=${GITEE_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gitee API error (${res.status}): ${text}`);
  }
  const data = await res.json();
  if (!data.content) throw new Error(`File not found: ${GITEE_FILE_PATH}`);
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

// 更新 GitHub 文件
async function updateFileOnGitHub(content) {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;

  // 获取当前 SHA（用于更新）
  const headRes = await fetch(apiUrl, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'User-Agent': 'Vercel-Webhook-Sync',
      Accept: 'application/vnd.github.v3+json',
    },
  });

  let sha = null;
  if (headRes.ok) {
    const headData = await headRes.json();
    sha = headData.sha;
  }

  const body = {
    message: `chore: auto-sync bookmarks from Gitee (${new Date().toISOString()})`,
    content: Buffer.from(content).toString('base64'),
    branch: GITHUB_BRANCH,
    sha, // 如果存在则更新，否则创建
  };

  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Vercel-Webhook-Sync',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${errText}`);
  }

  return await res.json();
}

// === 3. 主处理函数 ===
module.exports = async (req, res) => {
  console.log('🔍 ===== 新 Webhook 请求 =====');
  const clientIP = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim();
  if (!clientIP?.startsWith('106.13.250.')) {
    console.warn('❌ 非 Gitee IP 拒绝:', clientIP);
    return res.status(403).send('Forbidden');
  }
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const rawBody = await getRawBody(req);
    const payload = JSON.parse(rawBody);

    // 可选：记录触发仓库（仅用于日志）
    const triggerRepo = payload.repository?.full_name;
    console.log('📦 触发仓库:', triggerRepo);

    // === 执行同步流程 ===
    console.log('🔄 开始同步书签...');

    const html = await fetchFileFromGitee();
    console.log(`📥 成功从 Gitee 下载: ${GITEE_OWNER}/${GITEE_REPO}/${GITEE_FILE_PATH}`);

    const categories = parseBookmarks(html);
    console.log(`✅ 解析出 ${categories.length} 个分类`);

    const jsContent = generateMockDataJS(categories);
    console.log('🧾 已生成 mock_data.js 内容');

    await updateFileOnGitHub(jsContent);
    console.log(`🚀 成功推送到 GitHub: ${GITHUB_OWNER}/${GITHUB_REPO}@${GITHUB_BRANCH}/${GITHUB_FILE_PATH}`);

    return res.status(200).json({ success: true, categories: categories.length });

  } catch (error) {
    console.error('💥 同步失败:', error.message || error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
