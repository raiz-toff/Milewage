import { useState } from 'react';
import { IconTile } from '../ui/visuals';
import { Badge } from '@/components/ui/badge';
import { BlockIcon, DevicesIcon, EditIcon } from '@/ui/icons';
import { RowMenu } from '../ui/RowMenu';
import { EmptyState, PageHeader, Section, TableBox, tableClass } from '../ui/layout';
import { Button as UiButton } from '@/components/ui/button';
import { errorText, useApiQuery, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { formatDateTime } from '../format';
import { useSettings } from '../session';
import { Button, FormError, denseField } from '../ui/form';
import { HelpLink } from '../help';
import { PairingCode } from '../pairing/PairingCode';
import { usePairingSession } from '../pairing/session';

type Device = Schemas['Device'];

function DeviceRow({ device }: { device: Device }) {
  const { timezone, time_format: tf } = useSettings();
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
          <span className="flex items-center gap-3">
            <IconTile icon={DevicesIcon} tone={revoked ? 'neutral' : 'selected'} round />
            <span className={revoked ? 'text-muted-foreground line-through' : ''}>
              {device.name}
            </span>
          </span>
        ) : (
          <input
            aria-label={`New name for ${device.name}`}
            className={denseField}
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <FormError message={error} />
      </td>
      <td className="pr-4 text-muted-foreground">{device.platform}</td>
      <td className="pr-4 text-muted-foreground tabular-nums">
        {device.last_seen_at ? formatDateTime(device.last_seen_at, timezone, tf) : 'never'}
      </td>
      <td className="pr-4">
        <Badge variant={revoked ? 'outline' : 'secondary'}>{revoked ? 'revoked' : 'active'}</Badge>
      </td>
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
                { label: 'Rename', icon: EditIcon, onSelect: () => setName(device.name) },
                {
                  label: 'Revoke',
                  icon: BlockIcon,
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
  const pairing = usePairingSession();
  const error = errorText(asked);
  const pair = () => pairing.renew();

  return (
    <section className="space-y-6">
      <PageHeader
        title="Devices"
        description={
          <>
            Phones that record shifts for this server. Revoke one you lost or replaced.{' '}
            <HelpLink page="if-your-phone-is-lost">If your phone is lost</HelpLink>
          </>
        }
      >
        {/* The QR, and the code to paste under it. */}
        <Button type="button" onClick={() => void pair()}>
          <DevicesIcon />
          Pair a phone
        </Button>
      </PageHeader>
      {pairing.state !== 'idle' || error ? (
        <Section title="Pair a phone with a code">
          {pairing.state !== 'idle' ? <PairingCode session={pairing} /> : null}
          <FormError message={error} />
        </Section>
      ) : null}
      <Section title="Paired phones">
        {devices === null ? (
          <p className="text-body-medium text-muted-foreground">Loading</p>
        ) : devices.length === 0 ? (
          <EmptyState icon={DevicesIcon}>No phone is paired yet.</EmptyState>
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
