import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
for (const legacy of [true, false]) {
  const collections = ['articles', 'highlights', 'glosses', 'briefs', 'progress'];
  const seen = Object.fromEntries(collections.map(c => [c, {}]));
  seen.articles.lost = [legacy ? '{"id":"lost","title":"large old baseline"}' : 'v2:5:a:b', 'lost'];
  const storage = new Map([['gloss:sync:chandler', JSON.stringify({ seen, since: '2026-10-26T18:00:00Z', fullAt: new Date().toISOString() })]]);
  const st = { library: [], highlights: {}, glosses: {}, briefs: {}, progress: {}, applyRemote: changes => { st.library = changes.articles.map(r => r.data); } };
  const paths=[]; const pushes=[];
  const context=vm.createContext({ console, document: { visibilityState: 'visible', addEventListener(){}, removeEventListener(){} },
    localStorage: { getItem:k=>storage.get(k)||null, setItem:(k,v)=>storage.set(k,v), removeItem:k=>storage.delete(k) },
    useStore: { getState:()=>st, subscribe:()=>()=>{} }, forgetDoc:async()=>{},forgetCover:async()=>{},loadDoc:async()=>null, saveDoc:async()=>{},
    setInterval:()=>1, clearInterval(){}, setTimeout, clearTimeout,
    fetch: async(path,opts)=> { paths.push(path); if(opts) { pushes.push(JSON.parse(opts.body)); return {ok:true,json:async()=>({})}; } return {ok:true,json:async()=>({now:new Date().toISOString(),changes:{articles:[{id:'lost',articleId:'lost',data:{id:'lost',title:'Recovered'}}]}})}; },
  });
  const source=readFileSync('lib/sync.ts','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
  vm.runInContext(stripTypeScriptTypes(source)+'\nglobalThis.startSync = startSync;',context);
  const sync=context.startSync('chandler');
  await new Promise(r=>setTimeout(r,30));
  assert.equal(paths[0],'/api/sync');
  assert.equal(st.library[0].id,'lost');
  assert.equal(pushes.length,0);
  const saved=JSON.parse(storage.get('gloss:sync:chandler'));
  assert.match(saved.seen.articles.lost[0],/^v2:/);
  assert.ok(saved.seen.articles.lost[0].length<64);
  sync.stop();
}
console.log('PASS: legacy oversized baselines and missing cached shelves force full recovery before push; compact fingerprints persist.');
