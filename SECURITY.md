# Security Policy

## Supported Versions

Session Echo ships fixes forward. Security updates are applied to the latest
release only.

| Version        | Supported          |
| -------------- | ------------------ |
| Latest release | :white_check_mark: |
| Older versions | :x:                |

The app updates itself from the release feed. If you are on an older build,
update before reporting an issue you can no longer reproduce.

## Reporting a Vulnerability

Please do not report security issues in public — not as a GitHub issue, not on
a release discussion.

The Session Echo source repository is private, so there is no public source
tree with a Security tab to report against. Reports go to the repository that
distributes the signed builds instead:

- **GitHub (preferred):**
  [Report a vulnerability](https://github.com/flagbit/session-echo-releases/security/advisories/new)
  on [`flagbit/session-echo-releases`](https://github.com/flagbit/session-echo-releases).
  That repository is public and holds the released binaries, so anyone running
  Session Echo can reach it. Private vulnerability reporting keeps the report,
  the discussion, and any draft advisory visible only to you and the
  maintainers, and the resulting advisory is published from the same place the
  affected binaries came from.
- **Email:** _No security mailbox is confirmed yet._ Until one is published
  here, use the GitHub route above. If you cannot use GitHub at all, reach
  Flagbit through the company contact details at
  <https://www.flagbit.de/impressum> and ask to be put in touch with the
  Session Echo maintainers before sending any details.

When reporting, please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce, a proof of concept, or the affected behaviour
- The Session Echo version and platform you tested against

Because the source is not public, a report that names the observable behaviour,
the build, and the platform is more useful to us than one that assumes we can
follow a line reference you cannot see.

## Scope

Session Echo records, transcribes, and summarises on the user's own machine.
The parts of the system that matter most for a security report are therefore
local: the desktop app and its Tauri plugin boundaries, the CLI, the local
SQLite database and recording files, the local model downloads, and any
credential the user enters for their own LLM or speech-to-text provider.

Out of scope: vulnerabilities in third-party AI providers a user has chosen to
connect their own API key to. Report those to the provider. We still want to
know if Session Echo mishandles the key itself.

## What to Expect

- We will acknowledge your report within 5 business days.
- We will keep you updated as we investigate, and tell you whether the report
  is accepted or declined.
- If accepted, we will work on a fix and credit you in the release notes unless
  you prefer to stay anonymous.
- Please give us a reasonable window to ship a fix before any public
  disclosure. Because users update through the release feed, a fix is only
  effective once builds have gone out.

Thanks for helping keep Session Echo and its users safe.
