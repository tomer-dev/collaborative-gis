/* global __ENV, console */
// Realtime load: each VU signs up a user, opens `/ws` with that session cookie and the SPA Origin,
// sends `join`, waits until every VU of the run is in presence, then sends `draft:update` frames
// for a fixed time. Every VU records which of the other VUs' frames reached it and how late.
// Run against `wrangler dev`: `k6 run bench/ws.js` (bench/README.md lists the env vars).
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';
import ws from 'k6/ws';
import { signUp } from './auth.js';

const env = (name, fallback) => __ENV[name] ?? fallback;

/** Every tunable value; each one can be overridden with `-e NAME=value`. */
const CONFIG = {
  /** The Worker under test (`wrangler dev` default port). */
  BASE_URL: env('BASE_URL', 'http://localhost:8787'),
  /** Must equal the Worker's `CLIENT_ORIGIN`, or the upgrade is refused with 403. */
  ORIGIN: env('ORIGIN', 'http://localhost:5173'),
  SIGN_UP_PATH: env('SIGN_UP_PATH', '/api/auth/sign-up/email'),
  WS_PATH: env('WS_PATH', '/ws'),
  MAP_ID: env('MAP_ID', 'default'),
  VUS: Number(env('VUS', 5)),
  /**
   * Per VU: the Room's limit of 10 `draft:update` frames per second per socket (`WS`). A VU's
   * frames are one draft session (an `add`, then `move`s), which spends one action from the
   * user's budget of 50 per minute (`RATE_LIMIT`, D5), however many frames it sends.
   */
  FRAMES_PER_SEC: Number(env('FRAMES_PER_SEC', 10)),
  SEND_SECONDS: Number(env('SEND_SECONDS', 30)),
  /** A frame counts as echoed to a VU when it arrives there within this many ms of being sent. */
  ECHO_WINDOW_MS: Number(env('ECHO_WINDOW_MS', 1000)),
  /** Lowest share of (frame, other VU) pairs echoed within the window before the run fails. */
  MIN_ECHO_RATIO: Number(env('MIN_ECHO_RATIO', 0.95)),
  /** How long a VU waits for every other VU to show up in presence before it gives up. */
  READY_TIMEOUT_MS: Number(env('READY_TIMEOUT_MS', 15000)),
  /** How long a VU keeps listening after its last frame, so the others' last frames arrive. */
  LINGER_MS: Number(env('LINGER_MS', 3000)),
  /** [lng, lat] the draft vertices start from; the frame number and send time are added to it. */
  VERTEX_ORIGIN: JSON.parse(env('VERTEX_ORIGIN', '[34.78, 32.08]')),
  PASSWORD: env('PASSWORD', 'load-test-password'),
  /** Prefix of every generated email and user name; a fresh one per run unless set. */
  RUN_ID: env('RUN_ID', ''),
};

const FRAMES = Math.floor(CONFIG.FRAMES_PER_SEC * CONFIG.SEND_SECONDS);
const SWITCHING_PROTOCOLS = 101;
const MS_PER_SECOND = 1000;
/** Slack on top of the planned run time before k6 stops a VU. */
const MAX_DURATION_SLACK_MS = 30_000;

/**
 * VUs share no memory, so each frame carries its own number `n` and send time in its vertex:
 * lng = origin + n·N_STEP, lat = origin + (sentAt mod TIME_MOD)·T_STEP. A receiver decodes both
 * and measures the delay against the same machine clock (all VUs run in one k6 process).
 */
const VERTEX = { N_STEP: 1e-5, T_STEP: 1e-7, TIME_MOD: 1e6 };

