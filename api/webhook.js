// api/webhook.js
const { parseBookmarks, generateMockDataJS } = require('../scripts/parse-bookmarks');

// === 新增：从 Node.js req 读取原始 body ===
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

// HMAC-SHA256 验证（不变）
async function verifySignature(payload, signature, secret) {
  if (!secret || !signature) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const hex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex === signature;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).end('Method Not Allowed');
    }

    // 👇 关键修复：使用 getRawBody 代替 req.text()
    const body = await getRawBody(req);

    // 验证签名
    const signature = req.headers['x-gitee-token'];
    const secret = process.env.GITEE_WEBHOOK_SECRET;
    const isValid = await verifySignature(body, signature, secret);
    if (!isValid) {
      console.warn('⚠️ Invalid signature');
      return res.status(403).send('Forbidden');
    }

    // 解析 JSON payload
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      console.error('❌ Invalid JSON body');
      return res.status(400).send('Bad Request');
    }

    // 分支过滤
    const targetBranch = process.env.GITEE_BRANCH || 'master';
    const expectedRef = `refs/heads/${targetBranch}`;
    if (payload.ref !== expectedRef) {
      console.log(`⏭️ Ignored push to ${payload.ref}`);
      return res.status(200).json({ ignored: true });
    }

    // 后续逻辑保持不变...
    console.log(`▶️ Processing push to ${targetBranch}`);

    // === Gitee 获取文件 ===
    const giteeOwner = process.env.GITEE_OWNER;
    const giteeRepo = process.env.GITEE_REPO;
    const giteeFilePath = process.env.GITEE_FILE_PATH || 'bookmarks.html';
    const giteeToken = process.env.GITEE_TOKEN;

    if (!giteeOwner || !giteeRepo || !giteeToken) {
      throw new Error('Missing Gitee environment variables');
    }

    const giteeUrl = `https://gitee.com/api/v5/repos/${giteeOwner}/${giteeRepo}/contents/${encodeURIComponent(giteeFilePath)}?ref=${targetBranch}`;
    const giteeRes = await fetch(giteeUrl, {
      headers: {
        'Authorization': `token ${giteeToken}`,
        'User-Agent': 'flveboy-bookmark-sync'
      }
    });

    if (!giteeRes.ok) {
      const errText = await giteeRes.text();
      throw new Error(`Gitee API error (${giteeRes.status}): ${errText}`);
    }

    const giteeData = await giteeRes.json();
    const htmlContent = Buffer.from(giteeData.content, 'base64').toString('utf8');

    // 解析书签
    const links = parseBookmarks(htmlContent);
    const mockDataJS = generateMockDataJS(links);

    // === GitHub 更新 ===
    const githubOwner = process.env.GITHUB_OWNER;
    const githubRepo = process.env.GITHUB_REPO;
    const githubFilePath = process.env.GITHUB_FILE_PATH || 'src/mock_data.js';
    const githubToken = process.env.GITHUB_TOKEN;
    const githubBranch = process.env.GITHUB_BRANCH || 'main';

    if (!githubOwner || !githubRepo || !githubToken) {
      throw new Error('Missing GitHub environment variables');
    }

    const githubFileUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${githubFilePath}`;

    let currentSha = null;
    try {
      const shaRes = await fetch(githubFileUrl, {
        headers: { 'Authorization': `token ${githubToken}` }
      });
      if (shaRes.ok) {
        const shaData = await shaRes.json();
        currentSha = shaData.sha;
      }
    } catch (e) {
      console.warn('GitHub file SHA fetch failed:', e.message);
    }

    const updateRes = await fetch(githubFileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `chore: auto-sync bookmarks from Gitee (${targetBranch})`,
        content: Buffer.from(mockDataJS).toString('base64'),
        ...(currentSha ? { sha: currentSha } : {}),
        branch: githubBranch
      })
    });

    if (!updateRes.ok) {
      const errMsg = await updateRes.text();
      throw new Error(`GitHub update failed (${updateRes.status}): ${errMsg}`);
    }

    console.log(`✅ Synced ${links.length} bookmarks`);
    res.status(200).json({ success: true, count: links.length });

  } catch (error) {
    console.error('💥 ERROR:', error.stack || error.message);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};