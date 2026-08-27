# Session Echo — Rebrand und Umbau des anarlog-Forks

Datum: 2026-08-27
Status: Design freigegeben, Implementierungsplan offen

## 1. Ziel

Aus dem anarlog-Monorepo wird **Session Echo**: ein lokal-first Meeting-Recorder
für macOS, öffentlich unter MIT. Audio, Transkript und Notizen verlassen das
Gerät nie. Kein Account, kein Server, kein Abo.

Übrig bleiben Desktop-App (Tauri 2) und CLI, mit lokalem Whisper, lokaler
Pyannote-Diarization und lokalem LLM.

Positionierung für den deutschen Markt: DSGVO-konform ohne
Auftragsverarbeitungsvertrag, ohne US-Cloud, betriebsratstauglich. Das ist kein
Nebenaspekt des Produkts, sondern sein Verkaufsargument — die Architektur muss
es belegen können.

## 2. Entscheidungen

| Frage          | Entscheidung                                                                               |
| -------------- | ------------------------------------------------------------------------------------------ |
| Umfang         | Local-only. Web, Mobile, Watch, API, Stripe und Cloud entfallen                            |
| Upstream       | Harter Fork. Keine laufenden Merges vom Original                                           |
| Produktname    | Session Echo                                                                               |
| Domain         | `sessionecho.flagbit.de` (Subdomain, DNS-Record genügt)                                    |
| Bundle-ID      | `de.flagbit.sessionecho`, plus `.dev` und `.staging`                                       |
| Deeplink       | `sessionecho`                                                                              |
| Repo-Topologie | Neues Repo. `flagbit/SessionEcho` bleibt für die Electron-v1.x-Nutzer bestehen             |
| Koexistenz     | Neue App erbt den Namen. Alte wird zu „Session Echo Classic" unter `cc.weller.sessionecho` |
| Lizenz         | MIT, Upstream-Copyright bleibt, eigenes ergänzt                                            |

## 3. Ausgangslage (verifiziert am 2026-08-27)

### Lizenz

| Pfad                      | Lizenz                               | Rechteinhaber                 |
| ------------------------- | ------------------------------------ | ----------------------------- |
| alles außer `enterprise/` | MIT                                  | Fastrepl, Inc. (2023–present) |
| `enterprise/`             | kommerziell, alle Rechte vorbehalten | Fastrepl, Inc.                |
| `docs/`                   | MIT                                  | Mintlify (Template)           |

MIT erlaubt Fork, Umbenennung, kommerzielle Nutzung und Closed-Source-Ableitung.
Einzige Pflicht ist der Erhalt des Copyright-Hinweises. Marken sind davon nicht
erfasst: „anarlog", „Hyprnote" und „Fastrepl" müssen aus markenrechtlichen
Gründen weichen, nicht aus lizenzrechtlichen.

`enterprise/` ist ohne schriftlichen Vertrag mit Fastrepl nicht nutzbar und wird
vollständig entfernt.

### Was in `enterprise/` steckt

Serverseitige Meeting-Bot-Infrastruktur, rund 20.000 Zeilen Rust. Nicht die App.

| Komponente                  | LOC            | Funktion                                                      |
| --------------------------- | -------------- | ------------------------------------------------------------- |
| `control-plane`             | 8.608          | Axum + Postgres, Job-Orchestrierung, Auth, Lizenz-Enforcement |
| `google-meet-worker`        | 9.257 + 686 JS | Headless-Chromium-Bot, tritt Meet bei, Audio via CDP          |
| `zoom-rtms-worker`          | 1.102          | Zoom Realtime Media Streams, kein Browser-Bot                 |
| `meeting-sdk-bridge-worker` | 568            | Bridge zu einem MS-Graph-Media-Bot (Windows-Sidecar fehlt)    |

Entfällt damit: serverbasiertes Auto-Join geplanter Termine, Aufnahme ohne
laufenden Client, Multi-Tenant-Workspaces, kundengehostetes Deployment.

Für Session Echo ist das kein Verlust, sondern Zielsetzung: die Funktionen
setzen genau die Cloud-Architektur voraus, die das Produkt vermeiden will.

Die Verträge liegen MIT-seitig (`crates/meeting-capture`, `crates/session-ingest`,
`crates/agent-access`, Migration `20260814090000_enterprise_session_delivery`).
Es existiert keine Code-Abhängigkeit von außen nach `enterprise/` — CI erzwingt
das, und es wurde geprüft. Das Löschen kostet keine Funktionalität der App.

Provenance-Hinweis: der Meet-Worker basiert auf Vexa (Apache-2.0), Fixtures unter
`fixtures/vexa-v0.12.18/`. Wird mit `enterprise/` entfernt.

### Umfang der Umbenennung

24.732 Treffer für „anarlog" klingen nach viel und sind es nicht:

| Kategorie                             | Treffer | Behandlung                      |
| ------------------------------------- | ------- | ------------------------------- |
| i18n-Kataloge, 109 Locales, generiert | 18.908  | `lingui extract` neu ausführen  |
| Verzeichnisse, die entfallen          | 2.012   | entfällt                        |
| echte Handarbeit                      | ~4.866  | sed-Sweep plus manuelle Prüfung |

