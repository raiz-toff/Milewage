import type { EventBus } from '@milewage/shared';

/** `bus.emit`, handed to route modules that announce facts without knowing who listens. */
export type EventEmit = EventBus['emit'];
