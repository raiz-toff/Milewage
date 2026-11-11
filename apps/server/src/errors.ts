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
  platform_in_use: [409, 'Platform is in use', false],
  trip_not_editable: [409, 'Trip cannot be edited', false],
  not_recomputable: [409, 'Raw points were archived; the shift cannot be recomputed', false],
  upgrade_required: [426, 'Upgrade required', false],
  cursor_expired: [410, 'Cursor expired', false],
  link_expired: [410, 'Link request expired', false],
  payload_too_large: [413, 'Payload too large', false],
  unsupported_media_type: [415, 'Unsupported media type', false],
  validation_failed: [422, 'Validation failed', false],
  invalid_link_code: [422, 'Wrong link code', false],
  rate_limited: [429, 'Too many requests', true],
  slow_down: [429, 'Polling too fast', true],
  backup_rate_limited: [429, 'Too many backup requests', true],
  internal_error: [500, 'Internal error', true],
  read_only_mode: [503, 'Server is in read-only mode', true],
  restoring: [503, 'Restore in progress', true],
  insufficient_storage: [507, 'Insufficient storage', true],
} as const;

export type ErrorCode = keyof typeof CATALOG;

/** Relative URI reference (RFC 9457 section 3.1.1); it resolves on every instance (`GET /api/v1/errors/{code}`). */
export const errorTypeUri = (code: string) => `/api/v1/errors/${code}`;

const DESCRIPTIONS: Record<ErrorCode, string> = {
  malformed_request: 'The request could not be parsed, for example because the JSON is broken.',
  auth_required: 'The request needs a signed-in session or a device token, and none was sent.',
  session_expired: 'The session has ended. Sign in again.',
  invalid_credentials: 'The username or the password is wrong.',
  device_revoked: 'The owner removed this phone. Pair it again to keep uploading.',
  invalid_pairing_token: 'The pairing code is wrong, already used or out of date.',
  link_expired: 'This link request is too old. Start linking again on the phone.',
  scope_forbidden: 'This credential is valid but is not allowed to do this.',
  origin_mismatch: 'The request came from a website the server does not trust.',
  setup_incomplete: 'First-run setup is not finished. Confirm the recovery key first.',
  not_found: 'There is nothing at this address, or it belongs to someone else.',
  shift_not_found: 'There is no such shift.',
  setup_already_done: 'The owner account already exists.',
  shift_already_active: 'A shift is already running. End it before starting another.',
  shift_finalized: 'The shift is finalized and can no longer be changed.',
  shift_not_ended: 'The shift is still running. End it first.',
  platform_in_use: 'Shifts or earnings still use this platform, so it cannot be removed.',
  trip_not_editable: 'This trip cannot be edited in its current state.',
  not_recomputable: 'The raw points of this shift were archived, so it cannot be recalculated.',
  upgrade_required: 'This app is too old for the server. Update the app.',
  cursor_expired: 'The page cursor is too old. Start the list again.',
  payload_too_large: 'The request body is bigger than the server accepts.',
  unsupported_media_type: 'The content type of the request is not supported.',
  validation_failed: 'One or more fields are not valid. The errors list says which.',
  invalid_link_code:
    'The code does not match the phone. Check the code on the phone and try again.',
  rate_limited: 'Too many requests in a short time. Wait and try again.',
  slow_down: 'The phone asked for the link result too often. It should wait longer between checks.',
  backup_rate_limited: 'Too many backup requests in a short time. Wait and try again.',
  internal_error: 'Something went wrong on the server. Try again later.',
  read_only_mode: 'The server is in read-only mode, so changes are refused.',
  restoring: 'A restore is in progress. Try again in a moment.',
  insufficient_storage: 'The server is almost out of disk space, so changes are refused.',
};

/** What `GET /api/v1/errors/{code}` returns, or null for a code that is not in the catalogue. */
export function describeError(code: string) {
  if (!Object.hasOwn(CATALOG, code)) return null;
  const c = code as ErrorCode;
  return { code: c, title: CATALOG[c][1], status: CATALOG[c][0], description: DESCRIPTIONS[c] };
}
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
    type: errorTypeUri(error.code),
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
