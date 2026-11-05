import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useSession } from '../session';
import { Button, Field, FormError } from '../ui/form';

type Platform = Schemas['Platform'];

/** Settings card of the `platforms` module (18 section 4.2): switch platforms on or off, add your own. */
export function PlatformsCard() {
  const { api } = useSession();
  const [list, setList] = useState<Platform[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      setList(
        await unwrap<Platform[]>(
          api.GET('/platforms', { params: { query: { include_inactive: true } } }),
        ),
      );
    } catch (e) {
      setError(describe(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function put(slug: string, body: Schemas['PlatformPut']) {
    setError(null);
    try {
      await unwrap(api.PUT('/platforms/{slug}', { params: { path: { slug } }, body }));
      await load();
    } catch (e) {
      setError(describe(e));
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
    if (!slug) return setError('Use letters or digits in the name.');
    await put(slug, { label: name.trim() });
    setName('');
  }

  async function remove(slug: string) {
    setError(null);
    try {
      await unwrap(api.DELETE('/platforms/{slug}', { params: { path: { slug } } }));
      await load();
    } catch (e) {
      setError(describe(e));
    }
  }

  return (
    <section aria-label="Platforms" className="space-y-3">
      <h2 className="font-heading text-lg">Platforms</h2>
      <FormError message={error} />
      {list === null ? (
        <p className="text-muted">Loading</p>
      ) : (
        <ul className="space-y-1">
          {list.map((p) => (
            <li key={p.slug} className="flex items-center gap-3">
              <label className="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--mw-accent)]"
                  checked={p.active}
                  onChange={(e) => void put(p.slug, { active: e.target.checked })}
                />
                <span className={p.active ? '' : 'text-muted line-through'}>
                  {p.emoji ? `${p.emoji} ` : ''}
                  {p.label}
                </span>
              </label>
              {p.custom ? (
                <button
                  type="button"
                  className="text-sm text-muted hover:text-ink"
                  aria-label={`Delete ${p.label}`}
                  onClick={() => void remove(p.slug)}
                >
                  Delete
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <form className="flex items-end gap-3" onSubmit={(e) => void add(e)}>
        <Field
          label="Add a platform"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" busy={name.trim() === ''}>
          Add
        </Button>
      </form>
      <p className="text-xs text-muted">
        An inactive platform drops out of the pickers; its past labels and earnings stay.
      </p>
    </section>
  );
}
