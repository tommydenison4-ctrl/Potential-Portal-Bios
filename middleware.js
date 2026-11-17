// Edge Middleware — password gate for the whole site.
//
// Intercepts every path (pages, players.json, headshots, all assets) except
// the login page and the login endpoint. A request is let through only when
// it carries the pbs_auth cookie whose value is the SHA-256 token derived
// from the SITE_PASSWORD environment variable (set by api/login.js after a
// correct password entry). Everything else is redirected to /login.
//
// The password itself is never in any file — it lives only in the Vercel
// project's environment variables. If SITE_PASSWORD is not set, the gate
// fails closed: every request is redirected to /login and login cannot
// succeed until the variable is configured.
import { NextResponse } from 'next/server';

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

export async function middleware(request) {
  const expected = process.env.SITE_PASSWORD;
  if (expected) {
    const token = await sha256Hex(expected);
    const cookie = request.cookies.get('pbs_auth');
    if (cookie && safeEqual(cookie.value, token)) {
      return NextResponse.next();
    }
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page and the login endpoint.
  matcher: ['/((?!login|api/login).*)'],
};
