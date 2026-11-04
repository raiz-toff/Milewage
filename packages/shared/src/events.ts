// Typed in-process event bus (08 section 16.4): fire-and-forget, no broker. Payloads are minimal ids for now.
export interface EventMap {
  'shift.started': { shiftId: string };
  'shift.ended': { shiftId: string };
  'shift.updated': { shiftId: string; flags?: string[] };
  'shift.finalized': { shiftId: string };
  'stops.derived': { shiftId: string };
  'stop_label.updated': { shiftId: string; stopId: string };
  'trip.updated': { shiftId: string; tripId: string };
  'telemetry.accepted': { shiftId: string; deviceId: string; count: number };
  'device.seen': { deviceId: string };
}

export type EventName = keyof EventMap;
export type EventHandler<E extends EventName> = (payload: EventMap[E]) => void;
export type EventSubscriptions = { [E in EventName]?: EventHandler<E> };

export interface EventBus {
  on<E extends EventName>(name: E, handler: EventHandler<E>): () => void;
  emit<E extends EventName>(name: E, payload: EventMap[E]): void;
}

export function createEventBus(
  onHandlerError: (name: EventName, error: unknown) => void = () => {},
): EventBus {
  const handlers = new Map<EventName, Set<(payload: never) => void>>();
  return {
    on(name, handler) {
      const set = handlers.get(name) ?? new Set();
      set.add(handler as (payload: never) => void);
      handlers.set(name, set);
      return () => void set.delete(handler as (payload: never) => void);
    },
    emit(name, payload) {
      for (const h of [...(handlers.get(name) ?? [])]) {
        try {
          (h as (p: typeof payload) => void)(payload);
        } catch (error) {
          onHandlerError(name, error);
        }
      }
    },
  };
}
