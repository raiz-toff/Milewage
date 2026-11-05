// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

interface Row {
  id: number;
  name: string;
  kind: string;
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
  power: string | null;
  created_at: number;
  archived_at: number | null;
}
const car = (over: Partial<Row> = {}): Row => ({
  id: 1,
  name: 'Corolla',
  kind: 'car',
  make: null,
  model: null,
  year: null,
  plate: null,
  power: null,
  created_at: 1_700_000_000_000,
  archived_at: null,
  ...over,
});

function server(initial: Row[] = [car()]) {
  let rows = initial;
  const table = {
    ...signedIn(),
    'GET /vehicles': ({ url }: { url: URL }) => ({
      body:
        url.searchParams.get('include_archived') === 'true'
          ? rows
          : rows.filter((r) => !r.archived_at),
    }),
    'POST /vehicles': ({ body }: { body: unknown }) => {
      const b = body as { name: string; kind: string };
      const row = car({ id: 2, name: b.name, kind: b.kind });
      rows = [...rows, row];
      return { status: 201, body: row };
    },
    'PATCH /settings': () => ({ body: settingsFixture({ default_vehicle_id: 1 }) }),
    'PATCH /vehicles/1': ({ body }: { body: unknown }) => {
      const b = body as {
        name?: string;
        kind?: string;
        archived?: boolean;
        make?: string | null;
        year?: number | null;
      };
      rows = rows.map((r) =>
        r.id === 1
          ? {
              ...r,
              name: b.name ?? r.name,
              kind: b.kind ?? r.kind,
              make: 'make' in b ? (b as Row).make : r.make,
              year: 'year' in b ? (b as Row).year : r.year,
              archived_at:
                b.archived === undefined ? r.archived_at : b.archived ? 1_700_000_900_000 : null,
            }
          : r,
      );
      return { body: rows[0] };
    },
  };
  return renderApp(table as never, '/vehicles');
}

describe('vehicles page', () => {
  it('lists vehicles with their type and state', async () => {
    server();
    expect(await screen.findByText('Corolla')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Car' })).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    server([]);
    expect(await screen.findByText(/No vehicles yet/)).toBeTruthy();
  });

  it('adds a vehicle with the chosen type', async () => {
    const s = server();
    await screen.findByText('Corolla');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cargo bike' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'bicycle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add vehicle' }));
    expect(await screen.findByText('Cargo bike')).toBeTruthy();
    const post = s.calls.find((c) => c.method === 'POST' && c.path === '/vehicles');
    expect(post?.body).toEqual({ name: 'Cargo bike', kind: 'bicycle' });
  });

  it('renames and retypes a vehicle', async () => {
    const s = server();
    await screen.findByText('Corolla');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('New name for Corolla'), { target: { value: 'Van' } });
    fireEvent.change(screen.getByLabelText('Type of Corolla'), { target: { value: 'van' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByRole('cell', { name: 'Van' })).toHaveLength(2);
    const patch = s.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({
      ...{ name: 'Van', kind: 'van' },
      ...{ make: null, model: null, year: null, plate: null },
    });
  });

  it('edits details and sets the default vehicle', async () => {
    const s = server();
    await screen.findByText('Corolla');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Make of Corolla'), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText('Year of Corolla'), { target: { value: '2020' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      make: 'Toyota',
      year: 2020,
    });
  });

  it('offers the e-bike, scooter and on-foot types', async () => {
    server();
    await screen.findByText('Corolla');
    const options = Array.from((screen.getByLabelText('Type') as HTMLSelectElement).options).map(
      (o) => o.value,
    );
    expect(options).toEqual(['car', 'van', 'motorcycle', 'bicycle', 'ebike', 'scooter', 'walking']);
  });

  it('archives a vehicle, shows it on request, and restores it', async () => {
    const s = server();
    await screen.findByText('Corolla');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.queryByText('Corolla')).toBeNull());
    fireEvent.click(screen.getByLabelText('Show archived vehicles'));
    expect(await screen.findByText('archived')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getByText('active')).toBeTruthy());
    const bodies = s.calls.filter((c) => c.method === 'PATCH').map((c) => c.body);
    expect(bodies).toEqual([{ archived: true }, { archived: false }]);
  });

  it('shows the server message when a change is refused', async () => {
    renderApp(
      {
        ...signedIn(),
        'GET /vehicles': () => ({ body: [car()] }),
        'PATCH /vehicles/1': () => ({
          status: 422,
          body: { code: 'validation_failed', detail: 'Name is taken.' },
        }),
      } as never,
      '/vehicles',
    );
    await screen.findByText('Corolla');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
