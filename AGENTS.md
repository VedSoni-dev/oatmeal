# Oatmeal desktop

- Run `npm test` and `npm run test:desktop` after desktop behavior changes.
- Keep API keys and model HTTP calls in the main process. The renderer receives only safe metadata through the preload bridge.
- Preserve local models and personal API-key providers when changing built-in providers.
- Do not read `.env` files or print authentication credentials.

## publik API
- Base URL: https://publikhq.com/api/v1 (OpenAI Chat Completions, Responses, Anthropic Messages)
- Models: publik-fast, publik-balanced, publik-smart only; never a vendor model name
- Key: per-install `pk_` from POST /installs, stored at the publik credential path; env PUBLIK_API_KEY / PUBLIK_API_BASE_URL override
- App token: publik-app-token.txt (public by design, committed) or PUBLIK_APP_TOKEN
- 402: show error.message plus error.top_up_url only
- Never print or log a key
- Docs: https://publikhq.com/llms.txt, https://publikhq.com/developers, https://publikhq.com/skills/api.md
