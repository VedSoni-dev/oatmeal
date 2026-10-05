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

## Publik API

`desktop/core/publik.mjs` adapts the [TypeScript reference](https://publikhq.com/sdk/publik.ts.md) for the Electron main process. Only chat is connected; transcription remains local. The model selector accepts `publik-fast` (default), `publik-balanced`, and `publik-smart`.

Credential precedence: a personal publik key saved in Oatmeal's encrypted settings, then `PUBLIK_API_KEY` / `PUBLIK_API_BASE_URL`, then the provisioned per-app file. With none present, the UI shows the full disclosure and provisions only after the user clicks Accept. No install or wallet request happens just by selecting the provider. Returning from the account-link browser refreshes the visible balance card.

The public app token comes from `PUBLIK_APP_TOKEN` or a root `publik-app-token.txt`, which Electron Builder includes in the app archive. A `pat_` token is public by design and may be committed. The registered listing is [oatmeal-vedsoni-dev](https://publikhq.com/oatmeal-vedsoni-dev), owned by the publisher of `VedSoni-dev/oatmeal`. The shorter `oatmeal` slug belongs to a different repository. The public app token is committed and packaged; personal-key and local options work independently of it.

Provisioned `pk_` keys are atomically saved with mode 0600 under `~/Library/Application Support/publik/apps/oatmeal-vedsoni-dev.json` on Mac or `%LOCALAPPDATA%/publik/apps/oatmeal-vedsoni-dev.json` on Windows, following Publik's shared credential convention. They never enter IPC responses, screenshots, logs, exports, or repository files. Personal keys pasted into Settings use OS encryption instead.

The first-run card shows the balance, the returned cost disclosure verbatim, and one account-link button. Metering headers update the card. A 402 displays the service's message and its one action URL; other providers stay selectable. Logs contain only app slug, requested tier, HTTP status and charge. Requests reject redirects and oversized bodies, and carry idempotency keys. Credential provisioning fails visibly if its required disk write fails; an optional balance-cache write failure does not discard a completed model answer.
