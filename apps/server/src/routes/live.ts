import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import type { EventSubscriptions, ModuleJob, RouteHost } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createDeviceRepository,
  createProcessingRepository,
  createSettingsRepository,
  createShiftRepository,
  type Db,
} from '../db';
import { ProblemError } from '../errors';
import { presentShift } from '../processing/presenter';
import { stopView } from './stops';

/** A phone is "online" if it called the API within 3 upload intervals of 60 s (08 section 6). */
const ONLINE_MS = 3 * 60_000;
const POSITION_MIN_GAP_MS = 2_000;
const PATH = '/api/v1/live';

export interface LiveOptions {
  db: Db;
  now: () => number;
  authn: Authenticator;
  /** Ping interval; the server closes a client after 2 missed pongs. */
  pingMs?: number;
  /** Whether the stops module is on, for the `stops` frame. */
  stopsOn?: () => boolean;
}

interface Client {
  socket: WebSocket;
  userId: number;
  missed: number;
}

/**
 * The live feed for the web map (08 section 6): `GET /live` is a WebSocket for a web session whose
 * `Origin` equals the site. One JSON frame per message, always with a `type`. The hub learns of facts
 * through the event bus, so the modules that cause them (shifts, telemetry, stops) know nothing about it.
 */
export function createLive({
  db,
  now,
  authn,
  pingMs = 30_000,
  stopsOn = () => false,
}: LiveOptions) {
  const clients = new Set<Client>();
  const shifts = createShiftRepository(db);
  const processing = createProcessingRepository(db);
  const devices = createDeviceRepository(db);
  const settings = createSettingsRepository(db);
  const lastPosition = new Map<number, number>();
  const announced = new Map<number, boolean>();

  const send = (c: Client, message: object) => {
    if (c.socket.readyState === WebSocket.OPEN) c.socket.send(JSON.stringify(message));
  };
  const broadcast = (userId: number, message: object) => {
    for (const c of clients) if (c.userId === userId) send(c, message);
  };
  const shiftById = (id: string) => {
    return shifts.byId(Number(id));
  };
  const online = (lastSeenAt: number | null) =>
    lastSeenAt !== null && now() - lastSeenAt <= ONLINE_MS;
  const deviceState = (userId: number) => devices.list(userId).filter((d) => d.revokedAt === null);

  const shiftFrame = (event: string) => (p: { shiftId: string }) => {
    const row = shiftById(p.shiftId);
    if (!row || clients.size === 0) return;
    const view = presentShift(db, row);
    broadcast(row.userId, { type: 'shift', event, shift: view });
  };

  const subscriptions: EventSubscriptions = {
    'shift.started': shiftFrame('started'),
    'shift.ended': shiftFrame('ended'),
    'shift.updated': shiftFrame('updated'),
    'shift.finalized': shiftFrame('finalized'),
    'stops.derived'(p) {
      const row = shiftById(p.shiftId);
      if (!row || clients.size === 0 || !stopsOn()) return;
      if (settings.get(row.userId)?.stopsEnabled !== 1) return;
      const labels = new Map(processing.labelsOf(row.id).map((l) => [l.stopKey, l]));
      const stops = processing.stopsOf(row.id).map((s) => stopView(s, labels.get(s.stopKey)));
      broadcast(row.userId, { type: 'stops', shift_id: row.id, stops });
    },
    'telemetry.accepted'(p) {
      const row = shiftById(p.shiftId);
      if (!row || clients.size === 0) return;
      // At most one position per 2 seconds per shift, and only the newest point of a batch.
      const t = now();
      if (t - (lastPosition.get(row.id) ?? 0) >= POSITION_MIN_GAP_MS) {
        const point = db
          .prepare(
            'SELECT seq, recorded_at, lat_e7, lon_e7, speed_dmps, bearing_deg, accuracy_m FROM telemetry_points WHERE shift_id = ? ORDER BY recorded_at DESC, seq DESC LIMIT 1',
          )
          .get(row.id);
        if (point) {
          lastPosition.set(row.id, t);
          broadcast(row.userId, { type: 'position', shift_id: row.id, ...point });
        }
      }
      sweepDevices(row.userId);
    },
  };

  /** Announces a device whose online state changed since the last announcement. */
  function sweepDevices(userId: number) {
    if (clients.size === 0) return;
    for (const d of deviceState(userId)) {
      const state = online(d.lastSeenAt);
      if (announced.get(d.id) !== state) {
        announced.set(d.id, state);
        broadcast(userId, {
          type: 'device',
          device_id: d.id,
          state: state ? 'online' : 'offline',
          last_seen_at: d.lastSeenAt,
          clock_skew_ms: null,
        });
      }
    }
  }

  const hello = (userId: number) => {
    const active = shifts.active(userId);
    const states = deviceState(userId);
    for (const d of states) announced.set(d.id, online(d.lastSeenAt));
    return {
      type: 'hello',
      server_time: now(),
      active_shift: active ? presentShift(db, active) : null,
      device_online: Object.fromEntries(states.map((d) => [d.id, online(d.lastSeenAt)])),
    };
  };

  const refuse = (socket: Duplex, problem: ProblemError) => {
    const body = JSON.stringify({
      code: problem.code,
      status: problem.status,
      title: problem.title,
    });
    socket.end(
      `HTTP/1.1 ${problem.status} ${problem.title}\r\nContent-Type: application/problem+json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
    );
  };

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.split('?')[0] !== PATH) {
      socket.destroy();
      return;
    }
    try {
      const origin = req.headers.origin;
      if (!origin || !origin.endsWith(`//${req.headers.host}`)) {
        throw new ProblemError(
          'origin_mismatch',
          'The Origin header is missing or does not match.',
        );
      }
      const principal = authn.authenticate(
        { headers: req.headers, method: 'GET' } as unknown as FastifyRequest,
        'S',
      );
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client: Client = { socket: ws, userId: principal.userId, missed: 0 };
        clients.add(client);
        ws.on('message', (data) => {
          try {
            if ((JSON.parse(String(data)) as { type?: string }).type === 'pong') client.missed = 0;
          } catch {
            // frames from the client other than pong are ignored
          }
        });
        ws.on('close', () => clients.delete(client));
        ws.on('error', () => clients.delete(client));
        send(client, hello(principal.userId));
      });
    } catch (e) {
      refuse(socket, e instanceof ProblemError ? e : new ProblemError('internal_error'));
    }
  };

  const routes = (host: RouteHost) => {
    const { app } = host as ServerRouteHost;
    app.server.on('upgrade', onUpgrade);
    app.addHook('onClose', async () => {
      app.server.off('upgrade', onUpgrade);
      for (const c of clients) c.socket.terminate();
      clients.clear();
      wss.close();
    });
    // A plain GET is not a WebSocket upgrade.
    app.get('/live', async () => {
      throw new ProblemError('upgrade_required', 'Connect to this route with a WebSocket.');
    });
  };

  const jobs: ModuleJob[] = [
    {
      name: 'live-ping',
      start() {
        const timer = setInterval(() => {
          for (const c of [...clients]) {
            if (c.missed >= 2) {
              c.socket.terminate();
              clients.delete(c);
              continue;
            }
            c.missed += 1;
            send(c, { type: 'ping', server_time: now() });
          }
          for (const userId of new Set([...clients].map((c) => c.userId))) sweepDevices(userId);
        }, pingMs);
        timer.unref();
        return () => clearInterval(timer);
      },
    },
  ];

  return { routes, subscriptions, jobs, clientCount: () => clients.size };
}
