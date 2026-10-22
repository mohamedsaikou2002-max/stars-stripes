#!/usr/bin/env python3
"""Validate reviewed JSONL source passages, then optionally import to a separate backend.
Input records: id,title,url,jurisdiction,category,retrieved_at,text; optional effective_date.
Default is validation only. --upload calls the sa_records_upsert RPC (service role only) and needs
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
"""
import argparse,datetime,json,os,urllib.parse,urllib.request
from pathlib import Path
ALLOWED={'id','title','url','jurisdiction','category','retrieved_at','text','effective_date','license','author'}
def validate(row):
    required=ALLOWED-{'effective_date','license','author'}
    if not required<=row.keys() or row.keys()-ALLOWED:raise ValueError('Incorrect fields')
    if any(not isinstance(row[k],str) or not row[k].strip() for k in required):raise ValueError('Empty or invalid field')
    if urllib.parse.urlparse(row['url']).scheme!='https':raise ValueError('HTTPS source URL required')
    if len(row['text'])>10000:raise ValueError('Chunk exceeds 10000 characters')
    dt=datetime.datetime.fromisoformat(row['retrieved_at'].replace('Z','+00:00'))
    if dt.tzinfo is None:raise ValueError('retrieved_at must include timezone')
    if row.get('effective_date'):datetime.date.fromisoformat(row['effective_date'])
    return row
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('jsonl',type=Path,nargs='+');ap.add_argument('--upload',action='store_true')
    ap.add_argument('--owner',help='account UUID for a PRIVATE corpus; omit for the shared corpus')
    ap.add_argument('--dump-payload',type=Path,help='write the RPC payload JSON instead of uploading (for review/testing)')
    args=ap.parse_args()
    rows=[validate(json.loads(line)) for f in args.jsonl for line in f.read_text().splitlines() if line.strip()]
    if len({r['id'] for r in rows})!=len(rows):raise ValueError('Duplicate passage IDs')
    print(f'Validated {len(rows)} passages')
    records=[{'source_origin':r['id'].rsplit('-',1)[0][:100],'category':r['category'],'payload':r} for r in rows]
    batches=[records[i:i+100] for i in range(0,len(records),100)]
    if args.dump_payload:
        args.dump_payload.write_text(json.dumps({'p_owner':args.owner,'p_records':batches[0] if batches else []}));print('wrote first batch payload')
    if args.upload:
        base=os.environ['SUPABASE_URL'].rstrip('/'); key=os.environ['SUPABASE_SERVICE_ROLE_KEY']
        if urllib.parse.urlparse(base).scheme!='https':raise ValueError('HTTPS backend required')
        for b in batches:
            req=urllib.request.Request(base+'/rest/v1/rpc/sa_records_upsert',data=json.dumps({'p_owner':args.owner,'p_records':b}).encode(),method='POST',headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=120) as res:res.read()
        print(f'Imported {len(rows)} passages into '+('the private corpus of '+args.owner if args.owner else 'the shared corpus'))
