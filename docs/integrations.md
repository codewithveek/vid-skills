# Use it from any model or tool

## MCP clients

**Claude Code**: this repo ships `.mcp.json`, so `claude` in the repo picks it up. As a plugin: `/plugin marketplace add codewithveek/vid-skills`, then `/plugin install vid-skills` (adds the skills, the `video-producer` agent and the MCP server).

**Claude Desktop / Cursor / Windsurf / Cline / Goose / Zed**: add to the client's MCP config:

```json
{ "mcpServers": { "vid-skills": { "command": "node", "args": ["/path/to/vid-skills/packages/cli/bin/vidsk.mjs", "mcp"], "env": { "ANTHROPIC_API_KEY": "…", "VIDSK_OUT": "/path/to/out" } } } }
```

**Codex CLI** (`~/.codex/config.toml`):

```toml
[mcp_servers.vid-skills]
command = "node"
args = ["/path/to/vid-skills/packages/cli/bin/vidsk.mjs", "mcp"]
```

**Gemini CLI**: `gemini extensions install https://github.com/codewithveek/vid-skills` (uses `gemini-extension.json`).

**Remote (any MCP client with Streamable HTTP)**: `https://<worker>/mcp` with header `Authorization: Bearer <VIDSK_API_TOKEN>`, or `vidsk serve` locally (`http://localhost:8787/mcp`).

## Function calling without MCP

```bash
vidsk tools --format openai     > tools.openai.json     # OpenAI, Groq, Mistral, OpenRouter, vLLM, Ollama
vidsk tools --format anthropic  > tools.anthropic.json
vidsk tools --format gemini     > tools.gemini.json
```

Execute each call with `POST /api/tools/<name>` (JSON body = arguments) against `vidsk serve` or the Worker, or call `new VidSkillsMcp(ctx).callTool(name, args)` in-process.

## No-code / workflow tools

- **OpenAPI 3.1**: `GET /openapi.json` works with ChatGPT custom GPT Actions, n8n HTTP nodes, Zapier, Make, Dify, Flowise and Langflow.
- **Webhooks out**: set `PUBLISH_WEBHOOK_URL` to hand finished videos to Buffer, Ayrshare or your own automation.

## Agent frameworks

- **OpenAI Agents SDK / LangChain / LlamaIndex / CrewAI / Mastra**: connect through their MCP adapters to `vidsk mcp` or the HTTP endpoint, or load the exported function schemas.
- **Library**: `import { runPipeline } from "@vid-skills/core"` plus `providersFromEnv` and `createPublisher`. This is the same code the CLI and Worker run.

## Skills format

`skills/*/SKILL.md` follow the Agent Skills format (YAML frontmatter `name` + `description`, markdown body). They work in Claude Code / Claude.ai skills, Codex, and any agent that loads markdown instructions. `AGENTS.md` is the entry point for agents that read it.
