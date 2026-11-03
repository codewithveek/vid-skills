# Demo render

`power-button-demo-contact-sheet.jpg` shows frames (every 0.83 s) from a 48.5 s video made entirely by this repo in a sandbox with **no API keys**:

```bash
VIDSK_LLM=static:examples/replay/power-button.json VIDSK_RESEARCH=none VIDSK_STOCK=openverse,wikimedia \
  node packages/cli/bin/vidsk.mjs make "the power button symbol" --duration 50 --handle @vidskills
```

- Voice: Kokoro-82M (`am_michael`) via the local `hyperframes tts`; words aligned by estimation
- Visuals: Wikimedia Commons (licenses recorded and credited), synthetic standards page, one placeholder card (Openverse timed out, so the circuit breaker disabled it for the job)
- Output: 1080×1920, 30 fps, H.264 + AAC 48 kHz, **−14.1 LUFS / −1.4 dBTP**, burned-in captions + SRT, QA PASS (97)
- Editable HyperFrames project: 17 scene compositions + chrome + captions, `hyperframes check`: 0 errors, 3 advisory warnings (the deliberately dim typewriter lead-in fails AA contrast, as in the reference)
