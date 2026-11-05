import { randomBytes } from 'node:crypto';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

const CATALOG = {
  malformed_request: [400, 'Malformed request', false],
  auth_required: [401, 'Sign-in required', false],
  session_expired: [401, 'Session expired', false],
  invalid_credentials: [401, 'Invalid username or password', false],
  device_revoked: [401, 'Device revoked', false],
  invalid_pairing_token: [401, 'Invalid pairing token', false],
  scope_forbidden: [403, 'Not allowed for this credential', false],
  origin_mismatch: [403, 'Origin mismatch', false],
  setup_incomplete: [403, 'Setup is not complete', false],
  not_found: [404, 'Not found', false],
  shift_not_found: [404, 'Shift not found', false],
  setup_already_done: [409, 'Setup already done', false],
  shift_already_active: [409, 'A shift is already active', false],
  shift_finalized: [409, 'Shift is finalized', false],
  shift_not_ended: [409, 'Shift has not ended', false],
  trip_not_editable: [409, 'Trip cannot be edited', false],
  capture_active: [409, 'Capture session conflict', false],
  not_recomputable: [409, 'Raw points were archived; the shift cannot be recomputed', false],
  upgrade_required: [426, 'Upgrade required', false],
  cursor_expired: [410, 'Cursor expired', false],
  payload_too_large: [413, 'Payload too large', false],
  unsupported_media_type: [415, 'Unsupported media type', false],
  validation_failed: [422, 'Validation failed', false],
  rate_limited: [429, 'Too many requests', true],
  backup_rate_limited: [429, 'Too many backup requests', true],
  internal_error: [500, 'Internal error', true],
  read_only_mode: [503, 'Server is in read-only mode', true],
  restoring: [503, 'Restore in progress', true],
  insufficient_storage: [507, 'Insufficient storage', true],
} as const;

export type ErrorCode = keyof typeof CATALOG;
export interface FieldError {
  path: string;
  message: string;
}

export class ProblemError extends Error {
  readonly status: number;
  readonly title: string;
  readonly retryable: boolean;
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly errors?: FieldError[],
    readonly headers: Record<string, string> = {},
    /** Extra problem members, e.g. `active_shift` on 409 shift_already_active. */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(detail ?? CATALOG[code][1]);
    [this.status, this.title, this.retryable] = CATALOG[code];
  }
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRequestId(now = Date.now()): string {
  let time = '';
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = B32[t % 32] + time;
  const rand = Array.from(randomBytes(16), (b) => B32[b % 32]).join('');
  return time + rand;
}

export function sendProblem(reply: FastifyReply, request: FastifyRequest, error: ProblemError) {
  (request as { problemCode?: string }).problemCode = error.code; // read by the api.window counters
  const body: Record<string, unknown> = {
    type: `https://milewage.dev/errors/${error.code}`,
    title: error.title,
    status: error.status,
    code: error.code,
    detail: error.detail ?? error.title,
    retryable: error.retryable,
    request_id: request.id,
    ...error.extra,
  };
  if (error.status === 422 && error.errors) body.errors = error.errors;
  return reply
    .status(error.status)
    .headers(error.headers)
    .type('application/problem+json')
    .send(body);
}

/** Maps any thrown error to a problem; unexpected errors reveal nothing to the client. */
export function toProblem(error: FastifyError | ProblemError): ProblemError {
  if (error instanceof ProblemError) return error;
  const fe = error as FastifyError;
  if (fe.validation) {
    const errors = fe.validation.map((v) => ({
      path: v.instancePath || '/',
      message: v.message ?? 'is invalid',
    }));
    return new ProblemError('validation_failed', 'The request body is not valid.', errors);
  }
  if (fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || fe.code === 'FST_REQ_FILE_TOO_LARGE') {
    return new ProblemError('payload_too_large');
  }
  if (fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return new ProblemError('unsupported_media_type');
  }
  if (fe.statusCode === 400) {
    return new ProblemError('malformed_request', 'The request could not be parsed.');
  }
  return new ProblemError('internal_error', 'Something went wrong on the server.');
}
