#!/usr/bin/env python3
"""Plot lane for HU-3247: embed Emory scene plots, keyed by gloss article_id.

Flat rows in plot_embeds (disposable, rebuildable — same law as para_embeds).
article_id 's05_e16_c03-66eab' -> scene 's05_e16_c03' -> Emory plots field.
"""
import json, glob, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

USER = 'chandler'
EMBED_URL = 'http://127.0.0.1:1234/v1/embeddings'
MODEL = 'text-embedding-nomic-embed-text-v1.5'

def psql(q):
    return subprocess.run(['sudo','-u','postgres','psql','-d','gloss','-t','-A','-c',q],
                          capture_output=True, text=True).stdout.strip()

psql("""CREATE TABLE IF NOT EXISTS plot_embeds (
  user_id text NOT NULL, article_id text NOT NULL, text text, vec jsonb,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, article_id));""")

plotmap = {}
for f in glob.glob('/tmp/character-mining/json/friends_season_*.json'):
    d = json.load(open(f))
    for ep in d['episodes']:
        for sc in ep['scenes']:
            p = sc.get('plots')
            if p: plotmap[sc['scene_id']] = ' '.join(p).strip()

arts = [l for l in psql(f"SELECT id FROM articles WHERE user_id='{USER}' AND deleted=false;").split('\n') if l]
todo = []
have = set(l.split('|')[0] for l in psql(f"SELECT article_id FROM plot_embeds WHERE user_id='{USER}' AND vec IS NOT NULL;").split('\n') if l)
for aid in arts:
    sid = aid.rsplit('-', 1)[0]
    if sid in plotmap and aid not in have:
        todo.append((aid, plotmap[sid]))
print(f'{len(todo)} plots to embed', flush=True)

def embed(item):
    aid, text = item
    req = urllib.request.Request(EMBED_URL,
        json.dumps({'model': MODEL, 'input': text}).encode(),
        {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        v = json.load(r)['data'][0]['embedding']
    return aid, text, json.dumps(v)

done = 0
def store(res):
    global done
    aid, text, v = res
    psql(f"INSERT INTO plot_embeds (user_id, article_id, text, vec) VALUES ('{USER}','{aid}','{text.replace(chr(39),chr(39)*2)}','{v}'::jsonb) ON CONFLICT (user_id, article_id) DO UPDATE SET text=EXCLUDED.text, vec=EXCLUDED.vec, updated_at=now();")
    done += 1
    if done % 100 == 0: print(f'{done}/{len(todo)}', flush=True)

with ThreadPoolExecutor(max_workers=4) as ex:
    for res in ex.map(embed, todo):
        store(res)
print(f'embedded {done}/{len(todo)}; total in table: {psql(f"SELECT count(*) FROM plot_embeds WHERE user_id=%s AND vec IS NOT NULL;" % ("chr(39)+USER+chr(39)"))}')
