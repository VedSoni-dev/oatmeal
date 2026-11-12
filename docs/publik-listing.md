# Oatmeal on Publik

Publisher copy and media for [Oatmeal's listing](https://publikhq.com/oatmeal-vedsoni-dev). GitHub's live README contains the complete showcase. Publik currently caches repository content; the dashboard's GitHub refresh must pick up the new version before those changes appear there.

## Listing fields

- **Name:** Oatmeal
- **Summary:** Local meeting transcripts in your browser; your coding agent writes the notes.
- **Category:** Productivity
- **Alternative to:** Granola
- **License:** MIT
- **Repository:** https://github.com/VedSoni-dev/oatmeal
- **AI:** Local Whisper transcription. On `main`, notes come from your own coding agent (Claude Code, Cursor, Codex). Publik API, local text models, API keys and subscription runtimes are in the desktop preview only (PR #2).
- **Sign in with publik + usage counting (on `main`):** the recorder opens with Sign in with publik (publik's module in `capture/publik.mjs`, `USES_AI = false`) and sends `app_opened` / `active_session` with the install key. `PUBLIK_SELF_TEST=1 npm start` → `publik self-test: ok oatmeal-vedsoni-dev 1.0.0` (2026-11-12).
- **Publik API flag:** should read *not built in yet* until PR #2 merges and a live call is verified. The current listing says "Built in" — that comes from the submitted manifest and needs a re-submit from the owner's Publik account.

## Description

**A little more present.**

Oatmeal is an open-source meeting notebook. Listen to the conversation, jot down a few thoughts, and leave with the details that matter. No meeting bot joins your calls.

The desktop preview brings your notes, transcript, and summary into one calm workspace. Whisper transcribes on your computer. Choose local AI, your own provider key, a supported subscription runtime, or Publik when you want help turning meeting text into useful notes. Search past meetings and export them as Markdown whenever you want.

- Microphone and optional system-audio capture, with separate You and Room transcript lanes.
- Automatic note saves, a searchable meeting library, summaries, and questions about a meeting.
- Downloadable models for offline use after setup; cloud requests require confirmation.
- Markdown exports for your own knowledge base, Cursor, Claude Code, Codex, or another MCP client.

**Preview status:** the desktop app is in [PR #2](https://github.com/VedSoni-dev/oatmeal/pull/2). Apple Silicon development builds have been tested; Windows and Intel Mac validation is pending. Signed public installers are not available yet. Publik's current source installation still uses the original browser workflow on `main`; the README explains how to try the desktop branch.

**Publik usage (desktop preview only, not on `main`):** choose Fast, Balanced, or Smart. A new install starts at $0.00 and must link its account and have enough credit to make AI calls. Cost and balance information are shown in the app. Your own key and local models remain available. Status: implemented and tested with a mocked Publik service; the first live request returned 402 on a zero balance, so no live generation has been verified yet.

## Media

- [Demo video](https://github.com/VedSoni-dev/oatmeal/raw/main/docs/media/oatmeal-demo.mp4) and [GIF](https://raw.githubusercontent.com/VedSoni-dev/oatmeal/main/docs/media/oatmeal-main-demo.gif) — real run of `main`: browser recorder + local Whisper on a labeled text-to-speech sample meeting, notes by Claude Code.
- [Cover 1200×630](https://raw.githubusercontent.com/VedSoni-dev/oatmeal/main/docs/media/oatmeal-cover.png) and four screenshots in [`docs/media/`](https://github.com/VedSoni-dev/oatmeal/tree/main/docs/media).

Desktop preview media (PR #2, fictional content):

- [Lead screenshot](https://raw.githubusercontent.com/VedSoni-dev/oatmeal/main/docs/assets/oatmeal-notebook.png) — actual desktop preview, fictional meeting content.
- [Demo GIF](https://raw.githubusercontent.com/VedSoni-dev/oatmeal/main/docs/assets/oatmeal-demo.gif) — notes → transcript → summary; prepared demo content, no live model generation shown.
- [Settings screenshot](https://raw.githubusercontent.com/VedSoni-dev/oatmeal/main/docs/assets/oatmeal-settings.png).
- [Oatmeal icon](https://raw.githubusercontent.com/VedSoni-dev/oatmeal/main/docs/assets/oatmeal-icon.svg).

Third-party logos belong in the README's labeled integration and developer-tool sections. Oatmeal's own icon is the listing identity.
