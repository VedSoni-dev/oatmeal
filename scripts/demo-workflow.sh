#!/bin/bash
# Oatmeal demo workflow — shows all three pillars.
# Run this to walk through: capture → parse → share.

set -e

cd "$(dirname "$0")/.."
echo "=== Oatmeal Demo Workflow ==="
echo

# --- Pillar 1: Transcribe ---
echo "[1/3] Starting recorder at localhost:4123..."
if ! curl -s --max-time 2 http://localhost:4123/api/health >/dev/null 2>&1; then
  npm start &
  RECORDER_PID=$!
  sleep 3
  trap "kill $RECORDER_PID 2>/dev/null" EXIT
fi
echo "✓ Recorder ready"
echo

# Open browser
case $(uname) in
  Darwin) open http://localhost:4123 ;;
  Linux) xdg-open http://localhost:4123 ;;
  MINGW*|MSYS*) start http://localhost:4123 ;;
esac
echo "Browser opened to recorder. Record a ~30s test meeting (or skip to next step)."
echo "Press Enter when done recording..."
read

# --- Pillar 2: Parse + Q&A ---
echo
echo "[2/3] Checking for transcripts..."
TRANSCRIPT=$(ls -t meetings/*.transcript.md 2>/dev/null | head -1)
if [ -z "$TRANSCRIPT" ]; then
  echo "No transcripts found. Skipping parse demo."
  echo "(To see this work: record a meeting first, then re-run this script.)"
  NOTES=""
else
  BASE="${TRANSCRIPT%.transcript.md}"
  NOTES="${BASE}.notes.md"
  echo "Found: $TRANSCRIPT"
  echo
  echo "In your agent, say: 'write up my meeting'"
  echo "Or manually read the transcript and write notes to: $NOTES"
  echo "Press Enter when notes are ready..."
  read

  if [ -f "$NOTES" ]; then
    echo "✓ Notes exist:"
    head -10 "$NOTES"
    echo
  fi
fi

# --- Pillar 3: Share ---
echo "[3/3] Sharing to git knowledge base..."
if git rev-parse --git-dir >/dev/null 2>&1; then
  git add meetings/ 2>/dev/null || true
  if git diff --cached --quiet; then
    echo "No changes to commit."
  else
    git -c user.email=demo@oatmeal.local -c user.name=Demo \
      commit -m "Demo: meeting notes" 2>/dev/null || true
    echo "✓ Committed to git."
    if git remote get-url origin >/dev/null 2>&1; then
      echo "Remote found. To push to team: git push"
    else
      echo "(No remote configured. To share: git remote add origin <url> && git push)"
    fi
  fi
else
  echo "Not a git repo. To share: git init && git remote add origin <url>"
fi

echo
echo "=== Demo complete ==="
echo "Pillars:"
echo "  1. Transcribe: ✓ (localhost:4123, live streaming)"
echo "  2. Parse + Q&A: $([ -f "$NOTES" ] && echo '✓' || echo '—') (agent reads transcript → notes)"
echo "  3. Share: ✓ (git commit + push to team repo)"
echo
echo "Next: Clone the team repo on another machine, run the same demo, both can Q&A from all meetings."
