import { AUTH, ROUTES } from '@cgis/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Env } from '../../src/app';
import { TEST } from '../helpers';
import { laneEnv } from './lane-db';
import { PASSWORD } from './session';

// A deployed Worker: the SPA and the API share one https origin (docs/deploy.md).
const DEPLOYED_ORIGIN = 'https://collaborative-gis.example.workers.dev';
// Wire values spelled out: an https BETTER_AUTH_URL prefixes every auth cookie with `__Secure-`.
const SECURE_SESSION_COOKIE = '__Secure-better-auth.session_token';
const SECURE_SESSION_DATA_COOKIE = '__Secure-better-auth.session_data';

/** The lane env as a deployed Worker sees it: https `BETTER_AUTH_URL`, one origin for both. */
let deployedEnv: Env;
beforeAll(async () => {
  deployedEnv = {
    ...(await laneEnv('cgis_auth')),
    CLIENT_ORIGIN: DEPLOYED_ORIGIN,
    BETTER_AUTH_URL: DEPLOYED_ORIGIN,
  };
});

// Better Auth's rate limit counts per client IP and path: each test signs in from its own IP.
let lastOctet = 0;
const freshIp = () => `198.18.0.${++lastOctet}`;

/** One JSON POST to Better Auth on the deployed env, as Cloudflare's edge forwards it from `ip`. */
function post(path: string, body: unknown, ip: string) {
  return createApp().request(
    `${DEPLOYED_ORIGIN}${ROUTES.AUTH}${path}`,
    {
      method: 'POST',
      headers: {
        origin: DEPLOYED_ORIGIN,
        'content-type': 'application/json',
        'cf-connecting-ip': ip,
      },
      body: JSON.stringify(body),
    },
    deployedEnv,
  );
}

/** A fresh account on the deployed env; returns its email. */
async function account(ip: string): Promise<string> {
  const email = `user-${crypto.randomUUID()}@example.com`;
  const res = await post('/sign-up/email', { email, password: PASSWORD, name: 'Ada Lovelace' }, ip);
  expect(res.status).toBe(200);
  return email;
}

// Real sign-ups and sign-ins (scrypt): { timeout } for a loaded machine.
describe('production hardening (TOM-73)', { timeout: TEST.SLOW_TIMEOUT_MS }, () => {
  it('sign-in sets __Secure- cookies: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain', async () => {
    const ip = freshIp();
    const email = await account(ip);

    const res = await post('/sign-in/email', { email, password: PASSWORD }, ip);
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    const names = cookies.map((cookie) => cookie.slice(0, cookie.indexOf('=')));
    expect(names).toEqual(
      expect.arrayContaining([SECURE_SESSION_COOKIE, SECURE_SESSION_DATA_COOKIE]),
    );
    for (const cookie of cookies) {
      expect(cookie).toMatch(/^__Secure-/);
      expect(cookie).toMatch(/;\s*Secure(;|$)/i);
      expect(cookie).toMatch(/;\s*HttpOnly(;|$)/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax(;|$)/i);
      expect(cookie).toMatch(/;\s*Path=\/(;|$)/i);
      // Host-only: the browser sends it to this origin alone, never to sibling subdomains.
      expect(cookie).not.toMatch(/;\s*Domain=/i);
    }
  });

  it('allows AUTH.RATE_LIMIT_MAX sign-in attempts per IP per window, then 429', async () => {
    const ip = freshIp();
    const attempt = (from: string) =>
      post('/sign-in/email', { email: 'nobody@example.com', password: 'wrong guess' }, from);

    for (let i = 0; i < AUTH.RATE_LIMIT_MAX; i++) expect((await attempt(ip)).status).toBe(401);
    const limited = await attempt(ip);
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get('x-retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(AUTH.RATE_LIMIT_WINDOW_S);
    // The budget is per client IP: another visitor still gets an answer.
    expect((await attempt(freshIp())).status).toBe(401);
  });
});
