import base from './vite.config.ts';
const api = 'http://127.0.0.1:3160';
const b = typeof base === 'function' ? base({ mode: 'development', command: 'serve' }) : base;
const proxy = { ...b.server.proxy };
for (const k of Object.keys(proxy)) {
  proxy[k] = typeof proxy[k] === 'string' ? api : { ...proxy[k], target: api };
}
export default { ...b, server: { ...b.server, port: 5175, strictPort: true, proxy } };
