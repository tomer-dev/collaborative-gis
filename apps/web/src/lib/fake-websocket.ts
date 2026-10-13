// Test support: an in-memory stand-in for the browser WebSocket, driven by the test.
import { parseWsClientMessage, WS, type WsClientEvent } from '@cgis/shared';
import type { SocketFactory, SocketLike } from './ws';

export class FakeSocket implements SocketLike {
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  /** Every string the client sent, pings included. */
  readonly sent: string[] = [];
  closedByClient = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closedByClient = true;
  }

  /** The server accepted the upgrade. */
  open(): void {
    this.onopen?.(new Event('open'));
  }

  /** The socket closed from the server or network side with `code`. */
  drop(code: number): void {
    this.onclose?.(new CloseEvent('close', { code }));
  }

  /** A server frame: an object is sent as JSON, a string as is. */
  receive(frame: object | string): void {
    const data = typeof frame === 'string' ? frame : JSON.stringify(frame);
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  /** The client's frames, parsed with the shared schema (pings left out). */
  frames(): WsClientEvent[] {
    return this.sent.filter((data) => data !== WS.AUTO_PING).map(parseWsClientMessage);
  }

  pings(): number {
    return this.sent.filter((data) => data === WS.AUTO_PING).length;
  }
}

/** A factory that records every socket it creates. */
export function fakeSockets() {
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = (url) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  };
  const latest = (): FakeSocket => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('no socket was created');
    return socket;
  };
  return { sockets, factory, latest };
}

/** A server frame with the envelope stamps the Room adds. */
export function serverFrame<T extends { type: string; payload: unknown }>(event: T, seq = 1) {
  return { ...event, seq, ts: 1 };
}
