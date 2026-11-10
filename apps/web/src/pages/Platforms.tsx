import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { fileBody } from '../api/client';
import { errorText, useApiQuery, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { AddPhotoIcon, DeleteIcon, HidePhotoIcon } from '@/ui/icons';
import { Switch } from '@/components/ui/switch';
import { Button, Field, FormError } from '../ui/form';
import { PlatformBadge } from '../platforms/PlatformBadge';
import { RowMenu } from '../ui/RowMenu';
import type { RowAction } from '../ui/RowMenu';
import { slugOf } from '../platforms/usePlatforms';

type Platform = Schemas['Platform'];

/** What the server takes for a platform's logo (plan 25 section 7). */
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX_BYTES = 256 * 1024;

/** Settings card of the `platforms` module (18 section 4.2): switch platforms on or off, add your own. */
export function PlatformsCard() {
  const asked = useApiQuery('/platforms', { params: { query: { include_inactive: true } } });
  const list = asked.data ?? null;
  const change = useChange();
  const error = errorText(change, asked);
  const [name, setName] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const logoFor = useRef<string | null>(null);

  const put = (slug: string, body: Schemas['PlatformPut']) =>
    change.run((api) => api.PUT('/platforms/{slug}', { params: { path: { slug } }, body }));

  async function add(e: FormEvent) {
    e.preventDefault();
    const slug = slugOf(name);
    if (!slug) return change.setError('Use letters or digits in the name.');
    await put(slug, { label: name.trim() });
    setName('');
  }

  const remove = (slug: string) =>
    change.run((api) => api.DELETE('/platforms/{slug}', { params: { path: { slug } } }));

  /** The driver's own logo: the raw file with its type, as receipts are sent. */
  async function upload(file: File) {
    const slug = logoFor.current;
    if (!slug) return;
    if (!LOGO_TYPES.includes(file.type) || file.size > LOGO_MAX_BYTES) {
      return change.setError('Use a PNG, JPEG or WebP under 256 KB.');
    }
    await change.run((api) =>
      api.PUT('/platforms/{slug}/logo', { params: { path: { slug } }, ...fileBody(file) }),
    );
  }
  const pickLogo = (slug: string) => {
    logoFor.current = slug;
    picker.current?.click();
  };
  const actions = (p: Platform): RowAction[] => [
    {
      label: p.logo_version ? 'Change logo' : 'Add logo',
      icon: AddPhotoIcon,
      onSelect: () => pickLogo(p.slug),
    },
    ...(p.logo_version
      ? [
          {
            label: 'Remove logo',
            icon: HidePhotoIcon,
            onSelect: () =>
              void change.run((api) =>
                api.DELETE('/platforms/{slug}/logo', { params: { path: { slug: p.slug } } }),
              ),
          },
        ]
      : []),
    ...(p.custom
      ? [
          {
            label: 'Delete',
            icon: DeleteIcon,
            destructive: true,
            onSelect: () => void remove(p.slug),
          },
        ]
      : []),
  ];

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
              <PlatformBadge platform={p} size="md" className={p.active ? '' : 'opacity-50'} />
              <label
                htmlFor={`platform-${p.slug}`}
                className={`flex-1 text-sm ${p.active ? '' : 'text-muted-foreground line-through'}`}
              >
                {p.label}
              </label>
              <RowMenu name={p.label} actions={actions(p)} />
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
      <input
        ref={picker}
        type="file"
        accept={LOGO_TYPES.join(',')}
        aria-label="Logo image"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      <p className="text-xs text-muted-foreground">
        An inactive platform drops out of the pickers; its past labels and earnings stay.
      </p>
      <p className="text-xs text-muted-foreground">
        A logo you add (PNG, JPEG or WebP, up to 256 KB) stays on your server and in its backups.
        Platform names and logos belong to their owners. MileWage is not affiliated with them.
      </p>
    </section>
  );
}
