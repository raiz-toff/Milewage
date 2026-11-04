import { useCallback, useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatDateTime, formatTime } from '../format';
import { useSession, useSettings } from '../session';
import { Qr } from '../ui/Qr';
import { Button, FormError } from '../ui/form';

type Device = Schemas['Device'];
type Pairing = { qr_payload: string; token: string; expires_at: number };

function DeviceRow({ device, onChanged }: { device: Device; onChanged: () => void }) {
  const { api } = useSession();
  const { timezone } = useSettings();
  const [name, setName] = useState<string | null>(null); // non-null while renaming
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoked = device.revoked_at !== null;

  async function act(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
      setName(null);
      setConfirming(false);
      onChanged();
    } catch (e) {
      setError(describe(e));
    }
  }

  return (
    <tr className="border-t border-line align-top">
      <td className="py-2 pr-4">
        {name === null ? (
          <span className={revoked ? 'text-muted line-through' : ''}>{device.name}</span>
        ) : (
          <input
            aria-label={`New name for ${device.name}`}
            className="rounded border border-line bg-bg px-2 py-1"
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <FormError message={error} />
      </td>
      <td className="pr-4 text-muted">{device.platform}</td>
      <td className="pr-4 font-mono text-sm text-muted">
        {device.last_seen_at ? formatDateTime(device.last_seen_at, timezone) : 'never'}
      </td>
      <td className="pr-4 text-muted">{revoked ? 'revoked' : 'active'}</td>
      <td className="space-x-3 text-right">
        {revoked ? null : name === null ? (
          <>
            <button
              type="button"
              className="text-muted hover:text-ink"
              onClick={() => setName(device.name)}
            >
              Rename
            </button>
            {confirming ? (
              <button
                type="button"
                className="text-red-400"
                onClick={() =>
                  void act(() =>
                    unwrap(api.DELETE('/devices/{id}', { params: { path: { id: device.id } } })),
                  )
                }
              >
                Confirm revoke
              </button>
            ) : (
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => setConfirming(true)}
              >
                Revoke
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="text-accent"
              disabled={!name.trim()}
              onClick={() =>
                void act(() =>
                  unwrap(
                    api.PATCH('/devices/{id}', {
                      params: { path: { id: device.id } },
                      body: { name: name.trim() },
                    }),
                  ),
                )
              }
            >
              Save
            </button>
            <button type="button" className="text-muted" onClick={() => setName(null)}>
              Cancel
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

/** Module `devices`: pair a phone with a one-time QR code, rename, revoke. */
export function Devices() {
  const { api } = useSession();
  const { timezone } = useSettings();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices(await unwrap(api.GET('/devices')));
    } catch (e) {
      setError(describe(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function pair() {
    setError(null);
    try {
      setPairing(await unwrap(api.POST('/pairing-tokens')));
    } catch (e) {
      setError(describe(e));
    }
  }

  return (
    <section className="space-y-6">
      <h1 className="font-heading text-2xl">Devices</h1>
      <div className="space-y-3 rounded border border-line bg-card p-4">
        <Button type="button" onClick={() => void pair()}>
          Pair a phone
        </Button>
        {pairing ? (
          <div className="space-y-2">
            <Qr text={pairing.qr_payload} label="Pairing code" />
            <p className="text-sm text-muted">
              Scan in the MileWage app. Valid once, until {formatTime(pairing.expires_at, timezone)}
              .
            </p>
            <code className="block break-all font-mono text-xs text-muted">
              {pairing.qr_payload}
            </code>
          </div>
        ) : null}
        <FormError message={error} />
      </div>
      {devices === null ? (
        <p className="text-muted">Loading</p>
      ) : devices.length === 0 ? (
        <p className="text-muted">No phone is paired yet.</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-sm text-muted">
            <tr>
              <th className="pb-2 font-normal">Name</th>
              <th className="font-normal">Platform</th>
              <th className="font-normal">Last seen</th>
              <th className="font-normal">State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <DeviceRow key={d.id} device={d} onChanged={() => void load()} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
