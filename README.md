<div align="center">

  <img width="110" src="brand/session-echo-icon-navy-512.png" alt="Session Echo icon" />

  <h1>Session Echo</h1>

  <p>
    <b>A meeting recorder that keeps the meeting on your machine.</b>
    <br />
    Records, transcribes, and summarises locally. No account, no telemetry.
  </p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-black" alt="MIT license" /></a>
  </p>

</div>

<br />

Session Echo is a desktop meeting recorder. It captures the audio on your
device, transcribes it there, and turns it into notes you can edit and export.
No bot joins the call, nothing shows up in the participant list, and there is
no Session Echo account to create.

It is built for people who need meeting notes without handing the conversation
to someone else's cloud, and for anyone who has to get a notetaker past a works
council or a data protection review.

## What it does

- **Records without joining.** Audio is captured from your device, not from
  inside the meeting.
- **Transcribes on your machine.** Whisper models run locally. On Apple
  hardware the system speech recogniser can be used instead. Speaker
  diarization runs locally too.
- **Summarises with a model you choose.** Point it at a local
  OpenAI-compatible server (Ollama, LM Studio) or at a hosted provider with
  your own API key. There is no Session Echo-operated inference service.
- **Keeps data in formats you can read.** Sessions, notes, and transcripts live
  in a local SQLite database. Recordings are plain files. Notes export to
  Markdown.
- **Sends no telemetry.** There is no analytics and no crash reporting. The
  app's log output stays in the local log file.
- **Connects to your calendar.** Apple Calendar and Microsoft 365 are
  supported, so scheduled meetings show up without a hosted connector.
- **German and English UI.**

## What runs where

| Part of the workflow        | Where it happens                                                                |
| --------------------------- | ------------------------------------------------------------------------------- |
| Audio capture and recording | Your device                                                                     |
| Transcription               | Your device (local Whisper, or Apple's speech recogniser)                       |
| Diarization                 | Your device                                                                     |
| Notes and transcript storage| Local SQLite plus local files                                                   |
| Summaries and chat          | The provider you configure — a local server, or a hosted API with your own key  |
| Calendar                    | Apple Calendar locally; Microsoft 365 directly against Microsoft Graph          |

Two things do leave the machine, and only when you ask for them: requests to
whatever LLM or speech-to-text provider you configured yourself, and the
one-time download of local model weights (currently still served from the
upstream project's mirror — see [NOTICE](NOTICE)).

## Status

Session Echo is a hard fork of [anarlog](https://github.com/fastrepl/anarlog)
by Fastrepl, Inc., rebuilt as a local-only product. See [NOTICE](NOTICE) for
the full provenance.

Two things are worth knowing before you read the tree:

- **macOS is the supported platform.** Linux and Windows artifacts are built in
  CI and can be included in a release, but they are optional and not the
  target.
- **Account, sync, and subscription code is still present and inert.** The
  hosted API it talked to has been deleted, so none of it functions, but the
  code has not been removed from the tree yet. If you grep for `isPro`,
  `CloudSync`, or Supabase and find hits, that is why. Removing it is planned,
  not done.

There is no public download page, no docs site, no Discord, and no forum.
Signed builds are published to this repository's Releases.

## Repository map

| Path                  | What lives there                                                            |
| --------------------- | --------------------------------------------------------------------------- |
| `apps/desktop`        | Tauri v2 desktop app: React and TypeScript UI, Rust backend                 |
| `apps/cli`            | Local CLI and MCP server                                                     |
| `plugins/*`           | Tauri plugin boundaries: local STT, database, calendar, export, notifications |
| `crates/*`            | Rust libraries for audio capture, transcription, diarization, and storage    |
| `packages/*`          | Shared TypeScript packages for the editor, database, UI, and plugin SDK      |
| `crates/db-app`       | SQLite schema and migrations                                                 |
| `skills/session-echo` | Published agent skill for the CLI and MCP server                             |
| `docs/superpowers`    | Design specifications and implementation plans                               |

Sessions are the core entity — notes, transcripts, and summaries are all backed
by a session. Documents are stored as TipTap-dialect ProseMirror JSON.

## Local development

The desktop app starts without secrets. Provider API keys are entered in the
app, not baked into the build.

You need Node.js 22 or later, pnpm 11.1.1, Rust 1.94.0, and the
[Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/). On
Debian or Ubuntu, the repository can install the toolchains and system packages
for you:

```bash
bash scripts/setup-linux.sh
```

Install the workspace and start the desktop app:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo dev:desktop
```

`turbo dev:desktop` builds the shared UI package first; the raw
`pnpm dev:desktop` script does not.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for validation commands and the
contribution workflow, and [AGENTS.md](AGENTS.md) for the conventions the code
follows.

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). The upstream copyright is retained alongside
Flagbit's; [NOTICE](NOTICE) records the provenance and the third-party
components.
