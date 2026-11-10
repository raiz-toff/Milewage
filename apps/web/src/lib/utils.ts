import { createCn } from 'cn/config';

const sizes = ['large', 'medium', 'small'] as const;
const roles = ['display', 'headline', 'title', 'body', 'label'] as const;

/** The Material type scale utilities (index.css): `text-title-medium`, ... */
export const typeScale = roles.flatMap((r) => sizes.map((s) => `${r}-${s}`));

/**
 * Class merging (clsx + tailwind-merge, through shadcn's `cn`), told about the Material utilities
 * of index.css. Without this, `text-title-medium` reads as a text colour, so a later
 * `text-on-surface` would drop it; and the corner and elevation names would merge with nothing.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [{ text: typeScale }],
      rounded: [{ rounded: ['extra-small', 'small', 'medium', 'large', 'extra-large'] }],
      shadow: [
        {
          shadow: [
            'elevation-0',
            'elevation-1',
            'elevation-2',
            'elevation-3',
            'elevation-4',
            'elevation-5',
          ],
        },
      ],
      ease: [
        {
          ease: [
            'standard',
            'standard-accelerate',
            'standard-decelerate',
            'emphasized',
            'emphasized-accelerate',
            'emphasized-decelerate',
          ],
        },
      ],
    },
  },
});
