import { rm, cp } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const target = new URL('dist/', root);
await rm(target, { recursive: true, force: true });
await cp(new URL('public/', root), target, { recursive: true });
console.log('Built dist/');
