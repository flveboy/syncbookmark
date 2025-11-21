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
const requiredEnv = ['GITEE_TOKEN', 'GITEE_OWNER', 'GITEE_REPO', 'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'];
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

// ========== 新增：自动分类规则 ==========
const AUTO_CATEGORIES = [
  {
    id: "ai-tools",
    name: "AI智能",
    icon: "🤖",
    order: 1,
    keywords: ["openai", "chatgpt", "claude", "midjourney", "cursor", "copilot", "gemini", "anthropic", "huggingface", "ai", "llm", "大模型", "通义", "文心", "kimi", "deepseek", "grok", "ollama", "perplexity"],
    domains: ["openai.com", "chatgpt.com", "claude.ai", "midjourney.com", "cursor.sh", "github.com/features/copilot", "huggingface.co", "gemini.google.com", "qwen.ai", "ernie.baidu.com", "kimi.moonshot.cn", "deepseek.com", "x.ai", "ollama.com", "perplexity.ai"]
  },
  {
    id: "cloud",
    name: "云服务",
    icon: "☁️",
    order: 2,
    keywords: ["cloud", "vercel", "netlify", "aws", "aliyun", "huawei", "tencent", "digitalocean", "linode", "vultr", "pasyun", "cloudflare", "阿里云", "腾讯云", "华为云", "怕死云"],
    domains: ["vercel.com", "netlify.com", "aws.amazon.com", "aliyun.com", "huaweicloud.com", "cloud.tencent.com", "digitalocean.com", "linode.com", "vultr.com", "pasyun.com", "cloudflare.com"]
  },
  {
    id: "dev-tools",
    name: "开发工具",
    icon: "🛠️",
    order: 3,
    keywords: ["github", "vscode", "webstorm", "postman", "android", "java", "oracle", "jetbrains", "docker", "npm", "git", "ide", "editor", "sdk", "jdk"],
    domains: ["github.com", "code.visualstudio.com", "jetbrains.com/webstorm", "postman.com", "developer.android.com", "oracle.com/java", "docker.com", "npmjs.com"]
  },
  {
    id: "design",
    name: "设计工具",
    icon: "🎨",
    order: 4,
    keywords: ["figma", "sketch", "canva", "adobe", "xd", "ui", "ux", "design", "illustrator", "photoshop"],
    domains: ["figma.com", "sketch.com", "canva.com", "adobe.com/products/xd"]
  },
  {
    id: "finance",
    name: "财经投资",
    icon: "💰",
    order: 5,
    keywords: ["binance", "okx", "bitget", "tradingview", "xueqiu", "10jqka", "futu", "coinbase", "币安", "雪球", "同花顺", "富途", "加密", "比特币", "股票", "行情"],
    domains: ["binance.com", "okx.com", "bitget.com", "tradingview.com", "xueqiu.com", "10jqka.com.cn", "futunn.com", "coinbase.com"]
  },
  {
    id: "community",
    name: "社区论坛",
    icon: "👥",
    order: 6,
    keywords: ["stackoverflow", "linux.do", "nodeseek", "v2ex", "52pojie", "吾爱破解", "极客", "技术社区", "论坛"],
    domains: ["stackoverflow.com", "linux.do", "nodeseek.com", "v2ex.com", "52pojie.cn"]
  },
  {
    id: "learning",
    name: "学习资源",
    icon: "📚",
    order: 6,
    keywords: ["mdn", "w3schools", "runoob", "coursera", "教程", "文档", "learn", "education", "菜鸟", "mozilla"],
    domains: ["developer.mozilla.org", "w3schools.com", "runoob.com", "coursera.org"]
  },
  {
    id: "tools",
    name: "在线工具",
    icon: "⚙️",
    order: 7,
    keywords: ["bejson", "jsonformatter", "regex101", "tinypng", "curlconverter", "工具", "格式化", "压缩", "正则", "转换"],
    domains: ["bejson.com", "jsonformatter.org", "regex101.com", "tinypng.com", "curlconverter.com"]
  },
  {
    id: "entertainment",
    name: "娱乐休闲",
    icon: "🎮",
    order: 8,
    keywords: ["bilibili", "youtube", "douban", "zhihu", "哔哩", "豆瓣", "知乎", "视频", "弹幕", "问答"],
    domains: ["bilibili.com", "youtube.com", "douban.com", "zhihu.com"]
  },
  {
    id: "office",
    name: "办公协作",
    icon: "💼",
    order: 9,
    keywords: ["notion", "slack", "trello", "feishu", "飞书", "协作", "项目管理", "文档", "团队"],
    domains: ["notion.so", "slack.com", "trello.com", "feishu.cn"]
  },
  {
    id: "my-favorites",
    name: "我的常用",
    icon: "💥",
    order: 0,
    keywords: [],
    domains: []
  }
];

function autoClassify(url, name) {
  const fullUrl = url.toLowerCase();
  const text = (name + ' ' + fullUrl).toLowerCase();

  for (const cat of AUTO_CATEGORIES) {
    if (cat.domains && cat.domains.some(domain => fullUrl.includes(domain))) {
      return cat;
    }
  }

  for (const cat of AUTO_CATEGORIES) {
    if (cat.keywords && cat.keywords.some(kw => text.includes(kw))) {
      return cat;
    }
  }

  return AUTO_CATEGORIES.find(c => c.id === 'my-favorites');
}

