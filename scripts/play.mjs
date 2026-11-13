#!/usr/bin/env node
// Google Play, from this machine, through the Play Developer API (androidpublisher v3). No
// dependency: the service account's token is signed with node:crypto and every call is a fetch.
//
//   node scripts/play.mjs check                     the store files are complete and within Play's limits
//   node scripts/play.mjs listing                   text, icon, feature graphic and screenshots to Play
//   node scripts/play.mjs release [--track internal] [--status draft|completed] [--rollout 0.2]
//                                                   the App Bundle of VERSION, with its release notes
//   node scripts/play.mjs promote --from internal --track production [--rollout 0.2]
//                                                   the build on one track, moved to another (no upload)
//
// The store files live in apps/android/play/ (README.md there). The key is the service account's
// JSON file: MILEWAGE_PLAY_KEY, or $HOME/.milewage/play-service-account.json. It never goes in git.
// The App Bundle is apps/android/app/build/outputs/bundle/release/milewage-<VERSION>.aab, made by
// scripts/phone-release-build.sh, or --aab PATH.
import { Buffer } from 'node:buffer';
import { createSign } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { URLSearchParams, fileURLToPath } from 'node:url';

export const PACKAGE = 'app.milewage.phone';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/** Play's limits for the store text (characters). */
export const LIMITS = { title: 30, short: 80, full: 4000, notes: 500 };
/** The image folders under a listing, by Play's image type. */
export const IMAGES = {
  icon: 'icon',
  featureGraphic: 'feature-graphic',
  phoneScreenshots: 'phone-screenshots',
  sevenInchScreenshots: 'seven-inch-screenshots',
  tenInchScreenshots: 'ten-inch-screenshots',
};
const TRACKS = ['internal', 'alpha', 'beta', 'production'];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PLAY_DIR = join(ROOT, 'apps', 'android', 'play');

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();

/** The languages with a listing: the folders under play/listings (en-US, fr-CA ...). */
export function languages(dir = PLAY_DIR) {
  const base = join(dir, 'listings');
  return existsSync(base)
    ? readdirSync(base).filter((n) => /^[a-z]{2,3}(-[A-Z]{2})?$/.test(n))
    : [];
}

/** One language's store text and images, as files on disk. */
export function listing(lang, dir = PLAY_DIR) {
  const base = join(dir, 'listings', lang);
  const text = (name) => (existsSync(join(base, name)) ? read(join(base, name)) : '');
  const images = {};
  for (const [type, folder] of Object.entries(IMAGES)) {
    const path = join(base, folder);
    if (type === 'icon' || type === 'featureGraphic') {
      images[type] = existsSync(path + '.png') ? [path + '.png'] : [];
    } else {
      images[type] = existsSync(path)
        ? readdirSync(path)
            .filter((f) => /\.(png|jpe?g)$/i.test(f))
            .sort()
            .map((f) => join(path, f))
        : [];
    }
  }
  return {
    title: text('title.txt'),
    short: text('short-description.txt'),
    full: text('full-description.txt'),
    images,
  };
}

/** The release notes for a version, by language: play/release-notes/<lang>/<version>.txt. */
export function releaseNotes(version, dir = PLAY_DIR) {
  const base = join(dir, 'release-notes');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((lang) => existsSync(join(base, lang, `${version}.txt`)))
    .map((lang) => ({ language: lang, text: read(join(base, lang, `${version}.txt`)) }));
}

