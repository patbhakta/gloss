import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const context = vm.createContext({});
for (const [file, expose] of [['lib/article.ts', 'readingMinutes'], ['lib/library.ts', 'lookOf']]) {
  const source = readFileSync(file, 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
  vm.runInContext(stripTypeScriptTypes(source) + `\nglobalThis.${expose} = ${expose};`, context);
}
for (const value of [undefined, null, NaN, Infinity, -1, 0, 'missing']) {
  assert.equal(context.readingMinutes(value), 1);
  const look = context.lookOf({ id: 'migrated-book', topic: 'unsorted', minutes: value });
  assert.ok(Number.isFinite(look.w) && look.w > 0);
  assert.ok(Number.isFinite(look.h) && look.h > 0);
}
assert.equal(context.readingMinutes(460), 2);
console.log('PASS: imported rows without numeric word counts retain finite reading time and visible book geometry.');
