/* global __ENV */
// REST load: each VU signs up one user, then loops viewport reads (`GET /api/areas?bbox=&zoom=`)
// and one area create (`POST /api/areas`) per iteration, paced to stay under the per-user
// mutation budget. Run against `wrangler dev`: `k6 run bench/rest.js` (see bench/README.md).
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { signUp } from './auth.js';

const env = (name, fallback) => __ENV[name] ?? fallback;

/** Every tunable value; each one can be overridden with `-e NAME=value`. */
const CONFIG = {
  /** The Worker under test (`wrangler dev` default port). */
  BASE_URL: env('BASE_URL', 'http://localhost:8787'),
  /** The SPA origin the Worker trusts (`CLIENT_ORIGIN` in apps/api/wrangler.jsonc). */
  ORIGIN: env('ORIGIN', 'http://localhost:5173'),
  SIGN_UP_PATH: env('SIGN_UP_PATH', '/api/auth/sign-up/email'),
  AREAS_PATH: env('AREAS_PATH', '/api/areas'),
  VUS: Number(env('VUS', 10)),
  DURATION: env('DURATION', '1m'),
  /** Area creates per VU per minute; the API allows 50 per user per minute (`RATE_LIMIT`). */
  WRITES_PER_MIN: Number(env('WRITES_PER_MIN', 40)),
  /** Viewports read once each per iteration: `bbox` is [w, s, e, n] in degrees (JSON override). */
  VIEWPORTS: JSON.parse(
    env(
      'VIEWPORTS',
      JSON.stringify([
        { bbox: [34.27, 29.49, 35.9, 33.34], zoom: 8 },
        { bbox: [34.7, 31.95, 34.9, 32.15], zoom: 12 },
        { bbox: [35.15, 31.72, 35.27, 31.82], zoom: 13 },
        { bbox: [34.95, 32.75, 35.1, 32.85], zoom: 14 },
      ]),
    ),
  ),
  /** Side of each created square, in degrees. */
  SQUARE_DEG: Number(env('SQUARE_DEG', 0.005)),
  READ_P95_MS: Number(env('READ_P95_MS', 300)),
  WRITE_P95_MS: Number(env('WRITE_P95_MS', 600)),
  /** Highest share of failed requests (status ≥ 400 or no response) before the run fails. */
  MAX_ERROR_RATE: Number(env('MAX_ERROR_RATE', 0.01)),
  PASSWORD: env('PASSWORD', 'load-test-password'),
  /** Prefix of every generated email and area name; a fresh one per run unless set. */
  RUN_ID: env('RUN_ID', ''),
};

const STATUS = { OK: 200, CREATED: 201, TOO_MANY_REQUESTS: 429 };
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export const options = {
  scenarios: {
    rest: { executor: 'constant-vus', vus: CONFIG.VUS, duration: CONFIG.DURATION },
  },
  thresholds: {
    'http_req_duration{op:read}': [`p(95)<${CONFIG.READ_P95_MS}`],
    'http_req_duration{op:write}': [`p(95)<${CONFIG.WRITE_P95_MS}`],
    http_req_failed: [`rate<${CONFIG.MAX_ERROR_RATE}`],
    areas_rate_limited: ['count==0'],
    checks: ['rate==1'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

/** 429 answers from `/api/areas`: one sample per request, 1 for a 429. Must stay 0. */
const rateLimited = new Counter('areas_rate_limited');

export function setup() {
  return { runId: CONFIG.RUN_ID || `load-${Date.now().toString(36)}` };
}

/** This VU's user, signed up on its first iteration and kept for the whole run. */
let session = null;

/** A closed counter-clockwise square with its south-west corner at a random point of `bbox`. */
function squareIn([w, s, e, n]) {
  const d = CONFIG.SQUARE_DEG;
  const x = w + Math.random() * (e - w - d);
  const y = s + Math.random() * (n - s - d);
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x + d, y],
        [x + d, y + d],
        [x, y + d],
        [x, y],
      ],
    ],
  };
}

function record(res, label, status) {
  rateLimited.add(res.status === STATUS.TOO_MANY_REQUESTS ? 1 : 0);
  check(res, {
    [`${label} ${status}`]: (r) => r.status === status,
    'never 429': (r) => r.status !== STATUS.TOO_MANY_REQUESTS,
  });
}

export default function ({ runId }) {
  session ??= signUp({
    baseUrl: CONFIG.BASE_URL,
    path: CONFIG.SIGN_UP_PATH,
    origin: CONFIG.ORIGIN,
    password: CONFIG.PASSWORD,
    runId,
  });
  const headers = {
    'Content-Type': 'application/json',
    Origin: CONFIG.ORIGIN,
    Cookie: session.cookie,
  };
  const started = Date.now();
  const iteration = exec.vu.iterationInScenario;
  const areasUrl = `${CONFIG.BASE_URL}${CONFIG.AREAS_PATH}`;

  for (const { bbox, zoom } of CONFIG.VIEWPORTS) {
    const res = http.get(`${areasUrl}?bbox=${bbox.join(',')}&zoom=${zoom}`, {
      headers,
      tags: { op: 'read', name: 'GET /api/areas' },
    });
    record(res, 'read', STATUS.OK);
  }

  const { bbox } = CONFIG.VIEWPORTS[iteration % CONFIG.VIEWPORTS.length];
  const name = `${runId} vu${exec.vu.idInTest} #${iteration}`;
  const res = http.post(areasUrl, JSON.stringify({ name, geometry: squareIn(bbox) }), {
    headers,
    tags: { op: 'write', name: 'POST /api/areas' },
  });
  record(res, 'write', STATUS.CREATED);

  // Pace the loop so one VU (one user) never exceeds WRITES_PER_MIN creates.
  const minIterationMs = (SECONDS_PER_MINUTE * MS_PER_SECOND) / CONFIG.WRITES_PER_MIN;
  const remainingMs = minIterationMs - (Date.now() - started);
  if (remainingMs > 0) sleep(remainingMs / MS_PER_SECOND);
}
