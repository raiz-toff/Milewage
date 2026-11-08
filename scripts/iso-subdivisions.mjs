#!/usr/bin/env node
// Writes the ISO 3166-2 subdivision codes the country tests check region codes against, from
// Unicode CLDR's validity data (Unicode-3.0 licence; used by tests only, never shipped).
// Usage: node scripts/iso-subdivisions.mjs [cldr-release-tag]   (default below)
/* global fetch */
import { writeFileSync } from 'node:fs';

const tag = process.argv[2] ?? 'release-49';
const url = `https://raw.githubusercontent.com/unicode-org/cldr/${tag}/common/validity/subdivision.xml`;
const OUT = 'packages/shared/test/fixtures/iso-3166-2.json';

const xml = await (await fetch(url)).text();
const regular = xml.match(/idStatus='regular'>([\s\S]*?)<\/id>/)?.[1];
if (!regular) throw new Error(`no regular subdivisions in ${url}`);

// CLDR writes `caon` for CA-ON, and `cans~u` for cans, cant, canu (the last letter runs on).
const codes = {};
// XML comments go, repeated until none is left (one pass could leave a nested `<!--` behind), and
// only tokens shaped like CLDR codes count, so a stray fragment can never become one.
let body = regular;
for (let last = ''; last !== body; ) {
  last = body;
  body = body.replace(/<!--[\s\S]*?-->/g, '');
}
const tokens = body
  .trim()
  .split(/\s+/)
  .filter((t) => /^[a-z0-9]+(~[a-z0-9])?$/.test(t));
for (const item of tokens) {
  const [first, last] = item.split('~');
  const stem = first.slice(0, -1);
  const from = first.at(-1).charCodeAt(0);
  const to = last ? last.charCodeAt(0) : from;
  for (let ch = from; ch <= to; ch++) {
    const code = stem + String.fromCharCode(ch);
    const country = code.slice(0, 2).toUpperCase();
    (codes[country] ??= []).push(`${country}-${code.slice(2).toUpperCase()}`);
  }
}

const out = {
  source: url,
  licence: 'Unicode-3.0 (https://www.unicode.org/license.txt)',
  note: 'CLDR subdivision codes with status regular; CLDR bases them on ISO 3166-2.',
  codes,
};
writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n');
console.log(`${OUT}: ${Object.values(codes).flat().length} codes`);
