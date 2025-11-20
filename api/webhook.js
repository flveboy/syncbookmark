// api/webhook.js

// === 读取原始 body（Node.js 方式）===
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// === 签名验证 ===
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

  // 转为 Base64 字符串（和 Gitee 一致）
  const base64Sig = Buffer.from(new Uint8Array(sig)).toString('base64');
  
  console.log('🧮 计算出的签名:', base64Sig);
  console.log('📬 Gitee 发来的签名:', signature);

  return base64Sig === signature;
}

module.exports = async (req, res) => {
  // ████████████████████████████████████████
  // 🔴 调试日志：必须放在最前面！
  console.log('🔍 ===== 开始处理 Webhook 请求 =====');
  console.log('📡 Method:', req.method);
  console.log('🌐 Headers:', JSON.stringify(req.headers, null, 2));
  
  const giteeToken = req.headers['x-gitee-token'];
  const giteeSignature = req.headers['x-gitee-signature'];
  console.log('📬 X-Gitee-Token:', giteeToken);
  console.log('📬 X-Gitee-Signature:', giteeSignature);
  
  const secret = process.env.GITEE_WEBHOOK_SECRET;
  console.log('🔑 GITEE_WEBHOOK_SECRET (masked):', 
    secret ? '***' + secret.slice(-6) : '❌ NOT SET'
  );
  // ████████████████████████████████████████

  try {
    if (req.method !== 'POST') {
      return res.status(405).end('Method Not Allowed');
    }

    const body = await getRawBody(req);
    console.log('📄 Body length:', body.length, 'bytes');
    console.log('📄 Body preview:', body.substring(0, 200));

    // 尝试从两个可能的 header 取签名
    const signature = giteeToken || giteeSignature;
    if (!signature) {
      console.warn('⚠️ No signature header found!');
      return res.status(403).send('Forbidden: no signature');
    }

    const isValid = await verifySignature(body, signature, secret);
    console.log('✅ Signature valid?', isValid);

    if (!isValid) {
      console.warn('❌ Invalid signature!');
      return res.status(403).send('Forbidden');
    }

    // ========== 后续业务逻辑可暂时注释 ==========
    // （先确保签名能过）
    console.log('🎉 签名验证通过！');
    return res.status(200).json({ success: true, message: 'Signature OK' });

    // ...（后面同步 Gitee/GitHub 的代码先注释掉）

  } catch (error) {
    console.error('💥 FATAL ERROR:', error);
    return res.status(500).json({ error: error.message });
  }
};