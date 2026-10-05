// Small local models can invent elaborate decisions from very short input.
// Let them select evidence, then render the original words, never generated facts.
export function evidence(meeting) {
  const rows = []
  const add = (source, value) => {
    for (const text of value
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      // Keep every part of unusually long utterances without unbounded prompts.
      for (let at = 0; at < text.length; at += 1000)
        rows.push({
          source,
          text: text.slice(at, at + 1000),
          id: rows.length + 1,
        })
    }
  }
  add('Your notes', meeting.notes)
  for (const segment of meeting.segments)
    add(
      `${segment.speaker === 'you' ? 'You' : 'Room'}, ${Math.floor(segment.offset / 60)}:${String(Math.floor(segment.offset % 60)).padStart(2, '0')}`,
      segment.text,
    )
  return rows
}

function groups(rows, limit = 6000) {
  const result = []
  let group = [],
    length = 0
  for (const row of rows) {
    if (group.length && length + row.text.length > limit) {
      result.push(group)
      group = []
      length = 0
    }
    group.push(row)
    length += row.text.length + 40
  }
  if (group.length) result.push(group)
  return result
}

function selectedIds(output, allowed) {
  // Only accept standalone list lines. Prose, invented names, and rationale never
  // enter the document. Out-of-range identifiers are discarded.
  const ids =
    output
      .split('\n')
      .filter((line) => /^\s*[\d,\s\[\]-]+\s*$/.test(line))
      .join(' ')
      .match(/\d+/g) || []
  return [...new Set(ids.map(Number))].filter((id) => allowed.has(id))
}
const render = (rows) =>
  rows.map((row) => `- ${row.text}\n  (${row.source})`).join('\n')
function keywordMatches(rows, question) {
  const ignored = new Set([
    'the',
    'and',
    'who',
    'what',
    'when',
    'where',
    'why',
    'how',
    'did',
    'does',
    'was',
    'were',
    'with',
    'this',
    'that',
    'for',
    'will',
    'can',
    'about',
    'from',
  ])
  const words = (value) =>
    value
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.map((word) => word.replace(/s$/, ''))
      .filter((word) => word.length > 2 && !ignored.has(word)) || []
  const terms = new Set(words(question))
  return rows
    .map((row) => ({
      row,
      score: words(row.text).filter((word) => terms.has(word)).length,
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((hit) => hit.row)
}

export async function localNotes(meeting, complete) {
  const rows = evidence(meeting)
  if (!rows.length) throw new Error('Add notes or record a transcript first.')
  const selected = []
  for (const group of groups(rows)) {
    const output = await complete(
      'Select the most important statements from this meeting. Reply only with up to 10 statement numbers, separated by commas. Never write new statements.',
      group.map((row) => `${row.id}. ${row.text}`).join('\n'),
    )
    const ids = selectedIds(output, new Set(group.map((row) => row.id)))
    selected.push(
      ...(ids.length ? group.filter((row) => ids.includes(row.id)) : group),
    )
  }
  const actions = rows.filter((row) =>
    /\b(will|i'll|we'll|assigned|action item|to.do|by (monday|tuesday|wednesday|thursday|friday|tomorrow))\b/i.test(
      row.text,
    ),
  )
  const decisions = rows.filter((row) =>
    /\b(decided|agreed|approved|decision|we chose|we selected)\b/i.test(
      row.text,
    ),
  )
  return `## Key excerpts\n\n${render(selected)}\n\n## Decision excerpts\n\n${decisions.length ? render(decisions) : 'No explicit decision wording found. Review the transcript for context.'}\n\n## Possible follow-ups\n\n${actions.length ? render(actions) : 'No explicit follow-up wording found. Review the transcript for context.'}\n\nLocal notes use original wording to preserve facts. Follow-ups are suggestions to review, not confirmed assignments.`
}

export async function localAnswer(meeting, question, complete) {
  const rows = evidence(meeting)
  if (!rows.length)
    throw new Error('This meeting has no notes or transcript yet.')
  const selected = []
  for (const group of groups(rows)) {
    const output = await complete(
      'Find meeting statements relevant to the question. Reply only with up to 5 statement numbers separated by commas. Reply 0 if none are relevant. Do not answer from memory.',
      `Question: ${question}\n\n${group.map((row) => `${row.id}. ${row.text}`).join('\n')}`,
    )
    const ids = selectedIds(output, new Set(group.map((row) => row.id)))
    selected.push(
      ...(ids.length
        ? group.filter((row) => ids.includes(row.id))
        : keywordMatches(group, question)),
    )
  }
  return selected.length
    ? `## Relevant meeting excerpts\n\n${render(selected)}\n\nThese are original meeting statements; check their context in the transcript.`
    : 'The local model did not find supporting excerpts. Try different wording or review the transcript.'
}
