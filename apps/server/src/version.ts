import pkg from '../package.json' with { type: 'json' };

/** Sent as `X-MileWage-Server`; one source with the other package versions (`npm run version:check`). */
export const SERVER_VERSION: string = pkg.version;
