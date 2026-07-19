---
description: Turn the latest meeting transcript into polished notes
---

Write up a meeting per SKILL.md section 2:

1. Target: $ARGUMENTS if given (match against files in `meetings/`), else the
   newest `*.transcript.md`.
2. Read it fully. Write `<same-base-name>.notes.md`: Summary (2-4 sentences),
   Key points, Decisions (explicit only), Action items as `- [ ]` with owners.
   Use the `**You:**` / `**Room:**` tags to attribute correctly. Never invent
   facts; if the transcript is thin or garbled, say so in the notes.
3. Knowledge-base rules (SKILL.md section 3): if this is a git repo, commit
   transcript + notes as `Add notes: <title>`; push if a remote exists.
4. Reply with the notes, then where they landed.
