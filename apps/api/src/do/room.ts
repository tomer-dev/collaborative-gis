import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../app';

/** The single map room (id `default`). Stub: M1 T6/T7 (realtime lane) add WebSockets, presence and drafts. */
export class Room extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    return new Response('not implemented', { status: 501 });
  }
}
