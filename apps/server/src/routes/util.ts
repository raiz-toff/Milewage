import type { FastifyRequest } from 'fastify';

export interface SessionPrincipal {
  kind: 'session';
  userId: number;
  idHash: string;
}
export type Principal = SessionPrincipal | { kind: 'device'; userId: number; deviceId: number };
/** `S`: web session only. `SD`: session or device (08 section 3). */
export interface AuthFn {
  (request: FastifyRequest, allow: 'S'): SessionPrincipal;
  (request: FastifyRequest, allow: 'SD'): Principal;
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
