# AGENTS.md

Notes for coding agents working in this repo. `SKILL.md` covers turning transcripts into notes.

## publik API
- Base URL: https://publikhq.com/api/v1 (OpenAI Chat Completions, Responses, Anthropic Messages)
- Models: publik-fast, publik-balanced, publik-smart only; never a vendor model name
- Sign in with publik: the publik module (`capture/publik.mjs`) runs its gate when `capture/server.mjs` starts, before the recorder's first screen; the page at / draws the gate. It also sends usage telemetry (`app_opened`, `active_session`)
- `main` calls no model (`USES_AI = false`): Whisper runs in the browser and your coding agent writes the notes
- Key: per-install `pk_` from POST /installs, stored at the publik credential path; env PUBLIK_API_KEY / PUBLIK_API_BASE_URL override
- App token: publik-app-token.txt (public by design, committed) or PUBLIK_APP_TOKEN
- 402: show error.message plus error.top_up_url only
- Never print or log a key
- Test: `npm test` (gate + telemetry against a local stand-in for publikhq.com); builder check: `PUBLIK_SELF_TEST=1 npm start`
- Docs: https://publikhq.com/llms.txt, https://publikhq.com/developers, https://publikhq.com/skills/api.md
