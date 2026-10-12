## Hono CLI

Run `npx hono --help` first, and use the CLI instead of a dev server.

- `echo "import { createApp } from './src/app'; export default createApp();" | hono routes -` lists routes. `hono request /healthz --runtime workerd` sends a request to the Worker on workerd.
- `hono batch - --runtime workerd <<'JSONL' ... JSONL` runs a request script; rerun until `"failed": 0`.
- The app runs on Cloudflare workerd. Never import Node-only modules outside `nodejs_compat`.
