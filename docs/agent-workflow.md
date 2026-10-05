# Use Oatmeal with your coding agent

Oatmeal's MCP server reads Markdown files from `meetings/` by default. It exposes three tools: `list_meetings`, `search_meetings`, and `get_meeting`. This is the original file-based workflow, separate from the desktop app's internal meeting storage.

To use desktop meetings with it, export the meeting as Markdown into `meetings/` or set `OATMEAL_MEETINGS_DIR` to your export directory. Requests through a coding agent follow that agent's data and billing settings; reading a local file into a cloud agent may send its content to that provider.

## Claude Code

Install repository dependencies, then register the server using an absolute path:

```sh
claude mcp add oatmeal -- node /absolute/path/to/oatmeal/scripts/mcp-server.mjs
```

The repository also includes `.mcp.json`, Claude skills, and commands. Review and trust project configuration before enabling it.

## Cursor or another MCP client

Add this entry to your client's MCP configuration, replacing both paths with your own:

```json
{
  "mcpServers": {
    "oatmeal": {
      "command": "node",
      "args": ["/absolute/path/to/oatmeal/scripts/mcp-server.mjs"],
      "env": {
        "OATMEAL_MEETINGS_DIR": "/absolute/path/to/meeting-exports"
      }
    }
  }
}
```

Ask the agent to list your meetings, search for a decision, or read a meeting file. It can only return files that exist in the configured folder.

## Original browser recorder

The `main` branch retains the original browser workflow while the desktop preview is reviewed:

```sh
npm install
node capture/server.mjs
```

Open `http://localhost:4123`. Record in the browser; transcripts are saved as Markdown in `meetings/`. On the desktop branch, the equivalent command is `npm run start:browser`.

For the complete original workflow, see [the legacy guide](https://github.com/VedSoni-dev/oatmeal/blob/codex/desktop-app/docs/legacy-agent-workflow.md).
