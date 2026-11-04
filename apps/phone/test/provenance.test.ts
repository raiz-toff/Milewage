import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const dir = join(__dirname, '..', 'native', 'comma-tracker');
const note = readFileSync(join(dir, 'COPIED-FROM-COMMA.md'), 'utf8');

function walk(d: string): string[] {
  // Gradle writes build output next to the sources; it is ignored by version control.
  return readdirSync(d).flatMap((n) => {
    if (n === 'build' || n === '.gradle') return [];
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [relative(dir, p)];
  });
}

describe('COPIED-FROM-COMMA.md', () => {
  it('records the source path, a full commit hash and the date', () => {
    expect(note).toContain('/home/coder/Production/commaApp/modules/comma-tracker');
    expect(note).toMatch(/Comma commit: `[0-9a-f]{40}`/);
    expect(note).toMatch(/Date copied: \d{4}-\d{2}-\d{2}/);
  });

  it('lists exactly the files present in the directory', () => {
    const block = note.split('<!-- files:start -->')[1]?.split('<!-- files:end -->')[0] ?? '';
    const listed = [...block.matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]).sort();
    const present = walk(dir)
      .filter((f) => f !== 'COPIED-FROM-COMMA.md')
      .sort();
    expect(listed).toEqual(present);
  });
});
