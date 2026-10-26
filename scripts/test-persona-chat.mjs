import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

let text = 'ALPHA nerves';
let calls = 0;
let searches = 0;
let fail = false;
const code = stripTypeScriptTypes(readFileSync('lib/persona-chat.ts', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, ''));
const context = vm.createContext({ Response, console, AbortSignal, process: { env: { GLM_BASE_URL: "http://subscription.invalid" } },
  db: () => ({ query: async (sql, params) => {
    assert.match(sql, /user_id = \$1/); assert.equal(params[0], 'monica');
    return [{ id: 'note', data: { title: 'Hosting note' }, doc: { blocks: [{ id: 'b000', runs: [{ text }] }] } }];
  }}),
  searchTexts: async (tenant) => { searches++; assert.equal(tenant, 'monica'); return { literal: [], semantic: [{ articleId: 'note', blockId: 'b000', snippet: 'ALPHA stale' }] }; },
  redactPII: value => ({ text: value }), DEFAULT_MODEL: 'flash',
  completeJSON: async ({ messages }) => {
    calls++;
    if (fail) return { ok: true, data: { answer: 'The limbic sources say: [note/b000]', references: [] } };
    const request = JSON.parse(messages[1].content);
    return { ok: true, data: { answer: request.evidence.length ? request.evidence[0].text + ' [1]' : 'Hey! Come on in.', references: request.evidence.length ? [1] : [] } };
  },
});
vm.runInContext(code + '\nglobalThis.chat = personaChat;', context);
const greet = await (await context.chat('monica', 'hey')).json();
assert.equal(greet.answer, 'Hey! Come on in.'); assert.equal(searches, 0);
const alpha = await (await context.chat('monica', 'hosting note?')).json();
text = 'BETA tenderness';
const beta = await (await context.chat('monica', 'hosting note now?')).json();
assert.match(alpha.answer, /ALPHA/); assert.match(beta.answer, /BETA/); assert.doesNotMatch(beta.answer, /stale/);
assert.equal(beta.sources[0].number, 1); assert.equal(beta.sources[0].blockId, 'b000');
fail = true;
const before = calls;
const failure = await context.chat('monica', 'hosting note?');
assert.equal(failure.status, 503); assert.equal(calls - before, 2);
assert.doesNotMatch(await failure.text(), /limbic sources|ALPHA|BETA/);
assert.equal((await context.chat('pat', 'hey')).status, 400);
console.log('PASS: greeting skips retrieval; tenant-scoped live hydration reflects edits; numbered sources; invalid writer output retries then fails without source dump; unknown persona rejected.');
