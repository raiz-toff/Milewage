import { useState } from 'react';
import { Ban, Pencil, Smartphone } from 'lucide-react';
import { RowMenu } from '../ui/RowMenu';
import { EmptyState, PageHeader, Section, TableBox, tableClass } from '../ui/layout';
import { Button as UiButton } from '@/components/ui/button';
import { errorText, useApiQuery, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import type { paths } from '@milewage/shared/generated/api-types';
import { formatDateTime, formatTime } from '../format';
import { useSession, useSettings } from '../session';
import { AppButtons, useAppAvailable } from '../pairing/GetTheApp';
import { Qr } from '../ui/Qr';
import { Button, Field, FormError } from '../ui/form';
import { AddressWarning, addressProblem } from '../pairing/address';
import { LinkAPhone } from '../pairing/LinkAPhone';

type Device = Schemas['Device'];
export type Pairing =
  paths['/pairing-tokens']['post']['responses'][201]['content']['application/json'];

const SOURCE: Record<Pairing['base_url_source'], string> = {
  configured: 'set on the server',
  request: 'the address this page is open at',
  driver: 'you changed it',
};

/**
 * The one-time pairing QR and its link; also the onboarding wizard's phone step (plan 23). The QR
 * carries the `https://<server>/pair#…` link any camera opens; "Open in the MileWage app" and
 * "Get the app" sit beside it (plan 24 section 4.3). The address inside it is shown with
 * Change address, and a warning comes first when the phone app cannot use it (plan 19 section 3.3).
 * Change address asks for a new code with the driver's address and hands it to `onPairing`.
 */
export function PairingCode({
  pairing,
  onPairing,
}: {
  pairing: Pairing;
  onPairing: (pairing: Pairing) => void;
}) {
  const { api } = useSession();
  const { timezone } = useSettings();
  const available = useAppAvailable(api);
  const problem = addressProblem(pairing.base_url);
  const [address, setAddress] = useState<string | null>(null); // non-null while changing
  const { run, busy, error } = useChange();

  // Not a <form>: the wizard's phone step already sits inside one.
  async function change() {
    if (busy || !address?.trim()) return;
    const base_url = address.trim();
    const made = await run((api) => api.POST('/pairing-tokens', { body: { base_url } }));
    if (!made) return;
    onPairing(made.data);
    setAddress(null);
  }

  return (
    <div className="space-y-4">
      <AddressWarning problem={problem} />
      <div className="flex flex-wrap items-start gap-6">
        {problem === 'local' ? null : (
          <div className="rounded-lg border bg-white p-2">
            <Qr text={pairing.pair_url} label="Pairing code" />
          </div>
        )}
        <div className="min-w-0 flex-1 basis-64 space-y-3">
          {problem === 'local' ? null : (
            <p className="text-sm text-muted-foreground">
              Open MileWage on your phone and tap Scan the code. Valid once, until{' '}
              {formatTime(pairing.expires_at, timezone)}.
            </p>
          )}
          <AppButtons link={pairing.qr_payload} available={available} />
          <Addresses pairing={pairing} />
          {address === null ? (
            <UiButton
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => setAddress(pairing.base_url)}
            >
              Change address
            </UiButton>
          ) : (
            <div role="group" aria-label="Change address" className="space-y-2">
              <Field
                label="Server address"
                hint="Your Tailscale address, for example https://milewage-box.tail1234.ts.net, or the server's address on your home network, for example http://192.168.1.20:8080"
                inputMode="url"
                autoComplete="off"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  void change();
                }}
              />
              <FormError message={error} />
              <div className="flex gap-2">
                <UiButton
                  type="button"
                  size="sm"
                  disabled={busy || !address.trim()}
                  onClick={() => void change()}
                >
                  Make a new code
                </UiButton>
                <UiButton type="button" variant="ghost" size="sm" onClick={() => setAddress(null)}>
                  Cancel
                </UiButton>
              </div>
            </div>
          )}
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Show code text</summary>
            <code className="mt-1 block break-all font-mono text-xs">{pairing.qr_payload}</code>
          </details>
        </div>
      </div>
    </div>
  );
}

/**
 * Where the phone connects (plan 28 section 4.2), said plainly: the home address on the Wi-Fi,
 * the away address everywhere else, and what happens when there is no away address.
 */
function Addresses({ pairing }: { pairing: Pairing }) {
  const { home_url: home, away_url: away, base_url: base, base_url_source: source } = pairing;
  const from = (url: string) =>
    url === base ? <span className="text-muted-foreground"> ({SOURCE[source]})</span> : null;
  if (!home && !away) {
    return (
      <p className="text-sm">
        Your phone will connect to <span className="font-medium break-all">{base}</span>
        {from(base)}
      </p>
    );
  }
  return (
    <ul className="space-y-1 text-sm">
      {home ? (
        <li>
          <span className="font-medium">At home:</span> <span className="break-all">{home}</span>
          {from(home)}, used when the phone is on your Wi-Fi.
          {home.startsWith('http:') ? (
            <span className="block text-xs text-muted-foreground">
              Plain http: not encrypted on your home network.
            </span>
          ) : null}
        </li>
      ) : null}
      <li>
        <span className="font-medium">Away:</span>{' '}
        {away ? (
          <>
            <span className="break-all">{away}</span>
            {from(away)}, used everywhere else.
          </>
        ) : (
          <>
            not set up. The phone sends shifts when it is back on your Wi-Fi. To send them from
            anywhere, set up Tailscale (the install guide, section 3).
          </>
        )}
      </li>
    </ul>
  );
}

function DeviceRow({ device }: { device: Device }) {
  const { timezone } = useSettings();
  const [name, setName] = useState<string | null>(null); // non-null while renaming
  const [confirming, setConfirming] = useState(false);
  const change = useChange();
  const { error } = change;
  const revoked = device.revoked_at !== null;

  async function act(send: Parameters<typeof change.run>[0]) {
    if (!(await change.run(send))) return;
    setName(null);
    setConfirming(false);
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
                  void act((api) =>
                    api.DELETE('/devices/{id}', { params: { path: { id: device.id } } }),
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
                void act((api) =>
                  api.PATCH('/devices/{id}', {
                    params: { path: { id: device.id } },
                    body: { name: name.trim() },
                  }),
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
  const asked = useApiQuery('/devices');
  const devices = asked.data ?? null;
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const change = useChange();
  const error = errorText(change, asked);

  async function pair() {
    const made = await change.run((api) => api.POST('/pairing-tokens'));
    if (made) setPairing(made.data);
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Devices"
        description="Phones that record shifts for this server. Revoke one you lost or replaced."
      >
        {/* The QR: for a phone that is not on the same Wi-Fi, or did not find the server. */}
        <Button type="button" onClick={() => void pair()}>
          <Smartphone />
          Pair a phone
        </Button>
      </PageHeader>
      <Section title="Link a phone on your Wi-Fi">
        <LinkAPhone />
      </Section>
      {pairing || error ? (
        <Section title="Pair a phone with a code">
          {pairing ? <PairingCode pairing={pairing} onPairing={setPairing} /> : null}
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
                  <DeviceRow key={d.id} device={d} />
                ))}
              </tbody>
            </table>
          </TableBox>
        )}
      </Section>
    </section>
  );
}
