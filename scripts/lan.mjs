// The dev server on the home network (plan 28): with `npm run dev -- --host` Vite listens on the
// LAN, so the API is told its home address, which pairing codes then carry for phones.

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** The first private IPv4 address of this machine (os.networkInterfaces()), or null. */
export function homeIPv4(interfaces) {
  for (const list of Object.values(interfaces)) {
    for (const a of list ?? []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && PRIVATE_V4.test(a.address)) {
        return a.address;
      }
    }
  }
  return null;
}

/** `{homeUrl}` when the Vite arguments open it to the LAN (`--host`), else null. */
export function devLan(args, interfaces) {
  if (!args.some((a) => a === '--host' || a.startsWith('--host='))) return null;
  const i = args.findIndex((a) => a === '--port' || a.startsWith('--port='));
  const port = Number(i < 0 ? 5173 : args[i].includes('=') ? args[i].split('=')[1] : args[i + 1]);
  const ip = homeIPv4(interfaces);
  if (!ip || !Number.isInteger(port)) return null;
  return { homeUrl: `http://${ip}:${port}` };
}
