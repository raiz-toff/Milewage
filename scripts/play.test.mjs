import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { LIMITS, PLAY_DIR, listing, pngSize, problems, releaseNotes } from './play.mjs';

/** A PNG header of the given size: all that the checks read. */
function png(file, width, height) {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  writeFileSync(file, b);
}

function store({
  title = 'MileWage',
  shots = [
    [1080, 2160],
    [1080, 2160],
  ],
  notes = 'Faster.',
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'play-'));
  const en = join(dir, 'listings', 'en-US');
  mkdirSync(join(en, 'phone-screenshots'), { recursive: true });
  writeFileSync(join(en, 'title.txt'), title + '\n');
  writeFileSync(join(en, 'short-description.txt'), 'Mileage on your own server.');
  writeFileSync(join(en, 'full-description.txt'), 'Long text.');
  png(join(en, 'icon.png'), 512, 512);
  png(join(en, 'feature-graphic.png'), 1024, 500);
  shots.forEach(([w, h], i) => png(join(en, 'phone-screenshots', `${i + 1}.png`), w, h));
  mkdirSync(join(dir, 'release-notes', 'en-US'), { recursive: true });
  if (notes !== null) writeFileSync(join(dir, 'release-notes', 'en-US', '1.0.0.txt'), notes);
  return dir;
}

test('a complete store passes', () => {
  expect(problems('1.0.0', store())).toEqual([]);
});

test('text over Play limits, missing notes and too few screenshots are named', () => {
  const dir = store({ title: 'x'.repeat(LIMITS.title + 1), shots: [[1080, 2160]], notes: null });
  expect(problems('1.0.0', dir)).toEqual([
    'en-US: title.txt is 31 characters, Play allows 30',
    'en-US: Play needs at least 2 phone screenshots (has 1)',
    'no release notes for 1.0.0: play/release-notes/en-US/1.0.0.txt',
  ]);
});

test('a screenshot taller than twice its width is refused', () => {
  const [p] = problems(
    '1.0.0',
    store({
      shots: [
        [1080, 2160],
        [1080, 2340],
      ],
    }),
  );
  expect(p).toMatch(/2\.png is 1080 x 2340/);
});

test('a wrong icon size is refused', () => {
  const dir = store();
  png(join(dir, 'listings', 'en-US', 'icon.png'), 500, 500);
  expect(problems(null, dir)).toEqual(['en-US: icon.png must be a 512 x 512 PNG']);
});

test('listing and notes read the files', () => {
  const dir = store();
  expect(listing('en-US', dir)).toMatchObject({
    title: 'MileWage',
    short: 'Mileage on your own server.',
  });
  expect(listing('en-US', dir).images.phoneScreenshots).toHaveLength(2);
  expect(releaseNotes('1.0.0', dir)).toEqual([{ language: 'en-US', text: 'Faster.' }]);
});

test("the repository's own store text and pictures are within Play's limits", () => {
  const listingOnly = problems(null).filter((p) => !/phone screenshots/.test(p));
  expect(listingOnly).toEqual([]);
  expect(pngSize(join(PLAY_DIR, 'listings', 'en-US', 'icon.png'))).toEqual({
    width: 512,
    height: 512,
  });
});
