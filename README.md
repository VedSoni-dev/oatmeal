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
system audio you already hear — and Whisper transcribes it locally in your browser.
Your agent does everything intelligent with the result.

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

## Calendar automation

Give your agent a calendar connector (e.g. Google Calendar MCP) and the skill turns
on the full Granola experience:

- **Morning brief** — your agent checks today's meetings and tells you what's coming.
- **Pre-meeting launch** — 5-10 minutes before each meeting it opens the recorder in
  your browser so you just hit Record.
- **Post-meeting** — it offers to write up the notes and push them.

## What's in the repo

| Path | What it is |
|---|---|
| [`SKILL.md`](SKILL.md) | The product spec your agent follows — setup, notes flow, knowledge base rules, calendar automation |
| [`capture/`](capture/) | Zero-dependency local server + recorder page (mic + system loopback, in-browser Whisper, WebGPU) |
| [`meetings/`](meetings/) | Your transcripts + notes. Plain Markdown. Yours. |
| [`scripts/mcp-server.mjs`](scripts/mcp-server.mjs) | Optional MCP server — expose meetings to any MCP client |
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
whole thing. Good first issues: more Whisper model choices, a nicer recorder UI,
smarter meeting-title detection, calendar connector recipes.

## License

MIT © Vedant Soni — free forever. Everything the paid notetakers charge for is a
git repo and an agent prompt away.
