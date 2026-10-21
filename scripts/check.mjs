import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('public/index.html', 'utf8');
const context = vm.createContext({});
vm.runInContext(readFileSync('public/baht.js', 'utf8'), context);
const check = readFileSync('public/test_baht.html', 'utf8').match(/var CASES = (\[[\s\S]*?\n  \]);/)[1];
const cases = vm.runInContext(check, context);
for (const [amount, expected] of cases) assert.equal(context.bahtText(amount), expected);
for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
assert.match(html, /id="batch-print"/);
assert.match(readFileSync('public/retro.css', 'utf8'), /@media screen/);
const config = (await import('../next.config.mjs')).default;
const routes = await config.rewrites();
assert.equal(routes[0].destination, 'http://127.0.0.1:8787/api/:path*');
console.log(`ALL ${cases.length} money checks PASS; scripts, print container, and local API proxy OK`);
