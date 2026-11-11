import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { basemapHost } from '../map/style';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-title-large text-on-surface">{title}</h2>
      {children}
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6 marker:text-on-surface-variant">{children}</ul>;
}

const Cmd = ({ children }: { children: string }) => (
  <code className="rounded-extra-small bg-surface-container-highest px-1 py-0.5 font-mono text-[0.875em] break-words">
    {children}
  </code>
);

/** Who sees the map, for the basemap this build uses (`VITE_MAP_STYLE_URL`, src/map/style.ts). */
function MapItem({ host }: { host: string | null }) {
  if (host === null)
    return (
      <li>
        <strong>Maps.</strong> This server's web app is built without an outside map service. Routes
        are drawn on a plain background or from map files on this server, so no map requests leave
        it.
      </li>
    );
  const name = host === 'tiles.openfreemap.org' ? 'OpenFreeMap' : host;
  return (
    <li>
      <strong>Maps ({name}).</strong> When a page shows a map, your browser downloads the map
      pictures from {host}. That service sees which area and zoom you look at, your IP address and
      the address of this server (browsers send it with each request). It does not get your route:
      the route line is drawn in your browser, and no shift, position or amount is sent.
    </li>
  );
}

/**
 * `/privacy`: what MileWage records and who else sees something, public on every instance (no
 * sign-in), so an owner can give it as the app's privacy policy address. Every statement here is
 * about the code as built; the build's map service is filled in from its settings.
 */
