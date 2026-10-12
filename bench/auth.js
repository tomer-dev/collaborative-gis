// Shared by rest.js and ws.js: one fresh user per VU.
import { check } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';

const OK = 200;

/**
 * Signs up `<runId>-vu<n>@example.com` through Better Auth's email sign-up, which also signs the
 * user in. The session cookie is returned as a Cookie header value rather than left in k6's VU
 * jar, because k6 empties that jar after every iteration. A failed sign-up aborts the whole test:
 * without users there is nothing to measure.
 */
export function signUp({ baseUrl, path, origin, password, runId }) {
  const vu = exec.vu.idInTest;
  const res = http.post(
    `${baseUrl}${path}`,
    JSON.stringify({ email: `${runId}-vu${vu}@example.com`, password, name: `${runId} vu${vu}` }),
    {
      headers: { 'Content-Type': 'application/json', Origin: origin },
      jar: new http.CookieJar(),
      tags: { op: 'auth' },
    },
  );
  if (!check(res, { 'sign-up 200': (r) => r.status === OK })) {
    exec.test.abort(`vu${vu} sign-up failed: ${res.status} ${res.body}`);
  }
  const cookie = Object.entries(res.cookies)
    .map(([name, [first]]) => `${name}=${first.value}`)
    .join('; ');
  return { userId: res.json('user.id'), cookie };
}
