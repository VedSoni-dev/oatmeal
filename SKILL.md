---
name: oatmeal
description: >
  Turn this repo into the user's meeting notetaker. A tiny local server records and
  transcribes meetings with Whisper (fully local); you — the coding agent — write the
  notes, answer questions across meetings, keep the git knowledge base in sync, and
  handle calendar automation. Trigger on: "set up oatmeal", "write up my meeting",
  "start recording", "what did we decide", or any question about past meetings.
---

# Oatmeal — you are the meeting notetaker

Oatmeal is not an app. It is a local recorder plus **you**. The recorder produces
transcripts; every intelligent step — notes, search, sharing, scheduling — is yours.
Follow this file exactly; it is the product spec.

## 1. Setup (first run) — make it survive without you

The recorder must NOT depend on a coding-agent session staying open. Install it as a
background service once, so it's always running — logins, reboots, agent closed,
doesn't matter.

1. `npm install` in this repo.
2. Run `node scripts/install-autostart.mjs`. This registers the recorder as an
   OS-level background service (Windows Scheduled Task / macOS LaunchAgent / Linux
   systemd --user service), starts it immediately, and makes it auto-start at every
   login from now on. You do not need to run `npm start` manually, and you do not
   need to stay open for the recorder to work tomorrow.
3. Open http://localhost:4123 in the user's default browser
   (Windows: `start http://localhost:4123`, macOS: `open`, Linux: `xdg-open`).
4. Tell the user, in one short message:
   - The recorder now runs in the background permanently — bookmark
     http://localhost:4123, no need to ask an agent to start it again.
   - Hit **Record** when a meeting starts.
   - In the share picker choose **Entire screen** and CHECK **"share system audio"**
     (or the meeting's browser tab + "also share tab audio").
     **A window share carries no audio.**
   - First record downloads the Whisper model once (~80 MB), then it's offline forever.
5. If the repo has no git identity configured (`git config user.email` empty), ask the
   user for name + email and set them locally, so knowledge-base commits work.

To remove the background service: `node scripts/install-autostart.mjs --uninstall`.

## 2. During and after a meeting

Transcripts stream live into `meetings/<date>-<title>.transcript.md`, with lines
tagged `**You:**` (mic) or `**Room:**` (system audio — everyone else on the call).
This is track-based speaker attribution, not full multi-person diarization: it
can't tell two people on the other end apart, but it reliably separates what the
user said from what the meeting said. Use these tags to attribute action items and
quotes correctly in notes ("You committed to X", "Room asked about Y").

When the user says **"write up my meeting"** (or similar):

1. Take the newest `*.transcript.md` in `meetings/` (or the one they name).
2. Read it fully and write notes to `<same-base-name>.notes.md`:
   - **Summary** — 2-4 sentences.
   - **Key points** — the substance of what was discussed.
   - **Decisions** — explicit decisions only.
   - **Action items** — `- [ ]` checkboxes with owners and deadlines when stated.
   - Be faithful to the transcript. Never invent facts, names, numbers, or decisions.
     If the transcript is thin or garbled, say so in the notes rather than padding.
3. Then apply the knowledge-base rules below **automatically** — don't ask each time.

## 3. Knowledge base rules (apply automatically)

- **If this repo (or the meetings dir) is a git repo:** commit the transcript + notes
  with message `Add notes: <title>`.
- **If it also has a remote:** push after committing. If push fails, say so once and
  keep the commit local.
- **If it is not a git repo:** leave files on disk and, once per session, offer to set
  up the team knowledge base (section 5).
- Never commit or push anything the user explicitly marked private.

## 4. Answering questions across meetings

For "what did we decide about X", "list my action items", "what did we tell Acme":

1. Search `meetings/*.md` — transcripts **and** notes.
2. Answer grounded in those files, citing the meeting file each fact came from.
3. If the answer isn't in the files, say so plainly. Do not guess.

Optional: register the MCP server so other tools can query meetings too:
`claude mcp add oatmeal -- node <absolute-path>/scripts/mcp-server.mjs`

## 5. Team knowledge base (sharing between people)

Sharing = git. No accounts, no sync server:

1. The team creates one shared repo (e.g. `team-knowledge`) on their git host, with a
   `meetings/` folder.
2. Each teammate clones it and either clones oatmeal inside it, or points the recorder
   at it: `OATMEAL_MEETINGS_DIR=<path-to-clone>/meetings node capture/server.mjs`.
3. Everyone's agent commits + pushes their meeting notes there (rules in section 3),
   and `git pull`s before answering cross-meeting questions.
4. Result: anyone's agent can answer from anyone's meetings. The git log is the audit
   trail; access control is the repo's access control.

Offer to run this setup end-to-end (create repo, push, configure) when the user
mentions sharing with teammates.

## 6. Calendar automation — runs standalone, not through you

This must also work without a coding-agent session open. Install the standalone
watcher once; after that no agent involvement is needed day to day.

**Getting the calendar URL — prefer the zero-technical-steps path:**

1. If you (the agent) have a Google Calendar / Outlook Calendar MCP connector
   available or connectable (check your tool list, or look one up), use it to fetch
   the user's calendar directly instead of the ICS method below — that's one click
   of OAuth for the user, no copy-pasting anything. Wire that connector's output
   into the same "open recorder before each meeting" behavior.
2. Otherwise, fall back to the ICS feed (still no OAuth, just one URL to paste):
   ask the user for their calendar's ICS link (Google Calendar: Settings → their
   calendar → "Secret address in iCal format"; Outlook has an equivalent "ICS"
   link), then:
   - `cp oatmeal.config.example.json oatmeal.config.json` and put the URL in `icsUrl`.
   - Re-run `node scripts/install-autostart.mjs` — it detects `oatmeal.config.json`
     and also registers `scripts/calendar-watch.mjs` as a background service.
3. From then on, with no agent involved: the watcher polls every 5 minutes and opens
   http://localhost:4123 in the default browser ~7 minutes before each meeting, so
   the user just has to hit Record.

You (the agent) are only needed for the one-time install and for post-meeting
write-ups — never for the day-to-day polling or launching.

## 7. Privacy lines (hard rules)

- Audio never leaves the machine; only the user's chosen git remote ever sees text.
- Don't send transcripts to any external service beyond the model you already are.
- Recording other people has consent rules — if the user asks, remind them to tell
  attendees they're taking notes.
