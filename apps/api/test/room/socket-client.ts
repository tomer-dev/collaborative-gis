/** `F` narrowed to `type: T`; a frame type whose `type` is plain `string` stays as it is. */
type Of<F extends { type: string }, T extends string> = string extends F['type']
  ? F
  : Extract<F, { type: T }>;

/**
 * Accepts `ws` and records every text frame, parsed with `parse`, in arrival order. `waitFor`
 * resolves once `count` frames of `type` have arrived, with the last of them; `closed` resolves
 * with the close event.
 */
export function socketClient<F extends { type: string }>(
  ws: WebSocket,
  parse: (data: string) => F,
) {
  const frames: F[] = [];
  let wake = () => {};
  ws.addEventListener('message', (event) => {
    if (typeof event.data === 'string') frames.push(parse(event.data));
    wake();
  });
  const closed = new Promise<CloseEvent>((resolve) => {
    ws.addEventListener('close', (event) => {
      resolve(event);
      wake();
    });
  });
  ws.accept();

  const of = <T extends F['type']>(type: T) =>
    frames.filter((frame): frame is Of<F, T> => frame.type === type);
  return {
    frames,
    of,
    closed,
    async waitFor<T extends F['type']>(type: T, count = 1): Promise<Of<F, T>> {
      for (;;) {
        const frame = of(type)[count - 1];
        if (frame) return frame;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
