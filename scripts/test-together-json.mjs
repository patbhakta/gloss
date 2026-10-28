import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = stripTypeScriptTypes(readFileSync('lib/together.ts', 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/export \{[\s\S]*?\} from "\.\/models";\n/g, '')
  .replace(/^(?:export )?type ToolCall =.*\n/gm, '')
  .replace(/(?:export )?type ChatMessage =[\s\S]*?;\n\ntype Chunk/, 'type Chunk')
  .replace(/type Chunk =[\s\S]*?};\n\nfunction contentText/, 'function contentText')
  .replace(/export type \{[^\n]+\}\n/g, '')
  .replace(/export type \{[^\n]+\} from "\.\/models";\n/g, '')
  .replace(/^type \{[^\n]+\} from "\.\/models";\n/gm, '')
  .replace(/export /g, ''));
const context = vm.createContext({
  fetch: async () => new Response(JSON.stringify({
    choices: [{ message: { content: [{ type: 'text', text: 'Here is the result:\n```json\n{"answer":"Pat, you got it."}\n```' }] } }],
    usage: { prompt_tokens: 2, completion_tokens: 4 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  Response,
  process: { env: {} },
  MODELS: { flash: { id: 'glm-5.3-flash', label: 'Flash' } },
  DEFAULT_MODEL: 'flash',
  costFor: () => 0,
});
vm.runInContext(source + '\nglobalThis.run = completeJSON;', context);
const result = await context.run({ model: 'flash', messages: [], apiKey: 'test-key' });
assert.equal(result.ok, true);
assert.equal(JSON.stringify(result.data), JSON.stringify({ answer: 'Pat, you got it.' }));
console.log('PASS: completeJSON accepts Together content parts and fenced JSON with preamble.');