function generateStableId(url) {
  return 'site-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now();
}

// 轻量级书签 HTML 解析器（不依赖 DOMParser）
function parseBookmarks(html) {
  html = html.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ');
  const sites = [];
  let siteMatch;
  const siteRegex = /<DT><A HREF="([^"]+)"[^>]*>([^<]+)<\/A>/gi;
  while ((siteMatch = siteRegex.exec(html)) !== null) {
    const url = siteMatch[1].trim();
    const name = siteMatch[2].trim();
    if (!url || url.startsWith('javascript:') || url === '#') continue;
    try {
      new URL(url);
    } catch {
      continue;
    }
    sites.push({ url, name });
  }
  return sites;
}

// 从 GitHub 获取当前 mock_data.js 内容（用于去重和分类复用）
async function fetchCurrentMockData() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
  const res = await fetch(apiUrl, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'User-Agent': 'Vercel-Webhook-Sync',
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!res.ok) {
    // 如果文件不存在，返回空结构
    if (res.status === 404) {
      return { categories: [], title: "龙的导航🐱" };
    }
    const text = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  const match = content.match(/export\s+const\s+mockData\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (!match) {
    throw new Error('Invalid mock_data.js format');
  }
  return JSON.parse(match[1]);
}

// 更新 GitHub 文件
async function updateFileOnGitHub(content, sha = null) {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
  const body = {
    message: `chore: auto-sync bookmarks from Gitee (${new Date().toISOString()})`,
    content: Buffer.from(content).toString('base64'),
    branch: GITHUB_BRANCH,
    sha,
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
    const triggerRepo = payload.repository?.full_name;
    console.log('📦 触发仓库:', triggerRepo);

    // === 执行同步流程 ===
    console.log('🔄 开始同步书签...');

    // 1. 获取当前 GitHub 数据（用于去重）
    const currentData = await fetchCurrentMockData();
    const existingUrls = new Set();
    const categoryMap = new Map();

    for (const cat of currentData.categories) {
      categoryMap.set(cat.id, { ...cat, sites: [...cat.sites] });
      for (const site of cat.sites) {
        existingUrls.add(site.url);
      }
    }

    // 2. 从 Gitee 下载 bookmarks.html
    const html = await fetchFileFromGitee();
    console.log(`📥 成功从 Gitee 下载: ${GITEE_OWNER}/${GITEE_REPO}/${GITEE_FILE_PATH}`);

    // 3. 解析所有书签（不分组）
    const allBookmarks = parseBookmarks(html);
    console.log(`✅ 解析出 ${allBookmarks.length} 个书签`);

    // 4. 处理新书签
    let addedCount = 0;
    for (const { url, name } of allBookmarks) {
      if (existingUrls.has(url)) continue;

      const targetCat = autoClassify(url, name);
      let targetCategory = categoryMap.get(targetCat.id);

      // 自动创建缺失的分类
      if (!targetCategory) {
        targetCategory = {
          id: targetCat.id,
          name: targetCat.name,
          icon: targetCat.icon,
          order: Math.max(...Array.from(categoryMap.values()).map(c => c.order), -1) + 1,
          sites: []
        };
        categoryMap.set(targetCat.id, targetCategory);
      }

      const hostname = new URL(url).hostname.replace('www.', '');
      const icon = `/sitelogo/${hostname}.ico`;

      targetCategory.sites.push({
        id: generateStableId(url),
        name: name || url,
        url,
        description: name || '',
        icon,
      });

      existingUrls.add(url);
      addedCount++;
    }

    // 5. 重组 categories（保持原顺序 + 新增放最后）
    const finalCategories = [];
    const usedIds = new Set();

    for (const cat of currentData.categories) {
      if (categoryMap.has(cat.id)) {
        finalCategories.push(categoryMap.get(cat.id));
        usedIds.add(cat.id);
      }
    }

    for (const [id, cat] of categoryMap.entries()) {
      if (!usedIds.has(id)) {
        finalCategories.push(cat);
      }
    }

    // 6. 生成新 mock_data.js
    const newData = {
      categories: finalCategories,
      title: currentData.title || "龙的导航🐱",
      _fileSha: currentData._fileSha // 保留原字段（如果存在）
    };

    const jsonStr = JSON.stringify(newData, null, 2)
      .replace(/"icon":\s*"([^"]+)"/g, '"icon": "$1"')
      .replace(/"id":\s*"([^"]+)"/g, '"id": "$1"');
    const jsContent = `export const mockData = ${jsonStr};\n`;

    // 7. 获取当前 SHA（用于更新）
    const headRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'Vercel-Webhook-Sync' },
    });
    let sha = null;
    if (headRes.ok) {
      const headData = await headRes.json();
      sha = headData.sha;
    }

    // 8. 推送到 GitHub
    await updateFileOnGitHub(jsContent, sha);
    console.log(`🚀 成功推送到 GitHub: ${addedCount} 个新书签`);

    return res.status(200).json({ success: true, added: addedCount });

  } catch (error) {
    console.error('💥 同步失败:', error.message || error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
