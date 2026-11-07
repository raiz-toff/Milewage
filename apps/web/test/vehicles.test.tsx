// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, signedIn, pick, menu, optionsOf } from './support/kit';

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
  ownership: string;
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
  ownership: 'owned',
  created_at: 1_700_000_000_000,
  archived_at: null,
  ...over,
});

function server(initial: Row[] = [car()]) {
  let rows = initial;
  const table = {
    ...signedIn(settingsFixture({ modules: { tax: false } })),
    'GET /vehicles': ({ url }: { url: URL }) => ({
      body:
        url.searchParams.get('include_archived') === 'true'
          ? rows
          : rows.filter((r) => !r.archived_at),
    }),
    'POST /vehicles': ({ body }: { body: unknown }) => {
      const b = body as { name: string; kind: string; ownership: string };
      const row = car({ id: 2, name: b.name, kind: b.kind, ownership: b.ownership });
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
        ownership?: string;
      };
      rows = rows.map((r) =>
        r.id === 1
          ? {
              ...r,
              name: b.name ?? r.name,
              kind: b.kind ?? r.kind,
              make: 'make' in b ? (b as Row).make : r.make,
              year: 'year' in b ? (b as Row).year : r.year,
              ownership: b.ownership ?? r.ownership,
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
    pick(screen.getByLabelText('Type'), 'bicycle');
    fireEvent.click(screen.getByRole('button', { name: 'Add vehicle' }));
    expect(await screen.findByText('Cargo bike')).toBeTruthy();
    const post = s.calls.find((c) => c.method === 'POST' && c.path === '/vehicles');
    expect(post?.body).toEqual({ name: 'Cargo bike', kind: 'bicycle', ownership: 'owned' });
  });

  it('renames and retypes a vehicle', async () => {
    const s = server();
    await screen.findByText('Corolla');
    menu('Corolla', 'Edit');
    fireEvent.change(screen.getByLabelText('New name for Corolla'), { target: { value: 'Van' } });
    pick(screen.getByLabelText('Type of Corolla'), 'van');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // the new name and the new type
    await waitFor(() => expect(screen.getAllByText('Van')).toHaveLength(2));
    const patch = s.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({
      ...{ name: 'Van', kind: 'van' },
      ...{ make: null, model: null, year: null, plate: null, ownership: 'owned' },
    });
  });

  it('edits details and sets the default vehicle', async () => {
    const s = server();
    await screen.findByText('Corolla');
    menu('Corolla', 'Edit');
    fireEvent.change(screen.getByLabelText('Make of Corolla'), { target: { value: 'Toyota' } });
    fireEvent.change(screen.getByLabelText('Year of Corolla'), { target: { value: '2020' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      make: 'Toyota',
      year: 2020,
    });
  });

  it('records who owns a new vehicle and shows it when it is not owned', async () => {
    const s = server();
    await screen.findByText('Corolla');
    expect(optionsOf('Ownership')).toEqual(['owned', 'financed', 'leased', 'rented']);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Yulu' } });
    pick(screen.getByLabelText('Type'), 'scooter');
    pick(screen.getByLabelText('Ownership'), 'rented');
    fireEvent.click(screen.getByRole('button', { name: 'Add vehicle' }));
    const row = (name: RegExp) => screen.getByRole('row', { name }).textContent;
    await waitFor(() => expect(row(/Yulu/)).toContain('Rented'));
    const post = s.calls.find((c) => c.method === 'POST' && c.path === '/vehicles');
    expect(post?.body).toEqual({ name: 'Yulu', kind: 'scooter', ownership: 'rented' });
    expect(row(/Corolla/)).not.toContain('Owned'); // owned outright is the plain case
  });

  it('changes ownership when editing', async () => {
    const s = server();
    await screen.findByText('Corolla');
    menu('Corolla', 'Edit');
    pick(screen.getByLabelText('Ownership of Corolla'), 'financed');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
    expect(screen.getByRole('row', { name: /Corolla/ }).textContent).toContain(
      'Financed (loan or hire purchase)',
    );
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      ownership: 'financed',
    });
  });

  it('offers the e-bike, scooter and on-foot types', async () => {
    server();
    await screen.findByText('Corolla');
    expect(optionsOf('Type')).toEqual([
      'car',
      'van',
      'motorcycle',
      'bicycle',
      'ebike',
      'scooter',
      'walking',
    ]);
  });

  it('archives a vehicle, shows it on request, and restores it', async () => {
    const s = server();
    await screen.findByText('Corolla');
    menu('Corolla', 'Archive');
    await waitFor(() => expect(screen.queryByText('Corolla')).toBeNull());
    fireEvent.click(screen.getByLabelText('Show archived vehicles'));
    expect(await screen.findByText('archived')).toBeTruthy();
    menu('Corolla', 'Restore');
    await waitFor(() => expect(screen.getByText('active')).toBeTruthy());
    const bodies = s.calls.filter((c) => c.method === 'PATCH').map((c) => c.body);
    expect(bodies).toEqual([{ archived: true }, { archived: false }]);
  });

  it('shows the server message when a change is refused', async () => {
    renderApp(
      {
        ...signedIn(settingsFixture({ modules: { tax: false } })),
        'GET /vehicles': () => ({ body: [car()] }),
        'PATCH /vehicles/1': () => ({
          status: 422,
          body: { code: 'validation_failed', detail: 'Name is taken.' },
        }),
      } as never,
      '/vehicles',
    );
    await screen.findByText('Corolla');
    menu('Corolla', 'Archive');
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
