// Edge Middleware — password gate for the whole site.
//
// This is a plain static site (no Next.js), so this file uses ONLY standard
// Web APIs available in Vercel's Edge runtime — no imports of any kind.
// (The previous version imported NextResponse from 'next/server', which does
// not exist in this project; that import is what produced
// 500 MIDDLEWARE_INVOCATION_FAILED on every page.)
//
// Intercepts every path (pages, players.json, headshots, all assets) except
// the login page and the login endpoint, which are let through in code
// below. A request passes only when it carries the pbs_auth cookie whose
// value is the SHA-256 token derived from the SITE_PASSWORD environment
// variable (set by api/login.js after a correct password entry). Everything
// else is redirected to /login.
//
// The password itself is never in any file — it lives only in the Vercel
// project's environment variables. If SITE_PASSWORD is not set, the gate
// fails closed: every request is redirected to /login and login cannot
// succeed until the variable is configured.

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function next() {
  // Vercel Edge Middleware (non-Next): this header hands the request on to
  // the static site / function it was headed for.
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

export default async function middleware(request) {
  const { pathname } = new URL(request.url);

  // The login page and the login endpoint must stay reachable, or nobody
  // could ever sign in.
  if (pathname === '/login' || pathname === '/login.html' || pathname === '/api/login') {
    return next();
  }

  const expected = process.env.SITE_PASSWORD;
  if (expected) {
    const token = await sha256Hex(expected);
    const cookie = cookieValue(request, 'pbs_auth');
    if (cookie && safeEqual(cookie, token)) {
      return next();
    }
  }
  return Response.redirect(new URL('/login', request.url));
}
