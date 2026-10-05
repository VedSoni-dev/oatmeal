# Oatmeal

A little space for your meetings. An open-source desktop meeting notebook for macOS and Windows, inspired by the workflow of Granola.

Listen to the conversation, jot down a few thoughts, and turn a local transcript into useful notes. No meeting bot joins your calls. You choose where the AI runs.

## Desktop app

- Searchable meeting library, editable notes, automatic saves, Markdown import/export.
- Microphone and optional system audio, transcribed separately as **You** and **Room**.
- Downloadable Whisper speech models and Qwen text models. No separate local runtime required.
- Summaries, decisions, action items, and questions about a meeting.
- OpenAI, Claude, Grok, and OpenRouter API keys, encrypted using the operating system.
- Publik API with Fast, Balanced and Smart tiers, consent-based setup, balance and account linking.
- ChatGPT sign-in through the official Codex runtime; Claude sign-in and generation through the official Claude Agent SDK.
- Optional Ollama integration and interrupted-recording recovery.

**Status:** active development. Mac development builds and automated tests are available. Windows installer configuration and CI are included; Windows hardware audio/sign-in verification is still required. Published, signed installers are not available yet. Publik's desktop integration and public app token are included. New installations must link their account and have sufficient credit before making AI requests.

## Run from source

Install Node.js 22 or newer, then:

```sh
git clone --branch codex/desktop-app https://github.com/VedSoni-dev/oatmeal.git
cd oatmeal
npm ci
npm start
```

The app opens in its own desktop window. No coding agent, browser server, Rust toolchain, or separate model runtime is needed.

1. Open **Settings** and download a speech model. Whisper Tiny is fastest for English; Base and Small support multiple languages.
2. Choose an AI provider. **On this computer** is the default; download a text model for offline summaries. For an API, save your own key and optionally edit the model ID. For a subscription, click **Sign in** and finish in your browser.
3. Create a meeting and click **Record**. Let participants know you're taking notes. Enable **Meeting audio** to include the other side of a call.
4. Jot down thoughts while the transcript is captured. Stop and choose **Summary → Generate notes**.

Models download from Hugging Face only when requested. Local inference runs on CPU; larger models and long recordings need more memory and time. Built-in local notes and answers select original meeting excerpts to preserve facts; cloud providers produce fuller narrative summaries. API model availability depends on your account; model IDs are editable.

For **publik API**, choose a tier (Fast is the lowest-cost default), accept the disclosure, then use **Link this computer & pick a plan**. An install starts at $0.00; the first account link provides $0.05 of free use once. The app shows the service's cost disclosure and balance. You can instead paste your own publik key, choose another personal API provider, or use local models. Provisioned publik keys stay in its per-app credential file with restricted permissions; they are never exposed to the app's web UI. See [Publik setup](https://github.com/VedSoni-dev/oatmeal/blob/codex/desktop-app/docs/ARCHITECTURE.md#publik-api) for builder configuration.

## Platforms and builds

| Platform | Artifact | Validation |
| --- | --- | --- |
| macOS 14.2+, Apple Silicon | `.app`, `.dmg`, `.zip` | Local development and automated tests |
| macOS 14.2+, Intel | `.dmg`, `.zip` | Intel CI configuration; hardware validation pending |
| Windows 10/11, x64 | NSIS `.exe` installer | Windows CI configuration; hardware validation pending |

```sh
npm run build:mac  # on macOS
npm run build:win  # on Windows
npm run pack      # unpacked development app
```

Use a matching host architecture so the bundled native runtimes match. Output goes to `dist/`. The app includes native inference libraries and official account runtimes; model weights download separately. See [release setup](https://github.com/VedSoni-dev/oatmeal/blob/codex/desktop-app/docs/RELEASING.md) for signing, notarization and CI. Release tags require signing credentials and produce a **draft** GitHub release.

## Privacy and accounts

Meetings live in Electron's application data directory. **Settings → Open meetings folder** opens the actual location. Exported Markdown can be shared or committed to your own knowledge repository.

Audio is transcribed locally. Captured chunks are written temporarily to `pending-audio/` for crash recovery, then deleted after their transcript is saved. Notes, transcripts and pending audio are protected by OS account permissions, **not application-level encryption**. Use **Recover audio** after interrupted transcription. Model files remain cached for offline use.

Cloud providers receive meeting text when you request AI help and confirm the disclosure. Raw audio is not uploaded. Provider runtimes retain data according to their own terms. Oatmeal isolates account configuration from existing coding-agent setups. API credentials are never returned to the renderer after storage or included in exports.

ChatGPT subscriptions use Codex plan access, not API credit. Claude subscriptions use the official Agent SDK; eligibility and billing follow Anthropic's current rules. See [architecture and official references](https://github.com/VedSoni-dev/oatmeal/blob/codex/desktop-app/docs/ARCHITECTURE.md).

System audio depends on OS permissions and capture source. The app warns when it can only hear your microphone. You/Room attribution does not identify individual remote speakers. Real meetings on both platforms need hardware testing before release.

## Development

```sh
npm test              # persistence, credentials, providers, long-meeting handling
npm run test:desktop  # actual Electron UI, persistence and renderer isolation
```

An opt-in recording test uses a synthetic 16-bit PCM WAV instead of your microphone:

```sh
OATMEAL_SPEECH_FIXTURE=/absolute/path/speech.wav \
OATMEAL_MODEL_CACHE=/absolute/path/downloaded/models \
npx playwright test recording.spec.mjs
```

This opt-in fake-device test launches Chromium with `--no-sandbox` so it can read the fixture. The shipping app retains its sandbox; the normal desktop test verifies renderer isolation.

| Directory | Responsibility |
| --- | --- |
| `desktop/main.mjs` | Native window, permissions, IPC, recording lifecycle |
| `desktop/core/` | Persistence, provider adapters, official account runtimes |
| `desktop/workers/` | Background Whisper/Qwen inference |
| `desktop/ui/` | Sandboxed notebook, settings, AudioWorklet capture |
| `tests/` | Core contracts and Electron integration tests |
| `.github/workflows/desktop.yml` | Platform checks, installers, draft releases |
| `capture/`, `scripts/` | Original browser recorder, MCP and calendar tools |

The [original browser/agent workflow](https://github.com/VedSoni-dev/oatmeal/blob/codex/desktop-app/docs/legacy-agent-workflow.md) remains available with `npm run start:browser`. Import existing `.transcript.md` files through **Import transcript**. The desktop app never automatically uploads, commits or pushes an existing meetings repository.

## Credits and license

MIT © Vedant Soni. Independently implemented; not affiliated with Granola.

[WhimprFlow](https://github.com/Blueturboguy07/WhimprFlow) informed the separation of UI/audio/providers, credential storage, model provisioning, and platform release checks. Oatmeal uses Electron to reuse its web audio code. No WhimprFlow source was copied.

Third-party runtimes and downloaded models retain their own licenses and terms. The official Claude runtime is distributed under Anthropic's terms, not Oatmeal's MIT license.
