# Render node: HyperFrames (headless Chrome + FFmpeg) + ffmpeg mastering + local Kokoro TTS
# + whisper transcription, behind the @vid-skills/renderer HTTP server.
# Used by the Cloudflare Container (apps/worker), and runs as-is on Docker, Cloud Run, Fly, ECS or k8s.
FROM node:22-bookworm-slim

ARG WITH_KOKORO=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg fonts-liberation fonts-noto-color-emoji python3 python3-pip \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 \
    libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
  && rm -rf /var/lib/apt/lists/*

# Open-source TTS for `hyperframes tts` (Kokoro-82M, Apache-2.0)
RUN if [ "$WITH_KOKORO" = "1" ]; then pip3 install --no-cache-dir --break-system-packages kokoro-onnx soundfile; fi

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY prompts ./prompts
COPY docs ./docs
COPY skills ./skills
COPY agents ./agents
RUN pnpm install --frozen-lockfile --filter @vid-skills/renderer... \
  && pnpm --filter @vid-skills/core --filter @vid-skills/renderer run build

# Bake Chrome (and the Kokoro model) so cold starts are just container boot.
RUN cd packages/renderer && npx --no-install hyperframes browser ensure \
  && if [ "$WITH_KOKORO" = "1" ]; then npx --no-install hyperframes tts "warm up" --output /tmp/warm.wav || true; fi

ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["node", "packages/renderer/dist/server.js"]
