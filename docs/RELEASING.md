# Desktop releases

Build on the target OS and architecture so npm installs matching native dependencies. CI targets Apple Silicon, Intel Mac and Windows x64. A Mac build does not validate Windows audio.

## Development artifacts

```sh
npm ci
npm test
npm run test:desktop
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac
```

On Windows, run `npm run build:win`. NSIS installs per user, creates shortcuts and preserves app data on uninstall. Output is in `dist/`.

No updater is enabled yet. Install newer versions manually without deleting app data. Models are stored outside the installation folder.

## Signed releases

Configure repository secrets; never put certificates/passwords in source:

| Secret | Purpose |
| --- | --- |
| `MAC_CSC_LINK` | Base64 Developer ID Application P12 certificate |
| `MAC_CSC_KEY_PASSWORD` | P12 password |
| `APPLE_ID` | Notarization account |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific notarization password |
| `APPLE_TEAM_ID` | Developer team |
| `WIN_CSC_LINK` | Windows signing PFX (or adapt the job for cloud signing) |
| `WIN_CSC_KEY_PASSWORD` | PFX password |

A local Apple Development certificate is not a substitute for Developer ID signing and notarization. Do not publish a development build as a notarized release.

Update package and lockfile versions, run checks, and create a matching `v*` tag. Tagged builds fail if signing configuration is missing. Electron Builder uses hardened runtime, audio permission descriptions and entitlements on Mac. With Apple environment variables present, its notarization integration handles submission. Artifacts are attached to a **draft** GitHub release.

Before publishing, validate on both platforms:

- Clean installation, microphone/system-audio permissions, refusal and retry.
- Real call with headphones: You/Room transcripts; ending screen sharing produces a visible warning.
- Long recording, processing backlog, app restart, audio recovery and final words on stop.
- Offline transcription/summaries after model download.
- Real subscription login/generation, disconnect/reconnect, plan-limit failures.
- Valid/invalid API keys, model changes and provider errors.
- Import/export and upgrades preserve meetings/models.
- Mac notarization and Windows certificate identity with platform tools.

WhimprFlow informed the platform boundaries and release checks. Oatmeal uses Electron Builder rather than copying its Tauri scripts. Never reuse another developer's signing identity or app token.
