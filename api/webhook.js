// api/webhook.js
import { parseBookmarks, generateMockDataJS } from '../scripts/parse-bookmarks.js';

// 签名验证（HMAC-SHA256）
async function verifySignature(payload, signature, secret) {
  if (!secret) return false;
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

export default async function handler(req, res) {
  // 仅允许 POST
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  // 读取原始 body（用于签名验证）
  const body = await req.text();

  // 验证签名
  const signature = req.headers['x-gitee-token'];
  const secret = process.env.GITEE_WEBHOOK_SECRET;
  if (!signature || !(await verifySignature(body, signature, secret))) {
    console.warn('⚠️ Invalid signature');
    return res.status(403).send('Forbidden');
  }

  // 后台异步处理（Vercel 支持 waitUntil 类似机制，但直接 await 也行，因为超时时间更长）
  try {
    // 1. 从 Gitee 获取 bookmarks.html
    const giteeRes = await fetch(
      `https://gitee.com/api/v5/repos/${process.env.GITEE_OWNER}/${process.env.GITEE_REPO}/contents/${encodeURIComponent(process.env.GITEE_FILE_PATH)}`,
      {
        headers: {
          Authorization: `token ${process.env.GITEE_TOKEN}`,
          'User-Agent': 'flveboy-bookmark-sync'
        }
      }
    );

    if (!giteeRes.ok) throw new Error(`Gitee API error: ${giteeRes.status}`);
    const giteeData = await giteeRes.json();
    const htmlContent = Buffer.from(giteeData.content, 'base64').toString('utf-8');

    // 2. 解析书签
    const links = parseBookmarks(htmlContent);
    const mockDataJS = generateMockDataJS(links);

    // 3. 更新 GitHub 文件
    let currentSha = null;
    const githubFileUrl = `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${process.env.GITHUB_FILE_PATH}`;
    
    try {
      const shaRes = await fetch(githubFileUrl, {
        headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` }
      });
      if (shaRes.ok) {
        const shaData = await shaRes.json();
        currentSha = shaData.sha;
      }
    } catch (e) {
      console.warn('Failed to get SHA:', e.message);
    }

    const updateRes = await fetch(githubFileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'chore: auto-sync bookmarks from Gitee',
        content: Buffer.from(mockDataJS).toString('base64'),
        sha: currentSha,
        branch: process.env.GITHUB_BRANCH || 'main'
      })
    });

    if (!updateRes.ok) throw new Error(`GitHub update failed: ${updateRes.status}`);

    console.log(`✅ Updated with ${links.length} bookmarks`);
    return res.status(200).send('Sync completed');
  } catch (error) {
    console.error('💥 Sync error:', error);
    return res.status(500).send('Sync failed');
  }
}