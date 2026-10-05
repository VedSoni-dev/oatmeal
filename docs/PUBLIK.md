# Publik setup and verification

Oatmeal's listing is [oatmeal-vedsoni-dev](https://publikhq.com/oatmeal-vedsoni-dev), for `VedSoni-dev/oatmeal`. The separate `oatmeal` slug belongs to another repository. Its public `pat_` app token is committed in `publik-app-token.txt` and included in desktop packages. This token only provisions capped install keys for this app; it is not an account or install key.

In Settings, select **publik API**, choose a tier and accept the disclosure. Follow **Link this computer & pick a plan** to connect your account. The app shows the service's actual cost disclosure and wallet balance. A new install has no credit before linking. Personal keys, other providers and local models remain available.

## Recheck one small call

After setting up Publik in the installed app, run this from the repository on macOS/Linux. It uses the saved install key or `PUBLIK_API_KEY`, sends only the fixed hello prompt, and may spend a small amount of your Publik balance. It never puts a key in command arguments or terminal output. Do not paste credentials into an issue or chat.

```sh
(
  umask 077
  OATMEAL_CHECK_DIR=$(mktemp -d)
  export OATMEAL_CHECK_DIR
  trap 'rm "$OATMEAL_CHECK_DIR/auth" "$OATMEAL_CHECK_DIR/headers" "$OATMEAL_CHECK_DIR/base" 2>/dev/null; rmdir "$OATMEAL_CHECK_DIR"' EXIT
  node --input-type=module <<'JS'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PublikClient } from './desktop/core/publik.mjs'
const provider = await new PublikClient().resolve()
if (provider.kind === 'needs_consent') throw new Error('Set up Publik in Oatmeal first.')
const base = new URL(provider.baseURL)
if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Invalid API endpoint')
await writeFile(join(process.env.OATMEAL_CHECK_DIR, 'auth'), `Authorization: Bearer ${provider.apiKey}\n`, { mode: 0o600 })
await writeFile(join(process.env.OATMEAL_CHECK_DIR, 'base'), provider.baseURL, { mode: 0o600 })
JS
  if [ -s "$OATMEAL_CHECK_DIR/auth" ]; then
    curl --fail-with-body -sS "$(cat "$OATMEAL_CHECK_DIR/base")/chat/completions" \
      -H @"$OATMEAL_CHECK_DIR/auth" -H 'content-type: application/json' \
      -D "$OATMEAL_CHECK_DIR/headers" \
      -d '{"model":"publik-fast","messages":[{"role":"user","content":"Say hello in five words."}]}'
    printf '\n'
    grep -i '^x-publik-charge-micros' "$OATMEAL_CHECK_DIR/headers"
  fi
)
```

On a 402, use the response's `error.message` and `error.top_up_url`. On a 503, wait ten seconds and retry once. This check does not read personal keys encrypted inside Electron Settings; use the app UI to verify those.
