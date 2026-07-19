---
description: Answer a question from everything in the meeting knowledge base
---

Question: $ARGUMENTS

1. If the meetings dir is a git repo with a remote, `git pull` quietly first —
   teammates' notes may be newer than your clone.
2. Search ALL of `meetings/*.md` — transcripts and notes.
3. Answer grounded in those files only, citing the meeting file each fact came
   from (e.g. "per 2026-07-15-linkedin-larp-detector"). Speaker tags tell you
   who said what.
4. If the answer isn't in the files, say exactly that. Do not guess, do not
   fill gaps from general knowledge.
