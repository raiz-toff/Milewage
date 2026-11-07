import { useEffect, useState } from 'react';
import type { PairingStatus } from '../pairing/pairing';
import { useServices } from '../services';

/**
 * The app start gate (24 section 4.1): which screens exist. Not paired or revoked: only the first
 * run screens. A shift that is still running keeps the app screens, so it can be ended first.
 * Connected from the first run: the setup steps until the driver finishes them.
 */
export type Gate = PairingStatus | 'setup';

export function useGate(): Gate | 'loading' {
  const { pairing, shift } = useServices();
  const [gate, setGate] = useState<Gate | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    const read = async () => {
      const s = await pairing.status();
      let next: Gate = s === 'revoked' && (await shift.running()) ? 'paired' : s;
      if (next === 'paired' && (await pairing.setupPending())) next = 'setup';
      if (live) setGate(next);
    };
    void read();
    const off = pairing.subscribe(() => void read());
    return () => {
      live = false;
      off();
    };
  }, [pairing, shift]);
  return gate;
}
