import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { fileBody } from '../api/client';
import { errorText, useApiQuery, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { builtinPlatform } from '@milewage/shared';
import { AddPhotoIcon, DeleteIcon, HidePhotoIcon, PaletteIcon } from '@/ui/icons';
import { Button as UiButton } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Button, Field, FormError } from '../ui/form';
import { PlatformBadge, PRESET_COLORS } from '../platforms/PlatformBadge';
import { RowMenu } from '../ui/RowMenu';
import type { RowAction } from '../ui/RowMenu';
import { slugOf } from '../platforms/usePlatforms';

type Platform = Schemas['Platform'];

/** What the server takes for a platform's logo (plan 25 section 7). */
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX_BYTES = 256 * 1024;

/**
 * The badge colour picker (TODO PL4b): the platform's default, the colour it has now when that is
 * not a preset, then the presets. Each choice is a radio drawn as the badge it would give, named
 * for screen readers; choosing one saves it.
 */
function ColourPicker({
  platform: p,
  onPick,
  onDone,
}: {
  platform: Platform;
  onPick: (color: string | null) => void;
  onDone: () => void;
}) {
  const current = p.color?.toLowerCase() ?? null;
  const options: { name: string; color: string | null }[] = [
    { name: builtinPlatform(p.slug)?.color ? 'Brand colour' : 'Automatic', color: null },
    ...(current && !PRESET_COLORS.some((c) => c.color === current)
      ? [{ name: 'Current colour', color: current }]
      : []),
    ...PRESET_COLORS,
  ];
  return (
    <fieldset className="space-y-2 pt-1 pb-2">
      <legend className="pb-2 text-title-small">Badge colour for {p.label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <label
            key={o.color ?? 'default'}
            title={o.name}
            className="relative grid size-11 cursor-pointer place-items-center rounded-full state-layer has-checked:bg-secondary-container has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
          >
            <input
              type="radio"
              name={`colour-${p.slug}`}
              aria-label={o.name}
              className="peer sr-only"
              checked={current === o.color}
              onChange={() => onPick(o.color)}
            />
            <PlatformBadge
              platform={{ ...p, color: o.color, logo_version: null }}
              size="md"
              className="peer-checked:ring-2 peer-checked:ring-on-secondary-container peer-checked:ring-offset-2 peer-checked:ring-offset-secondary-container"
            />
          </label>
        ))}
      </div>
      <UiButton type="button" variant="ghost" size="sm" onClick={onDone}>
        Done
      </UiButton>
    </fieldset>
  );
}

/** Settings card of the `platforms` module (18 section 4.2): switch platforms on or off, add your own. */
export function PlatformsCard() {
  const asked = useApiQuery('/platforms', { params: { query: { include_inactive: true } } });
  const list = asked.data ?? null;
  const change = useChange();
  const error = errorText(change, asked);
  const [name, setName] = useState('');
  const [colouring, setColouring] = useState<string | null>(null);
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
      label: 'Change colour',
      icon: PaletteIcon,
      onSelect: () => setColouring(p.slug),
    },
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
      <h3 className="text-title-medium">Your platforms</h3>
      <FormError message={error} />
      {list === null ? (
        <p className="text-muted-foreground">Loading</p>
      ) : (
        <ul className="divide-y divide-outline-variant rounded-lg border border-outline-variant">
          {list.map((p) => (
            <li key={p.slug} className="px-3 py-2">
              <div className="flex items-center gap-3">
                <PlatformBadge platform={p} size="md" className={p.active ? '' : 'opacity-50'} />
                <label
                  htmlFor={`platform-${p.slug}`}
                  className={`flex-1 text-body-large ${p.active ? '' : 'text-muted-foreground line-through'}`}
                >
                  {p.label}
                </label>
                <RowMenu name={p.label} actions={actions(p)} />
                <Switch
                  id={`platform-${p.slug}`}
                  checked={p.active}
                  onCheckedChange={(on) => void put(p.slug, { active: on })}
                />
              </div>
              {colouring === p.slug ? (
                <ColourPicker
                  platform={p}
                  onPick={(color) => void put(p.slug, { color })}
                  onDone={() => setColouring(null)}
                />
              ) : null}
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
      <p className="text-body-small text-muted-foreground">
        An inactive platform drops out of the pickers; its past labels and earnings stay.
      </p>
      <p className="text-body-small text-muted-foreground">
        A logo you add (PNG, JPEG or WebP, up to 256 KB) stays on your server and in its backups.
        Platform names and logos belong to their owners. MileWage is not affiliated with them.
      </p>
    </section>
  );
}