export function PrivacyPage({
  mapStyleUrl = import.meta.env.VITE_MAP_STYLE_URL as string | undefined,
}: {
  mapStyleUrl?: string;
}) {
  useEffect(() => {
    document.title = 'Privacy · MileWage';
  }, []);

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-8 text-body-large text-on-surface">
      <header className="space-y-3">
        <h1 className="text-headline-small text-on-surface md:text-headline-medium">Privacy</h1>
        <p className="text-muted-foreground">
          MileWage runs on a server that belongs to the person who set it up, often the driver. This
          page says what the MileWage phone app and this server record, where it is kept, and who
          else sees something. It describes the software; the owner of this server decides how it is
          run.
        </p>
      </header>

      <Section title="On the phone">
        <List>
          <li>
            The app uses GPS only while a shift is running, from Start shift to End shift. Outside a
            shift it records no location. During a shift it records your position about every 10
            seconds or 20 metres while you move, and pauses GPS while you stand still.
          </li>
          <li>
            Positions are sent only to the server this phone is connected to, and to nothing else.
          </li>
          <li>
            Raw positions stay on the phone until the server confirms it has them, then 14 days
            more, then the app deletes them. A position the server has not confirmed is never
            deleted.
          </li>
          <li>
            Your shift list (times, distances, trips, stops, a simplified route line and odometer
            readings) stays on the phone so its screens work without a connection, until you clear
            the app's data.
          </li>
          <li>
            When you connect the phone, the server gives it a device token. The phone keeps it
            encrypted with a key from the Android Keystore; the server keeps only a hash of it.
            Revoking the phone on the Devices page stops the token working.
          </li>
          <li>
            The app's data is in its private storage and is left out of Android backups and phone
            transfers.
          </li>
          <li>
            Permissions: location, including all the time (so a shift keeps recording with the
            screen off); physical activity (to pause GPS while you stand still during a shift);
            notifications (the shift notice); camera (only to scan the pairing code).
          </li>
          <li>
            Android's location service (Google Play services) works out the position. What Google
            collects through that service depends on your phone's own location settings, not on
            MileWage.
          </li>
        </List>
      </Section>

      <Section title="On this server">
        <List>
          <li>
            Everything MileWage keeps is on the owner's machine, in the Docker volumes{' '}
            <Cmd>data</Cmd> (your records), <Cmd>backups</Cmd> and <Cmd>config</Cmd>: shifts, GPS
            positions, trips, stops, earnings, expenses and receipts, vehicles, odometer readings,
            settings, and your account (the password only as a hash).
          </li>
          <li>
            Raw GPS positions are kept for 90 days unless you choose otherwise (Settings, Tracking
            and privacy; at least 7 days). After that each shift keeps a simplified route line
            instead. Totals, trips and the route line stay until the server's data is removed.
          </li>
          <li>
            Backups are made every night and after a shift. Each is encrypted with your recovery
            key; the server keeps only the public half of that key, so it cannot read its own
            backups. The live database is not encrypted: anyone who can read the machine's disk can
            read it, so keep the machine safe.
          </li>
          <li>
            MileWage needs no account with its developer or with any company, and sends nothing to
            its developer: no analytics, no crash reports, no update checks.
          </li>
          <li>
            Your browser keeps no shift or money data. It keeps the sign-in cookie, a few display
            choices (theme, hidden cards, a dismissed install offer) and the app's own files for
            starting offline.
          </li>
        </List>
      </Section>

      <Section title="Who else sees something, and when">
        <List>
          <MapItem host={basemapHost(mapStyleUrl)} />
          <li>
            <strong>Road snapping.</strong> Not in this version. Routes are not sent to any routing
            service.
          </li>
          <li>
            <strong>Tailscale</strong>, if the owner uses it to reach this server. It carries the
            connection between your devices, encrypted between them. Tailscale knows which devices
            are in the network, their names and addresses. Turning on HTTPS for this server puts its
            machine name and network name in a public certificate log, where anyone can read them.
          </li>
          <li>
            <strong>Google Play</strong>, if you installed the app from there. Google knows you
            installed it and delivers updates, under Google's terms. The app itself contains no ads,
            no analytics and no crash-reporting service.
          </li>
        </List>
      </Section>

      <Section title="Diagnostics">
        <List>
          <li>
            To find faults, the phone and the server record diagnostics: counts, timings, versions,
            the phone's make and model, states and error codes. They go only to this server, never
            to the developer.
          </li>
          <li>
            They never contain positions, addresses, amounts paid, labels, notes or other text you
            typed, server addresses or tokens. Each field is checked against a fixed list on the
            phone and again on the server; anything else is dropped.
          </li>
          <li>
            Settings, Tracking and privacy sets the level: Off, Basic (the default) or Verbose (back
            to Basic after 7 days).
          </li>
        </List>
      </Section>

      <Section title="Deleting your data">
        <h3 className="font-medium">On the phone</h3>
        <List>
          <li>
            In the app, Settings, <em>Connect to a different server</em> stops sending to this
            server. Shifts not yet sent stay on the phone.
          </li>
          <li>
            To delete everything the app holds: Android Settings, Apps, MileWage, Storage, Clear
            storage, or uninstall the app. Shifts not yet sent to the server are then lost.
          </li>
          <li>On the web, Devices: revoke the phone so its token stops working.</li>
        </List>
        <h3 className="font-medium">On the server</h3>
        <List>
          <li>
            Download a backup first if you may want the records later. Then, on the machine, in the
            MileWage folder, run{' '}
            <Cmd>docker compose -f infra/docker/docker-compose.yml down -v</Cmd>. This stops
            MileWage and deletes its volumes: your records, the backups on that machine, the
            settings and the app file. Backups you downloaded elsewhere must be deleted by hand.
          </li>
          <li>
            If Tailscale serves this server, <Cmd>tailscale serve reset</Cmd> stops that (it clears
            every <Cmd>tailscale serve</Cmd> setting on the machine). A name already in the public
            certificate log stays there.
          </li>
        </List>
      </Section>

      <Section title="Questions">
        <p>
          Ask the owner of this server: the person who set it up and gave you its address. MileWage
          is software that each owner runs on their own machine. Its developer runs no service and
          holds none of your data.
        </p>
      </Section>

      <p className="border-t pt-4 text-muted-foreground">
        <a href="/" className="underline underline-offset-4 hover:text-foreground">
          Open MileWage
        </a>
      </p>
    </main>
  );
}
