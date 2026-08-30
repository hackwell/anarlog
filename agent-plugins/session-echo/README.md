# Session Echo agent plugin

Query Session Echo meetings through a read-only agent skill and local MCP server. The plugin can find meetings, read notes and summaries, inspect participants and action items, page through transcript excerpts, and review recurring meeting history.

## Prerequisites

1. Install [Session Echo](https://sessionecho.flagbit.de/download) and open it once.
2. Make the `anarlog` CLI available on `PATH`. In the desktop app, open **Settings → Developers** and install the CLI when that action is available. You can also build the CLI from source.
3. Confirm the local data is ready:

   ```bash
   anarlog --json doctor
   ```

The bundled MCP configuration starts `anarlog mcp`. If the client cannot find the command, use the executable's absolute path in that client's MCP settings.

## Install from this repository

### Claude Code

```bash
claude plugin marketplace add flagbit/session-echo
claude plugin install session-echo@flagbit
```

### GitHub Copilot CLI

```bash
copilot plugin marketplace add flagbit/session-echo
copilot plugin install session-echo@flagbit
```

### ChatGPT and Codex

```bash
codex plugin marketplace add flagbit/session-echo \
  --sparse .agents/plugins \
  --sparse agent-plugins/session-echo
```

Restart the ChatGPT desktop app, open the Plugins Directory, select the Flagbit source, and install Session Echo.

### Cursor

Import `https://github.com/flagbit/session-echo` as a team marketplace, or load `agent-plugins/session-echo` as a local plugin while testing.

## Configure MCP directly

Clients that do not install plugins can start the local stdio server with:

```json
{
  "mcpServers": {
    "anarlog": {
      "command": "anarlog",
      "args": ["mcp"]
    }
  }
}
```

For a remote agent, enable **Cloud API & Connectors** in Session Echo. Hosted access requires Session Echo Pro, explicit opt-in, and a cloud API key.

## Data access

Every Session Echo tool is read-only. Local CLI and MCP requests stay on the computer and read the app database through Session Echo's compatibility layer. Cloud access uploads a separate server-readable copy only after the user opts in.
