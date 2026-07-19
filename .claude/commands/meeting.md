---
description: Fire up the Oatmeal recorder right now — meeting starting
---

The user has a meeting starting. Immediately, no confirmation:

1. Check `http://localhost:4123/api/health`. If no response, start the recorder
   detached in the background: `node capture/server.mjs`.
2. Open http://localhost:4123 in their default browser (Windows `start`, macOS
   `open`, Linux `xdg-open`).
3. One short line back: recorder's open — hit Record, share **Entire screen**
   with **"share system audio"** checked.
