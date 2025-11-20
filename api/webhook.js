// api/webhook.js
const { parseBookmarks, generateMockDataJS } = require('../scripts/parse-bookmarks');

// HMAC-SHA256 签名验证
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

    const body = await req.text();

    // === 1. 验证 Webhook 签名 ===
    const signature = req.headers['x-gitee-token'];
    const secret = process.env.GITEE_WEBHOOK_SECRET;
    const isValid = await verifySignature(body, signature, secret);
    if (!isValid) {
      console.warn('⚠️ Invalid signature');
      return res.status(403).send('Forbidden');
    }

    // === 2. 解析 payload ===
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      console.error('❌ Invalid JSON body');
      return res.status(400).send('Bad Request');
    }

    // === 3. 分支过滤 ===
    const targetBranch = process.env.GITEE_BRANCH || 'master';
    const expectedRef = `refs/heads/${targetBranch}`;
    
    if (payload.ref !== expectedRef) {
      console.log(`⏭️ Ignored push to ${payload.ref} (only ${expectedRef} is processed)`);
      return res.status(200).json({ ignored: true, ref: payload.ref });
    }

    console.log(`▶️ Processing push to ${targetBranch} branch`);

    // === 4. 从 Gitee 获取 bookmarks.html ===
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
    if (!giteeData.content) {
      throw new Error('Gitee file content is empty or missing');
    }

    const htmlContent = Buffer.from(giteeData.content, 'base64').toString('utf8');

    // === 5. 解析书签 ===
    const links = parseBookmarks(htmlContent);
    if (links.length === 0) {
      console.warn('⚠️ No bookmarks found in HTML');
    }
    const mockDataJS = generateMockDataJS(links);

    // === 6. 更新 GitHub 文件 ===
    const githubOwner = process.env.GITHUB_OWNER;
    const githubRepo = process.env.GITHUB_REPO;
    const githubFilePath = process.env.GITHUB_FILE_PATH || 'src/mock_data.js';
    const githubToken = process.env.GITHUB_TOKEN;
    const githubBranch = process.env.GITHUB_BRANCH || 'main';

    if (!githubOwner || !githubRepo || !githubToken) {
      throw new Error('Missing GitHub environment variables');
    }

    const githubFileUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${githubFilePath}`;

    // 获取当前文件 SHA（用于更新）
    let currentSha = null;
    try {
      const shaRes = await fetch(githubFileUrl, {
        headers: { 'Authorization': `token ${githubToken}` }
      });
      if (shaRes.ok) {
        const shaData = await shaRes.json();
        currentSha = shaData.sha;
      } else if (shaRes.status !== 404) {
        throw new Error(`Failed to check GitHub file existence: ${shaRes.status}`);
      }
    } catch (e) {
      console.warn('Could not get SHA:', e.message);
    }

    // 提交更新
    const updatePayload = {
      message: `chore: auto-sync bookmarks from Gitee (${targetBranch})`,
      content: Buffer.from(mockDataJS).toString('base64'),
      branch: githubBranch
    };
    if (currentSha) updatePayload.sha = currentSha;

    const updateRes = await fetch(githubFileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    });

    if (!updateRes.ok) {
      const errMsg = await updateRes.text();
      throw new Error(`GitHub update failed (${updateRes.status}): ${errMsg}`);
    }

    console.log(`✅ Successfully synced ${links.length} bookmarks`);
    return res.status(200).json({
      success: true,
      branch: targetBranch,
      count: links.length
    });

  } catch (error) {
    console.error('💥 FATAL ERROR:', error.stack || error.message);
    return res.status(500).json({
      error: error.message || 'Internal Server Error'
    });
  }
};