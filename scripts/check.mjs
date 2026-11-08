import { readFile, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('wrangler.jsonc', root), 'utf8'));
assert.equal(config.assets.directory, './dist');
const html = await readFile(new URL('public/index.html', root), 'utf8');
for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const file = match[1];
  if (/^(?:https?:|data:|#)/.test(file)) continue;
  await access(new URL('public/' + file, root));
}
assert(html.indexOf('src="app.js"') < html.indexOf('src="usability.js"'));
console.log('Static asset references and Cloudflare configuration passed');
