#!/usr/bin/env node
// Oatmeal MCP server — exposes your meeting transcripts + notes (markdown files
// in meetings/) to any MCP client: Claude Code, Claude Desktop, Cursor, …
// Everything is local files; nothing leaves your machine.
//
// Register with Claude Code:
//   claude mcp add oatmeal -- node /absolute/path/to/oatmeal/scripts/mcp-server.mjs
//
// Point at a different meetings folder with OATMEAL_MEETINGS_DIR.
// Runs over stdio — only log to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MEETINGS_DIR = process.env.OATMEAL_MEETINGS_DIR ?? join(__dirname, '..', 'meetings')

async function listFiles() {
  if (!existsSync(MEETINGS_DIR)) return []
  const files = await readdir(MEETINGS_DIR)
  return files.filter((f) => f.endsWith('.md')).sort().reverse()
}

const server = new McpServer({ name: 'oatmeal', version: '1.0.0' })

server.tool(
  'list_meetings',
  'List meeting files (transcripts and notes), newest first.',
  {},
  async () => {
    const files = await listFiles()
    return {
      content: [
        { type: 'text', text: files.length ? files.map((f) => `- ${f}`).join('\n') : 'No meetings yet.' }
      ]
    }
  }
)

server.tool(
  'search_meetings',
  'Search all meeting transcripts and notes for a keyword. Returns matching files with surrounding lines.',
  { query: z.string().describe('Keywords to search for') },
  async ({ query }) => {
    const q = query.toLowerCase()
    const out = []
    for (const f of await listFiles()) {
      const text = await readFile(join(MEETINGS_DIR, f), 'utf8')
      const lines = text.split('\n')
      const hits = []
      lines.forEach((line, i) => {
        if (line.toLowerCase().includes(q)) {
          hits.push(lines.slice(Math.max(0, i - 1), i + 2).join('\n'))
        }
      })
      if (hits.length) out.push(`## ${f}\n${hits.slice(0, 5).join('\n---\n')}`)
    }
    return {
      content: [{ type: 'text', text: out.length ? out.join('\n\n') : `No matches for "${query}".` }]
    }
  }
)

server.tool(
  'get_meeting',
  'Get the full content of a meeting file by name (from list_meetings or search_meetings).',
  { file: z.string().describe('File name, e.g. 2026-07-18-1432-standup.transcript.md') },
  async ({ file }) => {
    const safe = file.replace(/[\\/]/g, '')
    const path = join(MEETINGS_DIR, safe)
    if (!existsSync(path)) {
      return { content: [{ type: 'text', text: `No file named ${safe}.` }] }
    }
    return { content: [{ type: 'text', text: await readFile(path, 'utf8') }] }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[oatmeal-mcp] ready, meetings dir:', MEETINGS_DIR)
