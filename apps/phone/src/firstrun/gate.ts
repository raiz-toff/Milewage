import { useEffect, useState } from 'react';
import type { PairingStatus } from '../pairing/pairing';
import { useServices } from '../services';

/**
 * The app start gate (24 section 4.1): which screens exist. Not paired or revoked: only the first
 * run screens. A shift that is still running keeps the app screens, so it can be ended first.
 */
export function useGate(): PairingStatus | 'loading' {
  const { pairing, shift } = useServices();
  const [gate, setGate] = useState<PairingStatus | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    const read = async () => {
      const s = await pairing.status();
      const next = s === 'revoked' && (await shift.running()) ? 'paired' : s;
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
