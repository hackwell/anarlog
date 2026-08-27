# Install the Session Echo MCP server

1. Check whether `anarlog` is on `PATH` with `anarlog --version`.
2. If it is missing, ask the user to install the CLI from **Session Echo → Settings → Developers**. Do not install software or search the filesystem without permission.
3. Configure a stdio MCP server named `anarlog` with command `anarlog` and argument `mcp`.
4. Start the server and confirm it lists `list_meetings`, `get_meeting`, `get_meeting_transcript`, and `get_recurring_meeting_history`.
5. If startup fails, run `anarlog --json doctor` and show the user the reported setup problem. Never query or modify Session Echo's SQLite database directly.

The server is local, read-only, and requires no environment variables.
