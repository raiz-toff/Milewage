import type { FastifyRequest } from 'fastify';

export interface SessionPrincipal {
  kind: 'session';
  userId: number;
  idHash: string;
}
export interface DevicePrincipal {
  kind: 'device';
  userId: number;
  deviceId: number;
}
export type Principal = SessionPrincipal | DevicePrincipal;
/** `S`: web session only. `SD`: session or device. `D`: device only (08 section 3). */
export interface AuthFn {
  (request: FastifyRequest, allow: 'S'): SessionPrincipal;
  (request: FastifyRequest, allow: 'SD'): Principal;
  (request: FastifyRequest, allow: 'D'): DevicePrincipal;
}

export const str = (min: number, max = 1024) => ({
  type: 'string',
  minLength: min,
  maxLength: max,
});

/** Unknown fields are a 422, never silently dropped (08 section 1). */
export const strictObject = (properties: object, required: string[], extra = {}) => ({
  type: 'object',
  required,
  additionalProperties: false,
  properties,
  ...extra,
});
export const idParams = strictObject({ id: { type: 'integer', minimum: 1 } }, ['id']);
/** `{ref}` of a shift: its numeric id or its client UUID. */
export const refParam = {
  type: 'string',
  pattern: '^([0-9]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$',
};

/** A DB row as an API object: camelCase to snake_case, minus the columns that never leave the server. */
export const snakeKeys = (row: object, ...hide: string[]) =>
  Object.fromEntries(
    Object.entries(row)
      .filter(([k]) => !hide.includes(k))
      .map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]),
  );
