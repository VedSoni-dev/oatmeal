<div align="center">

# 🥣 Oatmeal

**Your coding agent is your meeting notetaker.**

[![License: MIT](https://img.shields.io/badge/License-MIT-b48455.svg)](LICENSE)
[![Local First](https://img.shields.io/badge/audio-never%20leaves%20your%20machine-2ea44f)](#privacy)
[![No Cloud](https://img.shields.io/badge/cloud-none-critical)](#how-it-works)
[![Works With](https://img.shields.io/badge/works%20with-Claude%20Code%20·%20Cursor%20·%20Codex-8a63d2)](#quickstart)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

*An open-source Granola alternative with a twist: there is no app.
A tiny local recorder transcribes your meetings with Whisper — and the AI you
already pay for (Claude Code, Cursor, Codex…) writes the notes, answers questions,
and keeps your team's knowledge base in sync. No bots joining calls. No accounts.
No API keys. No cloud.*

</div>

---

## How it works

```
you, in a meeting ──► localhost:4123 recorder
                       mic + system audio → Whisper (local, WebGPU)
                                │
                                ▼
                    meetings/2026-07-18-standup.transcript.md   (streams live)
                                │
        "write up my meeting"   ▼
                       your coding agent
                                │
                                ▼
                    meetings/2026-07-18-standup.notes.md
                                │
                                ▼
                    git commit → push → 🧠 team knowledge base
```

No bot joins your call. The recorder listens to *your* machine — your mic plus the
system audio you already hear — captured as two separate tracks, transcribed
separately, and tagged **You** / **Room** in the transcript. Your agent does
everything intelligent with the result.

## Quickstart

```bash
git clone https://github.com/VedSoni-dev/oatmeal.git
cd oatmeal
```

Then paste one line into your coding agent:

> **Read SKILL.md and set up Oatmeal for me.**

That's the whole install. The agent installs deps, starts the recorder, opens
http://localhost:4123, and tells you how to record. (Claude Code auto-discovers the
skill via `.claude/skills/` — mentioning meetings is enough.)

When a meeting starts: hit **Record**, share **Entire screen** with **"share system
audio" checked** (window shares carry no audio). When it ends, tell your agent:

> **write up my meeting**

You get summary, key points, decisions, and action items — committed to git if the
repo has a remote.

<details>
<summary>Manual setup (no agent)</summary>

```bash
npm install
npm start          # recorder at http://localhost:4123
```

Transcripts land in `meetings/` as plain Markdown. Bring any tool you like.
</details>

## The team knowledge base

**Sharing = git.** No sync server, no org accounts, no per-seat pricing:

1. Your team creates one repo — say `team-knowledge` — with a `meetings/` folder.
2. Everyone clones it and points their recorder at it
   (`OATMEAL_MEETINGS_DIR=<clone>/meetings npm start`).
3. After each meeting, each person's agent commits + pushes their notes there
   (the skill does this automatically when a remote exists).
4. Everyone's agent `git pull`s and can answer from *anyone's* meetings:

> *"What did we tell Acme about pricing last month?"*
> *"List every action item assigned to me this week."*
> *"Summarize all the decisions from sprint planning meetings."*

Access control is your git host's access control. History is the git log. Deleting
a note is a commit. Compliance export is `git archive`. It's boring — that's the point.

## Runs without the agent open

The recorder and calendar watcher are **background services**, not agent tasks — your
coding agent doesn't need to stay open for any of this to work day to day.

```bash
node scripts/install-autostart.mjs
```

Registers the recorder as a real background service — a Startup-folder entry on
Windows, a LaunchAgent on macOS, `systemd --user` on Linux — with **no admin rights
and no permission prompts**. Starts at every login, keeps running. Your agent runs
this **once**; after that, closing your terminal or Claude Code doesn't stop it.

### Calendar automation

If your coding agent has (or can add) a Google/Outlook Calendar connector, just ask
it to wire your calendar into Oatmeal — one click of OAuth, nothing to paste.

No calendar connector? One URL, no OAuth:

```bash
cp oatmeal.config.example.json oatmeal.config.json
# paste your calendar's ICS feed URL (Google Calendar → Settings → your calendar
# → "Secret address in iCal format")
node scripts/install-autostart.mjs   # re-run: also installs the calendar watcher
```

From then on, with zero agent involvement: a standalone script checks your calendar
every 5 minutes and opens the recorder in your browser ~7 minutes before each
meeting. You just hit Record. Your agent's only jobs are the one-time install and
writing up notes afterward.

## What's in the repo

| Path | What it is |
|---|---|
| [`SKILL.md`](SKILL.md) | The product spec your agent follows — setup, notes flow, knowledge base rules, calendar automation |
| [`capture/`](capture/) | Zero-dependency local server + recorder page — mic + system loopback, in-browser Whisper (WebGPU, pick tiny/base/small), live You/Room transcript, built-in meeting viewer |
| [`meetings/`](meetings/) | Your transcripts + notes. Plain Markdown. Yours. |
| [`scripts/mcp-server.mjs`](scripts/mcp-server.mjs) | Optional MCP server — expose meetings to any MCP client |
| [`scripts/install-autostart.mjs`](scripts/install-autostart.mjs) | Registers the recorder (+ calendar watcher) as a background OS service |
| [`scripts/calendar-watch.mjs`](scripts/calendar-watch.mjs) | Standalone ICS calendar poller — opens the recorder before meetings, no agent needed |
| [`.claude/skills/`](.claude/skills/) | Auto-discovery so Claude Code picks up the skill on clone |

## Privacy

- Transcription is **local** — Whisper runs in your browser (one-time ~80 MB model
  download, then fully offline). Audio is never stored or uploaded anywhere.
- Transcripts are plain files on your disk. The only network hop is the git remote
  **you** choose — or none.
- The AI that reads your transcripts is the coding agent you already use and trust.
- Recording people has consent rules that vary by place. Tell attendees you're
  taking notes.

## Contributing

PRs welcome. The codebase is intentionally tiny (~500 lines, zero server deps):
if you can read `capture/server.mjs` and `capture/public/app.js`, you've read the
whole thing.

**Good first issues:**
- Smarter meeting-title detection (from calendar or first few words)
- Calendar connector recipes (Google, Outlook, Slack integration guides)
- **Full multi-person diarization** (mic vs system audio are already tagged "You"/"Room" — telling apart two+ people on the *other* end of the call would need Pyannote or similar)
- Better error messages (when Whisper fails, when git push fails, etc.)

**Not in scope:** cloud sync, accounts, compliance features (fine-grained audit logs), multi-language models beyond Whisper's baseline. Those belong in derivatives, not core.

## License

MIT © Vedant Soni — free forever. Everything the paid notetakers charge for is a
git repo and an agent prompt away.
