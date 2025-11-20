// api/webhook.js

// 🚀 强制使用 Node.js Runtime（关键！）
export const config = {
  runtime: 'nodejs',
};

// === 1. 读取原始请求体（原始字节流，一字不差）===
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString(); // 默认 UTF-8，Gitee 使用 UTF-8
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

// === 2. 验证 Gitee 签名（HMAC-SHA256 + Base64）===
async function verifyGiteeSignature(payload, signatureHeader, secret) {
  if (!secret || !signatureHeader) {
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const computedSignature = Buffer.from(sig).toString('base64');
    return computedSignature === signatureHeader;
  } catch (err) {
    console.error('❌ 签名计算出错:', err);
    return false;
  }
}

// === 3. 主处理函数 ===
module.exports = async (req, res) => {
  // 🔍 基础信息日志
  console.log('🔍 ===== 新 Webhook 请求 =====');
  console.log('📡 Method:', req.method);
  console.log('🌐 Client IP:', req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown');

  // 只接受 POST
  if (req.method !== 'POST') {
    console.warn('⚠️ 非 POST 请求，拒绝');
    return res.status(405).end('Method Not Allowed');
  }

  // 获取签名头和密钥
  const giteeToken = req.headers['x-gitee-token'];
  const secret = process.env.GITEE_WEBHOOK_SECRET;

  console.log('📬 X-Gitee-Token:', giteeToken);
  console.log('🔑 SECRET (masked):', secret ? '***' + secret.slice(-6) : '❌ NOT SET');

  if (!giteeToken) {
    console.warn('⚠️ 缺少 X-Gitee-Token 头');
    return res.status(403).send('Forbidden: missing signature header');
  }
  if (!secret) {
    console.error('💥 环境变量 GITEE_WEBHOOK_SECRET 未设置！');
    return res.status(500).send('Internal Error');
  }

  try {
    // ✅ 读取完整原始 body
    const rawBody = await getRawBody(req);

    // 📏 打印 body 信息用于调试
    console.log('📄 Body length:', rawBody.length, 'bytes');
    console.log('-BEGIN BODY (first 200 chars)-');
    console.log(rawBody.substring(0, 200));
    console.log('-END BODY (last 200 chars)-');
    console.log(rawBody.substring(Math.max(0, rawBody.length - 200)));

    // 🔐 验证签名
    const isValid = await verifyGiteeSignature(rawBody, giteeToken, secret);

    console.log('🧮 签名验证结果:', isValid ? '✅ VALID' : '❌ INVALID');

    if (!isValid) {
      // 手动计算一次供比对（调试用）
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
      const ourSig = Buffer.from(sig).toString('base64');
      console.log('🧾 我们计算的签名:', ourSig);
      console.log('📬 Gitee 发来的签名:', giteeToken);
      return res.status(403).send('Forbidden: invalid signature');
    }

    // 🎉 签名通过！这里可以执行你的业务逻辑
    console.log('🎉 Webhook 验证成功！事件类型:', req.headers['x-gitee-event']);

    // 👇 示例：你可以在这里调用同步脚本
    // const data = JSON.parse(rawBody);
    // await yourSyncFunction(data);

    return res.status(200).json({ success: true, message: 'Webhook processed' });

  } catch (error) {
    console.error('💥 处理 Webhook 时发生错误:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
