import { useCallback, useEffect, useState } from 'react';
import { Ban, Pencil, Smartphone } from 'lucide-react';
import { RowMenu } from '../ui/RowMenu';
import { EmptyState, PageHeader, Section, TableBox, tableClass } from '../ui/layout';
import { Button as UiButton } from '@/components/ui/button';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatDateTime, formatTime } from '../format';
import { useSession, useSettings } from '../session';
import { AppButtons, useAppAvailable } from '../pairing/GetTheApp';
import { Qr } from '../ui/Qr';
import { Button, FormError } from '../ui/form';

type Device = Schemas['Device'];
type Pairing = { qr_payload: string; pair_url: string; token: string; expires_at: number };

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
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-4">
        {name === null ? (
          <span className={revoked ? 'text-muted-foreground line-through' : ''}>{device.name}</span>
        ) : (
          <input
            aria-label={`New name for ${device.name}`}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <FormError message={error} />
      </td>
      <td className="pr-4 text-muted-foreground">{device.platform}</td>
      <td className="pr-4 tabular-nums text-sm text-muted-foreground">
        {device.last_seen_at ? formatDateTime(device.last_seen_at, timezone) : 'never'}
      </td>
      <td className="pr-4 text-muted-foreground">{revoked ? 'revoked' : 'active'}</td>
      <td className="space-x-3 text-right whitespace-nowrap">
        {revoked ? null : name === null ? (
          confirming ? (
            <>
              <UiButton
                type="button"
                variant="destructive"
                size="sm"
                onClick={() =>
                  void act(() =>
                    unwrap(api.DELETE('/devices/{id}', { params: { path: { id: device.id } } })),
                  )
                }
              >
                Confirm revoke
              </UiButton>
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </UiButton>
            </>
          ) : (
            <RowMenu
              name={device.name}
              actions={[
                { label: 'Rename', icon: Pencil, onSelect: () => setName(device.name) },
                {
                  label: 'Revoke',
                  icon: Ban,
                  destructive: true,
                  onSelect: () => setConfirming(true),
                },
              ]}
            />
          )
        ) : (
          <>
            <UiButton
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
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
            </UiButton>
            <UiButton type="button" variant="ghost" size="sm" onClick={() => setName(null)}>
              Cancel
            </UiButton>
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
  const available = useAppAvailable(api);

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
      <PageHeader
        title="Devices"
        description="Phones that record shifts for this server. Revoke one you lost or replaced."
      >
        <Button type="button" onClick={() => void pair()}>
          <Smartphone />
          Pair a phone
        </Button>
      </PageHeader>
      {pairing || error ? (
        <Section title="Pair a phone">
          {pairing ? (
            <div className="flex flex-wrap items-start gap-6">
              <div className="rounded-lg border bg-white p-2">
                <Qr text={pairing.pair_url} label="Pairing code" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm text-muted-foreground">
                  Open MileWage on your phone and tap Scan the code. Valid once, until{' '}
                  {formatTime(pairing.expires_at, timezone)}.
                </p>
                <AppButtons link={pairing.qr_payload} available={available} />
                <code className="block break-all font-mono text-xs text-muted-foreground">
                  {pairing.qr_payload}
                </code>
              </div>
            </div>
          ) : null}
          <FormError message={error} />
        </Section>
      ) : null}
      <Section title="Paired phones">
        {devices === null ? (
          <p className="text-sm text-muted-foreground">Loading</p>
        ) : devices.length === 0 ? (
          <EmptyState>No phone is paired yet.</EmptyState>
        ) : (
          <TableBox>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Platform</th>
                  <th>Last seen</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <DeviceRow key={d.id} device={d} onChanged={() => void load()} />
                ))}
              </tbody>
            </table>
          </TableBox>
        )}
      </Section>
    </section>
  );
}
