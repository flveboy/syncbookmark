// api/webhook.js

// ✅ 明确使用 Node.js Runtime
export const config = {
  runtime: 'nodejs',
};

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
  const base64Sig = Buffer.from(new Uint8Array(sig)).toString('base64');
  return base64Sig === signature;
}

module.exports = async (req, res) => {
  console.log('📡 Method:', req.method);
  const giteeToken = req.headers['x-gitee-token'];
  const secret = process.env.GITEE_WEBHOOK_SECRET;

  if (req.method !== 'POST' || !giteeToken || !secret) {
    return res.status(403).send('Forbidden');
  }

  try {
    const body = await getRawBody(req); // ✅ 现在能读完整 body 了
    const isValid = await verifySignature(body, giteeToken, secret);

    if (!isValid) {
      console.warn('❌ Invalid signature');
      console.log('🧮 Computed:', Buffer.from(await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]),
        new TextEncoder().encode(body)
      )).toString('base64'));
      console.log('📬 Received:', giteeToken);
      return res.status(403).send('Forbidden');
    }

    console.log('✅ Signature verified!');
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal Error' });
  }
};