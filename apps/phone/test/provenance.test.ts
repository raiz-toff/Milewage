import { readFileSync } from 'fs';
import { join } from 'path';

const note = readFileSync(
  join(__dirname, '..', 'native', 'comma-tracker', 'COPIED-FROM-COMMA.md'),
  'utf8',
);

describe('COPIED-FROM-COMMA.md', () => {
  it('records the source path, a full commit hash and the date', () => {
    expect(note).toContain('/home/coder/Production/commaApp/modules/comma-tracker');
    expect(note).toMatch(/Comma commit: `[0-9a-f]{40}`/);
    expect(note).toMatch(/Date copied: \d{4}-\d{2}-\d{2}/);
  });

  it('lists the copied files, including the ones M4.3 later removed', () => {
    const files = [
      ...note.matchAll(/^- `([^`]+\.(?:kt|ts|gradle|xml|json|swift|podspec)|LICENSE)`$/gm),
    ];
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(note).toContain('BootReceiver.kt');
    expect(note).toContain('ShiftOverlay.kt');
  });
});
