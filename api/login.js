// POST /api/login — checks the submitted password against the SITE_PASSWORD
// environment variable and, on success, sets the auth cookie.
//
// The cookie carries a SHA-256 token derived from the env password — never
// the password itself. middleware.js validates the same token.
// The password exists ONLY in the Vercel project's environment variables.
const crypto = require('crypto');

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false });
    return;
  }
  const expected = process.env.SITE_PASSWORD;
  if (!expected) {
    // Fail closed: no password configured, nobody gets in.
    res.status(500).json({ ok: false, error: 'not_configured' });
    return;
  }
  let submitted = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    submitted = String(body.password || '');
  } catch (_) {
    submitted = '';
  }
  // Constant-time comparison of the two SHA-256 digests.
  if (!safeEqual(sha256Hex(submitted), sha256Hex(expected))) {
    res.status(401).json({ ok: false });
    return;
  }
  const token = sha256Hex(expected);
  res.setHeader(
    'Set-Cookie',
    `pbs_auth=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
  );
  res.status(200).json({ ok: true });
};
