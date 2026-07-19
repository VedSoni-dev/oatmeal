---
description: Pre-meeting brief — what happened last time with this person/topic
---

The user is about to meet: $ARGUMENTS

Build a prep brief from the knowledge base:

1. `git pull` quietly if the meetings dir has a remote.
2. Search `meetings/*.md` for every meeting involving that person/topic
   (names in titles, transcripts, and notes).
3. Brief, newest first:
   - **Last time** — when you last met and what was discussed (one paragraph).
   - **Open loops** — unchecked `- [ ]` action items from those meetings, who
     owns each, flag the ones the USER owes them.
   - **Promises made** — anything either side committed to, quoted or
     paraphrased with the source file cited.
   - **Suggested agenda** — 2-3 bullets that follow naturally from the above.
4. If nothing in the knowledge base matches, say so — don't fabricate history.
5. End by offering `/meeting` to start recording when it begins.
