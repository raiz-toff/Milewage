import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { Trash2 } from 'lucide-react';
import { Button as UiButton } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useSession } from '../session';
import { Button, Field, FormError } from '../ui/form';

type Platform = Schemas['Platform'];

/** The slug of a platform the driver names; empty when the name has no letters or digits. */
export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

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
    const slug = slugOf(name);
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
      <h3 className="text-base leading-snug font-medium">Your platforms</h3>
      <FormError message={error} />
      {list === null ? (
        <p className="text-muted-foreground">Loading</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {list.map((p) => (
            <li key={p.slug} className="flex items-center gap-3 px-3 py-2">
              <label
                htmlFor={`platform-${p.slug}`}
                className={`flex-1 text-sm ${p.active ? '' : 'text-muted-foreground line-through'}`}
              >
                {p.emoji ? `${p.emoji} ` : ''}
                {p.label}
              </label>
              {p.custom ? (
                <UiButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${p.label}`}
                  onClick={() => void remove(p.slug)}
                >
                  <Trash2 />
                </UiButton>
              ) : null}
              <Switch
                id={`platform-${p.slug}`}
                checked={p.active}
                onCheckedChange={(on) => void put(p.slug, { active: on })}
              />
            </li>
          ))}
        </ul>
      )}
      <form className="flex items-end gap-2" onSubmit={(e) => void add(e)}>
        <div className="flex-1">
          <Field
            label="Add a platform"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button type="submit" busy={name.trim() === ''}>
          Add
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        An inactive platform drops out of the pickers; its past labels and earnings stay.
      </p>
    </section>
  );
}
