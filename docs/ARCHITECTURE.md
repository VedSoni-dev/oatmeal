# Desktop architecture

Oatmeal 2 uses Electron with a sandboxed, context-isolated renderer. This keeps the existing browser audio approach portable without maintaining separate WebKit and WebView2 capture paths. The browser/agent workflow is preserved separately.

## Boundaries

- The renderer loads bundled files through `oatmeal://app`. CSP disallows remote scripts and outbound browser connections. It receives a narrow preload API, not Node or generic IPC access.
- The main process owns files, credentials, workers, account runtimes and HTTP calls. IPC handlers check the top-level frame and validate input. External browser links are host-allowlisted.
- Speech and text models run in separate worker threads. Downloads and CPU inference do not block the notebook UI.
- AudioWorklet captures microphone and system lanes independently. Samples are resampled to 16 kHz and sent in six-second packets; partial packets flush on stop.
- Audio packets are atomically persisted before acknowledgement. A serial transcription queue reads packets from disk. Stable segment IDs deduplicate a packet if the app crashes between transcript save and audio deletion.
- Meeting updates are serialized per meeting and atomically renamed. Notes and arriving transcripts cannot overwrite one another through concurrent writes. Interrupted recordings are marked during startup.
- API keys use Electron `safeStorage` (Keychain-backed on Mac, DPAPI on Windows). Settings reads never return plaintext keys. Meeting text is stored unencrypted in the user's application data directory.

## AI providers

Local Whisper/Qwen use Transformers.js and ONNX Runtime. No localhost HTTP service is started. Optional Ollama connects to `127.0.0.1:11434`.

OpenAI, xAI and OpenRouter use Chat Completions; Claude API uses Anthropic Messages. API bases are fixed and redirects rejected. Empty output and HTTP errors are surfaced without relaying raw bodies that might echo private data. Model IDs are editable.

Long summaries use bounded chunks and hierarchical reduction. Direct questions reject oversized input instead of silently truncating it. For the built-in small local models, generation selects numbered statements and the app renders only original meeting excerpts. Invalid IDs and generated prose are discarded. Possible follow-ups use explicit commitment wording and remain labeled for review. This avoids inventing people and deadlines in freeform local summaries.

Subscription sign-in is owned by the official runtimes:

- **ChatGPT:** packaged Codex app-server over stdio, browser login, account status, ephemeral threads/turns. Configuration lives under Oatmeal's `accounts/codex`. Read-only mode, disabled shell tools/search, and rejected tool/approval callbacks constrain execution.
- **Claude:** packaged Agent SDK runtime, `auth login --claudeai`, then SDK `query()` with no tools, no MCP servers, no setting sources, no persistent session, and denied tool requests. Configuration lives under `accounts/claude`.
- Provider API-key environment variables are removed from subscription processes. Existing coding-agent configuration is not loaded.

Official references checked October 5, 2026:

- [Codex authentication](https://developers.openai.com/codex/auth/)
- [Codex app-server](https://developers.openai.com/codex/app-server/)
- [Claude Agent SDK subscription update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan): its June 15 update says announced billing changes are paused and SDK usage continues to draw from subscription limits.
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Electron audio capture](https://www.electronjs.org/docs/latest/api/desktop-capturer/)

## Publik: pending approval

The supplied [publik skill](https://publikhq.com/skills/api.md) explicitly requires plan approval before implementation/provisioning. Proposed app slug: `oatmeal`. After approval:

1. Browser-approved device flow for the public app token; store it in `publik-app-token.txt`.
2. Adapt the reference module with `publik-fast`, `publik-balanced`, and `publik-smart`; choose the cheapest suitable tier.
3. Consent before provisioning or sending text; preserve personal-key/local alternatives.
4. First-run balance/cost/link card and exact 402 message with the supplied action link.
5. Add the prescribed AGENTS.md block and verify a small real call after linking/credit setup.

No publik credentials, install registrations or billable calls have been created during this implementation.