/** PNG width and height from its header; null for anything else. */
export function pngSize(file) {
  const b = readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** Everything Play would refuse, before anything is sent. Returns a list of problems in words. */
export function problems(version, dir = PLAY_DIR) {
  const out = [];
  const langs = languages(dir);
  if (!langs.length) out.push('no listing: add play/listings/en-US/');
  for (const lang of langs) {
    const l = listing(lang, dir);
    for (const [key, file] of [
      ['title', 'title.txt'],
      ['short', 'short-description.txt'],
      ['full', 'full-description.txt'],
    ]) {
      if (!l[key]) out.push(`${lang}: ${file} is empty`);
      else if ([...l[key]].length > LIMITS[key])
        out.push(
          `${lang}: ${file} is ${[...l[key]].length} characters, Play allows ${LIMITS[key]}`,
        );
    }
    const [icon] = l.images.icon;
    const iconSize = icon && pngSize(icon);
    if (!icon) out.push(`${lang}: no icon.png (512 x 512)`);
    else if (!iconSize || iconSize.width !== 512 || iconSize.height !== 512)
      out.push(`${lang}: icon.png must be a 512 x 512 PNG`);
    const [feature] = l.images.featureGraphic;
    const featureSize = feature && pngSize(feature);
    if (!feature) out.push(`${lang}: no feature-graphic.png (1024 x 500)`);
    else if (!featureSize || featureSize.width !== 1024 || featureSize.height !== 500)
      out.push(`${lang}: feature-graphic.png must be a 1024 x 500 PNG`);
    const shots = l.images.phoneScreenshots;
    if (shots.length < 2)
      out.push(`${lang}: Play needs at least 2 phone screenshots (has ${shots.length})`);
    if (shots.length > 8)
      out.push(`${lang}: Play takes at most 8 phone screenshots (has ${shots.length})`);
    for (const s of shots) {
      const size = pngSize(s);
      if (!size) continue;
      const long = Math.max(size.width, size.height);
      const short = Math.min(size.width, size.height);
      if (short < 320 || long > 3840 || long > 2 * short)
        out.push(
          `${lang}: ${s.split(/[\\/]/).pop()} is ${size.width} x ${size.height}; sides 320 to 3840 px, the long side at most twice the short`,
        );
    }
  }
  if (version) {
    const notes = releaseNotes(version, dir);
    if (!notes.length)
      out.push(`no release notes for ${version}: play/release-notes/en-US/${version}.txt`);
    for (const n of notes) {
      if (!n.text) out.push(`${n.language}: the release notes for ${version} are empty`);
      else if ([...n.text].length > LIMITS.notes)
        out.push(
          `${n.language}: the release notes for ${version} are ${[...n.text].length} characters, Play allows ${LIMITS.notes}`,
        );
    }
  }
  return out;
}

// --- The API ------------------------------------------------------------------------------------

const b64url = (s) => Buffer.from(s).toString('base64url');

export function keyFile() {
  return process.env.MILEWAGE_PLAY_KEY || join(homedir(), '.milewage', 'play-service-account.json');
}

/** An access token for the service account (a signed JWT exchanged at Google's token endpoint). */
async function accessToken() {
  const file = keyFile();
  if (!existsSync(file))
    throw new Error(
      `No Play service account key at ${file}. Make one (apps/android/play/README.md, "Once") or set MILEWAGE_PLAY_KEY.`,
    );
  const key = JSON.parse(readFileSync(file, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: key.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createSign('RSA-SHA256')
    .update(`${head}.${claims}`)
    .sign(key.private_key, 'base64url');
  const res = await globalThis.fetch(key.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${claims}.${signature}`,
    }),
  });
  const body = await res.json();
  if (!res.ok)
    throw new Error(
      `Google refused the service account key: ${body.error_description ?? body.error}`,
    );
  return body.access_token;
}

function client(token) {
  async function call(method, url, { json, data, type } = {}) {
    const headers = { authorization: `Bearer ${token}` };
    let body;
    if (json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (data !== undefined) {
      headers['content-type'] = type;
      body = data;
    }
    const res = await globalThis.fetch(url, { method, headers, body });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const message = parsed.error?.message ?? text;
      throw new Error(
        `Play said ${res.status} to ${method} ${url.replace(/\?.*/, '')}: ${message}`,
      );
    }
    return parsed;
  }
  return {
    async edit(work) {
      const { id } = await call('POST', `${API}/${PACKAGE}/edits`, { json: {} });
      const at = `${API}/${PACKAGE}/edits/${id}`;
      const up = `${UPLOAD}/${PACKAGE}/edits/${id}`;
      try {
        await work({ call, at, up });
        await call('POST', `${at}:commit`);
      } catch (e) {
        await call('DELETE', at).catch(() => {});
        throw e;
      }
    },
  };
}

async function uploadListing(api) {
  await api.edit(async ({ call, at, up }) => {
    for (const lang of languages()) {
      const l = listing(lang);
      await call('PUT', `${at}/listings/${lang}`, {
        json: {
          language: lang,
          title: l.title,
          shortDescription: l.short,
          fullDescription: l.full,
        },
      });
      console.log(`${lang}: text`);
      for (const [type, files] of Object.entries(l.images)) {
        if (!files.length) continue;
        await call('DELETE', `${at}/listings/${lang}/${type}`);
        for (const f of files) {
          const mime = /\.png$/i.test(f) ? 'image/png' : 'image/jpeg';
          await call('POST', `${up}/listings/${lang}/${type}?uploadType=media`, {
            data: readFileSync(f),
            type: mime,
          });
        }
        console.log(`${lang}: ${type} (${files.length})`);
      }
    }
  });
}

async function uploadRelease(api, { version, aab, track, status, rollout }) {
  const notes = releaseNotes(version);
  await api.edit(async ({ call, at, up }) => {
    console.log(`Uploading ${aab} ...`);
    const bundle = await call('POST', `${up}/bundles?uploadType=media`, {
      data: readFileSync(aab),
      type: 'application/octet-stream',
    });
    const release = {
      name: version,
      versionCodes: [String(bundle.versionCode)],
      status,
      releaseNotes: notes,
    };
    if (status === 'inProgress') release.userFraction = rollout;
    await call('PUT', `${at}/tracks/${track}`, { json: { track, releases: [release] } });
    console.log(
      `MileWage ${version} (versionCode ${bundle.versionCode}) on the ${track} track, ${status}.`,
    );
  });
}

/** The build already on one track, moved to another (no upload: Play takes a versionCode once). */
async function promote(api, { version, from, track, status, rollout }) {
  await api.edit(async ({ call, at }) => {
    const source = await call('GET', `${at}/tracks/${from}`);
    const latest = (source.releases ?? []).find((r) => r.versionCodes?.length);
    if (!latest) throw new Error(`Nothing on the ${from} track to promote.`);
    const release = {
      name: latest.name ?? version,
      versionCodes: latest.versionCodes,
      status,
      releaseNotes: latest.releaseNotes ?? releaseNotes(version),
    };
    if (status === 'inProgress') release.userFraction = rollout;
    await call('PUT', `${at}/tracks/${track}`, { json: { track, releases: [release] } });
    console.log(
      `${release.name} (versionCode ${latest.versionCodes.join(', ')}) from ${from} to ${track}, ${status}.`,
    );
  });
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    out[a.slice(2)] = next && !next.startsWith('--') ? (i++, next) : true;
  }
  return out;
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const opts = args(rest);
  const version = read(join(ROOT, 'VERSION'));
  if (!['check', 'listing', 'release', 'promote'].includes(mode)) {
    console.error(
      'Usage: play.mjs check | listing | release [--track internal] [--status draft|completed] [--rollout 0.2] [--aab PATH]\n' +
        '       play.mjs promote --from internal --track production [--rollout 0.2]',
    );
    process.exit(2);
  }
  const bad = mode === 'promote' ? [] : problems(mode === 'listing' ? null : version);
  if (bad.length) {
    for (const p of bad) console.error(`- ${p}`);
    process.exit(1);
  }
  if (mode === 'check') {
    console.log(`Play files ok for ${version} (${languages().join(', ')}).`);
    return;
  }
  const api = client(await accessToken());
  if (mode === 'listing') return uploadListing(api);

  const track = opts.track ?? 'internal';
  if (!TRACKS.includes(track)) throw new Error(`--track must be one of ${TRACKS.join(', ')}`);
  const rollout = opts.rollout === undefined ? null : Number(opts.rollout);
  if (rollout !== null && !(rollout > 0 && rollout < 1))
    throw new Error('--rollout is a fraction between 0 and 1, like 0.2');
  // A staged rollout is "inProgress"; an app not yet published on Play only takes drafts.
  const status = opts.status ?? (rollout !== null ? 'inProgress' : 'completed');
  if (!['draft', 'completed', 'inProgress', 'halted'].includes(status))
    throw new Error(`unknown --status ${status}`);
  if (mode === 'promote') {
    const from = opts.from ?? 'internal';
    if (!TRACKS.includes(from) || from === track)
      throw new Error('--from and --track must be two different tracks');
    return promote(api, { version, from, track, status, rollout });
  }
  const aab =
    typeof opts.aab === 'string'
      ? opts.aab
      : join(
          ROOT,
          'apps',
          'android',
          'app',
          'build',
          'outputs',
          'bundle',
          'release',
          `milewage-${version}.aab`,
        );
  if (!existsSync(aab))
    throw new Error(`No App Bundle at ${aab}: run scripts/phone-release-build.sh first.`);
  try {
    await uploadRelease(api, { version, aab, track, status, rollout });
  } catch (e) {
    if (/draft app/i.test(e.message))
      throw new Error(
        `${e.message}\nThe app is not published yet, so Play only takes a draft: add --status draft.`,
      );
    throw e;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
