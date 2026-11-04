import { pipeline, Transform, type Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { FastifyRequest } from 'fastify';
import { ProblemError } from './errors';

const tooLarge = () =>
  Object.assign(new Error('Payload too large'), {
    code: 'FST_ERR_CTP_BODY_TOO_LARGE',
    statusCode: 413,
  });

/**
 * Accepts `Content-Encoding: gzip` on any request body (08 section 7.3). The compressed size is capped by
 * the route's `config.maxEncoded` (default: its body limit); Fastify then enforces the body limit on the
 * decompressed bytes while streaming, so a small body cannot expand into memory.
 */
export async function gunzipRequest(
  request: FastifyRequest,
  _reply: unknown,
  payload: Readable,
): Promise<Readable> {
  const encoding = request.headers['content-encoding']?.toLowerCase();
  if (!encoding || encoding === 'identity') return payload;
  if (encoding !== 'gzip') {
    throw new ProblemError('unsupported_media_type', 'Content-Encoding must be gzip or identity.');
  }
  const config = request.routeOptions.config as { maxEncoded?: number };
  const max = config.maxEncoded ?? request.routeOptions.bodyLimit;
  let encoded = 0;
  const count = new Transform({
    transform(chunk: Buffer, _enc, done) {
      encoded += chunk.length;
      done(encoded > max ? tooLarge() : null, chunk);
    },
  });
  const gunzip = createGunzip();
  gunzip.once('error', (e: Error & { statusCode?: number }) => void (e.statusCode ??= 400));
  Object.defineProperty(gunzip, 'receivedEncodedLength', { get: () => encoded });
  return pipeline(payload, count, gunzip, () => undefined);
}
