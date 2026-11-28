#!/bin/bash
# Build (or resume) a replay as a framed-explainer video.
#   build.sh OUT make   replay:dir:job:name ...
#   build.sh OUT resume replay:dir:job:name:stage,stage,... ...
# Brian voice (ElevenLabs via the proxy), Wikimedia + Pexels stock, poster cut. Prints check/assets/QA
# and writes <dir>/<name>.{mp4,srt,cover.jpg} plus a contact sheet at <dir>/sheet/sheet.jpg.
OUT=$1; MODE=$2; shift 2
cd "$(dirname "$0")/../../.."
for spec in "$@"; do
  IFS=: read r d j n f <<< "$spec"
  mkdir -p $OUT/$d
  ENV=(PATH=$PATH HOME=$HOME HTTPS_PROXY=$HTTPS_PROXY HTTP_PROXY=$HTTP_PROXY NO_PROXY=$NO_PROXY NODE_EXTRA_CA_CERTS=${NODE_EXTRA_CA_CERTS:-/root/.ccr/ca-bundle.crt}
    NODE_USE_ENV_PROXY=1 VIDSK_LOCAL_STT=0 VIDSK_RESEARCH=none VIDSK_STOCK=wikimedia,pexels VIDSK_SFX=procedural VIDSK_MUSIC=
    ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY:-proxy-injected} PEXELS_API_KEY=$PEXELS_API_KEY
    VIDSK_TTS=elevenlabs:${VOICE:-nPczCjzI2devNBz1zQrb} VIDSK_LLM=static:examples/replay/$r.json)
  if [ "$MODE" = make ]; then
    topic=$(python3 -c "import json;print(json.load(open('examples/replay/$r.json'))['ResearchDossier']['topic'])")
    env -i "${ENV[@]}" node packages/cli/bin/vidsk.mjs make "$topic" --handle @hiddeninplainsight.tv --out $OUT/$d --job $j > $OUT/$d/make.log 2>&1
  else
    env -i "${ENV[@]}" node packages/cli/bin/vidsk.mjs resume $j --out $OUT/$d --force $f > $OUT/$d/resume.log 2>&1
  fi
  echo "$j EXIT $?"
  node packages/cli/bin/vidsk.mjs check $OUT/$d/$j/project 2>&1 | python3 -c "
import json,sys; d=json.load(sys.stdin); print('$j check ok',d['ok'],'errors',len(d['errors']),'warnings',len(d['warnings'])); [print(' ',w.get('code'),w.get('message','')[:200]) for w in d['errors']+d['warnings']]"
  python3 -c "
import json
a=json.load(open('$OUT/$d/.vidsk/jobs/$j/stages/assets.json'))
for x in a['assets']: print(' ',x.get('id'),x.get('provider'),x.get('width'),(x.get('license') or {}).get('url','')[-55:])
print(' ',json.load(open('$OUT/$d/.vidsk/jobs/$j/stages/render.json')))
q=json.load(open('$OUT/$d/.vidsk/jobs/$j/stages/qa.json')); print('  qa',q['score'],[i.get('code') for i in q.get('findings',[])])"
  grep -h -A2 "failed" $OUT/$d/make.log $OUT/$d/resume.log 2>/dev/null | grep -o "url: '[^?']*\|query: '[^']*" | sed 's/^/  FAILED /'
  (cd $OUT/$d && for e in mp4 srt cover.jpg; do [ -f $j.$e ] && cp $j.$e $n.$e; done
   mkdir -p sheet && ffmpeg -hide_banner -loglevel error -y -i $j.mp4 -vf "fps=1/1.5,scale=216:384,tile=8x5" -frames:v 1 sheet/sheet.jpg)
done
