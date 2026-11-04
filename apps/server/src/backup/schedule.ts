import type { ModuleJob } from '@milewage/shared';
import type { BackupService } from './service';

const DAY = 24 * 60 * 60 * 1000;

function parts(ms: number, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(ms);
  const n = (type: string) => Number(f.find((p) => p.type === type)!.value);
  return {
    y: n('year'),
    mo: n('month'),
    d: n('day'),
    h: n('hour'),
    mi: n('minute'),
    s: n('second'),
  };
}

/** Local minus UTC, in ms, at an instant. */
function offsetMs(ms: number, timeZone: string): number {
  const p = parts(ms, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** The first instant after `now` at which the wall clock in `timeZone` reads `hour:minute` (nightly 03:30). */
export function nextRunAt(now: number, timeZone: string, hour = 3, minute = 30): number {
  for (let ahead = 0; ahead <= 2; ahead++) {
    const day = parts(now + ahead * DAY, timeZone);
    const wall = Date.UTC(day.y, day.mo - 1, day.d, hour, minute);
    let t = wall - offsetMs(wall, timeZone);
    t = wall - offsetMs(t, timeZone); // second pass settles the offset across a DST change
    if (t > now) return t;
  }
  return now + DAY;
}

/** Nightly backup at the instance's local 03:30 (10 section 3.1); a failure is logged and tomorrow still runs. */
export function nightlyBackupJob(
  service: BackupService,
  now: () => number,
  log: (message: string, fields?: object) => void = () => {},
): ModuleJob {
  return {
    name: 'nightly-backup',
    start() {
      service.cleanTemp();
      let timer: NodeJS.Timeout | undefined;
      const arm = () => {
        const wait = Math.min(nextRunAt(now(), service.timeZone()) - now(), 2 ** 31 - 1);
        timer = setTimeout(() => {
          service
            .run('nightly')
            .then(
              () => log('nightly backup done'),
              (e: Error) => log('nightly backup failed', { error: e.message }),
            )
            .finally(arm);
        }, wait);
        timer.unref();
      };
      arm();
      return () => clearTimeout(timer);
    },
  };
}