Zusätzlich entscheidend: der größte Teil der Handarbeit ist nicht
launch-relevant.

| Namensraum                       | Vorkommen | Nach außen sichtbar            |
| -------------------------------- | --------- | ------------------------------ |
| Produktname, Fenstertitel, Icons | wenige    | ja                             |
| Bundle-ID, Deeplink              | ~150      | ja                             |
| Domains, Endpoints, Modell-URLs  | ~500      | ja                             |
| `@anlg/*` JS-Scope               | 1.503     | nein, private Workspace-Pakete |
| `anlg-*` Rust-Prefix             | 147       | nein, reine Workspace-Aliase   |

Die internen Prefixes sind ein Aufräum-Commit und blockieren kein Release.

### Isolation der zu löschenden Apps

`apps/web`, `apps/mobile`, `apps/watch`, `apps/api` und `apps/stripe` sind
eigenständige Workspace-Members ohne Desktop-Abhängigkeit. Geprüft.

Die Desktop-App hängt dagegen an `@anlg/supabase`, `@anlg/pricing`,
`@anlg/api-client`, `plugin-auth`, `plugin-relay`, `plugin-attachment-sync` und
`plugin-fs-sync`. Dort liegt der Aufwand: 309 Dateien mit Pro-Gates, 118 mit
Auth-Bezug.

### Fremdinfrastruktur

| Abhängigkeit                                      | Status                                | Ablösung                                                                                                                         |
| ------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Modelle auf `hyprnote.s3.us-east-1.amazonaws.com` | fremder Bucket, jederzeit abschaltbar | Whisper und Llama direkt auf HuggingFace. Die S3-Pfade sind reine Mirrors, Org und Repo sind im Pfad kodiert. Getestet, HTTP 200 |
| Parakeet-Tarballs (v2, v3)                        | eigene Pakete, kein HF-Äquivalent     | Für den Launch streichen. Whisper deckt den Fall ab                                                                              |
| Updater-Pubkey                                    | fremder Minisign-Key                  | Eigenes Keypair, GitHub Releases als Feed                                                                                        |
| PostHog-Analytics                                 | eingebaut in `crates/analytics`       | Vollständig entfernen                                                                                                            |
| Deeplink-Schemes `anarlog-dev`, `hypr`, `char`    | fremd                                 | Ersetzen durch `sessionecho`                                                                                                     |

PostHog wird entfernt und nicht nur deaktiviert. Bei einem Produkt, dessen
Verkaufsargument „nichts verlässt das Gerät" ist, ist vorhandener
Telemetrie-Code eine Belastung — im Code-Audit eines Kunden zählt, was drin
steht, nicht was konfiguriert ist.

### Vorhandene Signing-Infrastruktur

Aus dem bestehenden SessionEcho-Projekt übernehmbar. Beide Projekte sind
Tauri 2, kein Framework-Wechsel nötig.

Vorhanden:

- `Developer ID Application: Flagbit GmbH & Co. KG (P87KBU95SJ)` im Keychain
- `3rd Party Mac Developer Application: Flagbit GmbH & Co. KG` (MAS-fähig)
- GitHub-Secrets `APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID`,
  `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`
- `entitlements.plist` mit Mikrofon und Screen-Capture, deckt den Bedarf
- `scripts/sign-windows.ps1`

Defekt oder fehlend:

