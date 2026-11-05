import { backoffSeconds } from './state';
import type { LiveFrame } from './state';

export type LinkStatus = 'connecting' | 'live' | 'reconnecting';

export interface Link {
  close: () => void;
}

/** The address of the live socket on the page's own origin (the server checks Origin = Host). */
export function liveUrl(origin: string): string {
  return `${origin.replace(/^http/, 'ws')}/api/v1/live`;
}

/**
 * The live socket with automatic reconnection (1, 2, 4 ... 30 s). The server pings every
 * 30 s and closes after two missed pongs, so each ping is answered at once. A frame that is
 * not JSON or has no `type` is skipped, never thrown. Nothing here keeps state: the owner
 * resets its view on every `hello`, which the server sends first on each connection.
 */
export function connectLive(
  origin: string,
  on: { frame: (f: LiveFrame) => void; status: (s: LinkStatus) => void },
): Link {
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closed = false;

  const open = () => {
    if (closed) return;
    on.status(attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(liveUrl(origin));
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      on.status('live');
    };
    ws.onmessage = (ev) => {
      let frame: LiveFrame;
      try {
        frame = JSON.parse(String(ev.data)) as LiveFrame;
      } catch {
        return;
      }
      if (typeof frame !== 'object' || frame === null || typeof frame.type !== 'string') return;
      if (frame.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      on.frame(frame);
    };
    ws.onclose = () => {
      if (closed || socket !== ws) return;
      on.status('reconnecting');
      timer = setTimeout(open, backoffSeconds(attempt++) * 1000);
    };
    ws.onerror = () => ws.close();
  };
  open();

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    },
  };
}
