import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { paths } from '@milewage/shared/generated/api-types';
import type { Schemas } from '../api/client';
import { apiKey, useApiQuery, useChange } from '../api/query';

/** A pairing code as the server makes it: the token, the QR and pair-page links, the addresses. */
export type Pairing =
  paths['/pairing-tokens']['post']['responses'][201]['content']['application/json'];
type Device = Schemas['Device'];

/** How often a session asks whether the phone has paired. */
export const PAIR_POLL_MS = 1500;
/** setTimeout fires at once for anything longer; a code valid that long never needs a new one. */
const LONGEST_TIMER = 2 ** 31 - 1;

/**
 * - `idle`: no code asked for yet.
 * - `minting`: the first code is on its way.
 * - `waiting`: a code is out and no new phone has appeared.
 * - `expired`: the code ran out; a new one is being asked for, or asking failed (see `error`).
 * - `paired`: a phone that was not in the device list when the code was made has appeared.
 * - `error`: there is no code, because asking for one failed (see `error`).
 */
export type PairingState = 'idle' | 'minting' | 'waiting' | 'expired' | 'paired' | 'error';

export interface PairingSession {
  /** The current pairing code (QR, links, addresses), or null before the first one arrives. */
  code: Pairing | null;
  state: PairingState;
  /** Why the last request for a code failed, as one sentence for the driver. */
  error: string | null;
  /** True while a code is being asked for. */
  busy: boolean;
  /**
   * Ask for a new code, with the driver's own server address when one is given. Resolves true
   * when the new code replaced the old one; on a failure the old code stays and `error` says why.
   */
  renew: (address?: string) => Promise<boolean>;
}

/**
 * One phone pairing (plan 23, plan 24 section 4.3): the one-time code, and waiting for the phone.
 * While a code is out, `GET /devices` is asked every `PAIR_POLL_MS` (TanStack Query's
 * `refetchInterval`, so every screen showing the device list sees the new phone too) until a phone
 * appears that was not in the list when the first code was made. A code that runs out while the
 * session still waits is replaced by a new one for the same address, so the QR on screen always
 * works. With `start`, the first code is asked for as soon as the session is shown.
 */
export function usePairingSession({ start = false }: { start?: boolean } = {}): PairingSession {
  const client = useQueryClient();
  const { run, busy, error } = useChange();
  const [code, setCode] = useState<Pairing | null>(null);
  // The phones there before the session began; null until the first code is asked for.
  const [known, setKnown] = useState<ReadonlySet<number> | null>(null);
  // The token of a code whose time ran out.
  const [ranOut, setRanOut] = useState<string | null>(null);

  const isNew = useCallback(
    (list: Device[] | undefined) =>
      !!known && !!list?.some((d) => d.revoked_at === null && !known.has(d.id)),
    [known],
  );
  const devices = useApiQuery('/devices', undefined, {
    enabled: known !== null,
    refetchInterval: (query) => (isNew(query.state.data) ? false : PAIR_POLL_MS),
  });
  const paired = isNew(devices.data);

  const renew = useCallback(
    async (address?: string) => {
      const before = client.getQueryData<Device[]>(apiKey('/devices')) ?? [];
      setKnown((k) => k ?? new Set(before.map((d) => d.id)));
      const base_url = address?.trim();
      const made = await run((api) =>
        base_url
          ? api.POST('/pairing-tokens', { body: { base_url } })
          : api.POST('/pairing-tokens'),
      );
      if (!made) return false;
      setCode(made.data);
      // A code that arrives already out of date (a clock off) is not renewed again and again.
      if (made.data.expires_at <= Date.now()) setRanOut(made.data.token);
      return true;
    },
    [client, run],
  );

  const begun = useRef(false);
  useEffect(() => {
    if (!start || begun.current) return;
    begun.current = true;
    void renew();
  }, [start, renew]);

  useEffect(() => {
    if (!code || paired) return;
    const left = code.expires_at - Date.now();
    if (left <= 0 || left > LONGEST_TIMER) return;
    const timer = setTimeout(() => {
      setRanOut(code.token);
      void renew(code.base_url_source === 'driver' ? code.base_url : undefined);
    }, left);
    return () => clearTimeout(timer);
  }, [code, paired, renew]);

  const state: PairingState = paired
    ? 'paired'
    : known === null
      ? 'idle'
      : code === null
        ? error && !busy
          ? 'error'
          : 'minting'
        : ranOut === code.token
          ? 'expired'
          : 'waiting';
  return { code, state, error, busy, renew };
}