- Secret-Namen weichen von `release.yml` ab. Die Workflow erwartet
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_PASSWORD`. `APPLE_SIGNING_IDENTITY` existiert nicht. Signing läuft in
  CI derzeit sehr wahrscheinlich nicht durch — vor Phase 5 mit einem
  Probe-Build zu bestätigen.
- `signingIdentity: "-"` in `tauri.conf.json` ist Ad-hoc-Signing
- Updater unbrauchbar: kein `TAURI_SIGNING_PRIVATE_KEY`, kein `pubkey` in der
  Config, `createUpdaterArtifacts: false`
- Kein Windows-Cert-Secret

Migrationslast ist niedrig: Repo privat, 0 Stars, letzter Push Juli 2026.
Veröffentlichte Releases reichen bis v1.6.2, das ist die Electron-Linie. Die
Tauri-v2.0.0 wurde nie ausgeliefert. Kein Datenverzeichnis
`cc.weller.sessionecho` auf der Entwicklungsmaschine.

## 4. Phasenplan

Jede Phase endet mit einem nachweisbaren Zustand. Keine Phase beginnt, bevor
das Gate der vorigen grün ist.

### Phase 1 — Amputation

Entfernen: `enterprise/`, `apps/api`, `apps/web`, `apps/mobile`, `apps/watch`,
`apps/stripe`, den Mintlify-Inhalt von `docs/` (`docs/superpowers/` bleibt),
`LICENSE.enterprise`, `LICENSING.md` sowie die zugehörigen CI-Workflows.

Danach die Cloud-Crates (`crates/api-*`, `pyannote-cloud`, `transcribe-proxy`,
`transcribe-soniqo`, `openai-transcription`) und Cloud-Plugins (`auth`, `relay`,
`attachment-sync`, `fs-sync`).

Gate: `cargo check` und `pnpm -F desktop typecheck` grün, `pnpm -F desktop test`
grün.

### Phase 2 — Ent-Clouden der Desktop-App

Supabase-Auth, Billing und CloudSync entfernen. Pro-Gates werden gelöscht, nicht
auf `true` verdrahtet — beim harten Fork gibt es keinen Grund, toten Code zu
behalten. `@anlg/supabase`, `@anlg/pricing` und `@anlg/api-client` entfallen.

Aufwandsschwerpunkt des gesamten Projekts. 309 Dateien mit Pro-Gates, 118 mit
Auth-Bezug. Vorgehen in Teilschritten mit lauffähiger App nach jedem Schritt,
nicht als ein großer Commit.

Gate: App startet, Aufnahme und lokale Transkription funktionieren, kein
ausgehender Netzwerkverkehr außer Modell-Downloads. Letzteres per
Netzwerk-Mitschnitt belegen, nicht per Code-Lesen.

### Phase 3 — Identität

Produktname `Session Echo`. Bundle-ID `de.flagbit.sessionecho` mit `.dev` und
`.staging`. Deeplink `sessionecho`. Icons aus dem Bestand übernehmen
(EQ-bars-on-navy v3).

i18n auf DE und EN reduzieren, `lingui extract --clean` und
`lingui compile --strict` neu ausführen. Entfernt 107 Locales und 18.908
Namenstreffer ohne einen einzigen Edit.

Gate: `pnpm -F desktop i18n:check` grün, kein Treffer für `anarlog`, `hyprnote`
oder `fastrepl` in nutzersichtbaren Strings.

### Phase 4 — Fremdinfrastruktur ablösen

Modell-URLs auf HuggingFace umbiegen. Parakeet-Einträge entfernen. PostHog und
`crates/analytics` ausbauen. Eigenes Minisign-Keypair erzeugen, `pubkey` in die
Config, `createUpdaterArtifacts: true`, GitHub Releases als Update-Feed.

DNS-Record für `sessionecho.flagbit.de` anlegen.

Gate: frische Installation lädt Modelle erfolgreich, ohne einen Request an eine
fremde Domain.

### Phase 5 — Signing und Release

Secret-Namen angleichen, `APPLE_SIGNING_IDENTITY` auf
`Developer ID Application: Flagbit GmbH & Co. KG (P87KBU95SJ)` setzen,
`signingIdentity: "-"` entfernen, `TAURI_SIGNING_PRIVATE_KEY` hinterlegen.

Gate: notarisiertes DMG startet auf einer fremden Maschine ohne
Gatekeeper-Warnung. Auf einem zweiten Rechner prüfen, nicht auf dem Build-Host.

### Phase 6 — Lizenz-Hygiene und Veröffentlichung

`LICENSE` behält das Fastrepl-Copyright und ergänzt Flagbit. `NOTICE` für
whisper.cpp, Pyannote, ONNX und die übrigen Drittkomponenten generieren. README
nennt die Herkunft. Repo auf public.

Bestehendes `flagbit/SessionEcho`: Produktname auf „Session Echo Classic",
Hinweis auf den Nachfolger, keine weiteren Releases.

Gate: Lizenz- und NOTICE-Dateien vollständig, Herkunft im README belegt.

## 5. Nicht im Umfang

Windows- und Linux-Builds über den Launch hinaus. Mac App Store. Parakeet.
`apps/cli` über „baut und läuft" hinaus. Die interne Umbenennung von `@anlg/*`
und `anlg-*`. Datenmigration aus der Electron-App — die Schemata sind nicht
verwandt, ein Import wäre ein eigenes Projekt.

## 6. Offene Risiken

- **Phase 2 ist der Unsicherheitsfaktor.** 309 Dateien mit Pro-Gates sind
  gezählt, nicht gelesen. Ein Teil davon dürften triviale Imports sein, ein
  anderer echte Verzweigungen. Der Aufwand wird sich erst nach den ersten
  Teilschritten seriös schätzen lassen.
- **CI-Signing ist unbestätigt.** Die Secrets existieren, die Namen passen
  nicht. Ob darüber hinaus etwas fehlt, zeigt erst ein Probe-Build.
- **Parakeet-Streichung** kann Qualitätsunterschiede in der Diarization
  bedeuten. Vor dem Launch gegen Whisper plus Pyannote gegenprüfen.
- **Markenrecht.** „Echo" ist im Software- und Audio-Umfeld stark belegt, unter
  anderem durch Amazon. „Session Echo" als Ganzes ist kennzeichnungskräftiger,
  aber vor einer Markenanmeldung ist eine anwaltliche Recherche in Klasse 9
  angebracht. Für den Launch unter MIT ohne Anmeldung ist das Risiko gering,
  für eine Marke nicht.