export const options = {
  scenarios: {
    drafts: {
      executor: 'per-vu-iterations',
      vus: CONFIG.VUS,
      iterations: 1,
      maxDuration: `${Math.ceil(
        (CONFIG.READY_TIMEOUT_MS +
          CONFIG.SEND_SECONDS * MS_PER_SECOND +
          CONFIG.LINGER_MS +
          MAX_DURATION_SLACK_MS) /
          MS_PER_SECOND,
      )}s`,
    },
  },
  thresholds: {
    ws_echo_within_window: [`rate>=${CONFIG.MIN_ECHO_RATIO}`],
    ws_error_frames: ['count==0'],
    checks: ['rate==1'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const framesSent = new Counter('ws_frames_sent');
/** `draft:update` frames received from the other VUs of this run. */
const echoes = new Counter('ws_echoes');
const echoLatency = new Trend('ws_echo_latency', true);
/** One sample per (frame, other VU): true when that VU received the frame within the window. */
const echoWithinWindow = new Rate('ws_echo_within_window');
/** `error` frames from the Room (RATE_LIMITED, BAD_REQUEST, ...). */
const errorFrames = new Counter('ws_error_frames');

export function setup() {
  return { runId: CONFIG.RUN_ID || `load-${Date.now().toString(36)}` };
}

function encodeVertex(n, sentAt) {
  const [lng, lat] = CONFIG.VERTEX_ORIGIN;
  return [lng + n * VERTEX.N_STEP, lat + (sentAt % VERTEX.TIME_MOD) * VERTEX.T_STEP];
}

/** The frame number and the delay since it was sent, from a relayed vertex. */
function decodeVertex([lng, lat], now) {
  const [lng0, lat0] = CONFIG.VERTEX_ORIGIN;
  const sentMod = Math.round((lat - lat0) / VERTEX.T_STEP);
  const nowMod = now % VERTEX.TIME_MOD;
  return {
    n: Math.round((lng - lng0) / VERTEX.N_STEP),
    delay: (nowMod - sentMod + VERTEX.TIME_MOD) % VERTEX.TIME_MOD,
  };
}

export default function ({ runId }) {
  const user = signUp({
    baseUrl: CONFIG.BASE_URL,
    path: CONFIG.SIGN_UP_PATH,
    origin: CONFIG.ORIGIN,
    password: CONFIG.PASSWORD,
    runId,
  });
  const runPrefix = `${runId} `;
  const wsUrl = `${CONFIG.BASE_URL.replace(/^http/, 'ws')}${CONFIG.WS_PATH}`;
  /** userId → (frame number → delay in ms), first arrival only. */
  const received = new Map();
  /** The run's other users, as seen in presence. */
  const peers = new Set();
  let seq = 0;
  let sent = 0;
  let sending = false;

  const res = ws.connect(
    wsUrl,
    { headers: { Cookie: user.cookie, Origin: CONFIG.ORIGIN } },
    (socket) => {
      const send = (type, payload) =>
        socket.send(JSON.stringify({ type, seq: ++seq, ts: Date.now(), payload }));

      const sendDraft = () => {
        if (sent >= FRAMES) return;
        const n = sent;
        const vertex = encodeVertex(n, Date.now());
        send(
          'draft:update',
          n === 0 ? { op: 'add', index: 0, vertex } : { op: 'move', index: 0, vertex },
        );
        sent += 1;
        framesSent.add(1);
        if (sent === FRAMES) socket.setTimeout(() => socket.close(), CONFIG.LINGER_MS);
      };

      socket.on('open', () => {
        send('join', { mapId: CONFIG.MAP_ID });
        socket.setTimeout(() => {
          if (!sending) socket.close();
        }, CONFIG.READY_TIMEOUT_MS);
      });

      socket.on('message', (raw) => {
        const frame = JSON.parse(raw);
        switch (frame.type) {
          case 'presence': {
            // The run's users only: a browser on the same map is not part of the measurement.
            const others = frame.payload.users.filter(
              (u) => u.name.startsWith(runPrefix) && u.userId !== user.userId,
            );
            for (const { userId } of others) peers.add(userId);
            if (!sending && peers.size >= CONFIG.VUS - 1) {
              sending = true;
              socket.setInterval(sendDraft, MS_PER_SECOND / CONFIG.FRAMES_PER_SEC);
            }
            break;
          }
          case 'draft:update': {
            const from = frame.payload.userId;
            if (!peers.has(from) || !frame.payload.vertex) break;
            const { n, delay } = decodeVertex(frame.payload.vertex, Date.now());
            const seen = received.get(from) ?? new Map();
            received.set(from, seen);
            if (seen.has(n)) break;
            seen.set(n, delay);
            echoes.add(1);
            echoLatency.add(delay);
            break;
          }
          case 'error':
            errorFrames.add(1, { code: frame.payload.code });
            console.warn(`vu${exec.vu.idInTest} error frame: ${raw}`);
            break;
        }
      });
    },
  );

  check(res, { 'upgrade 101': (r) => r && r.status === SWITCHING_PROTOCOLS });
  check(peers, { 'every VU joined': (p) => p.size >= CONFIG.VUS - 1 });
  check(sent, { 'sent every frame': (s) => s === FRAMES });

  // Every other VU of the run plans FRAMES frames; each one this VU missed or got late is a false.
  for (const peer of peers) {
    const seen = received.get(peer) ?? new Map();
    for (let n = 0; n < FRAMES; n++) {
      const delay = seen.get(n);
      echoWithinWindow.add(delay !== undefined && delay <= CONFIG.ECHO_WINDOW_MS);
    }
  }
}
