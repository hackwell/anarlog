#!/usr/bin/env bash
#
# Richtet die Secrets ein, die desktop_cd.yaml zum Signieren und Notarisieren
# braucht. In einem echten Terminal ausfuehren - nicht ueber einen Agenten
# oder eine Pipe, weil Passwoerter interaktiv abgefragt werden.
#
#   ./scripts/setup-release-secrets.sh                     gefuehrter Export
#   ./scripts/setup-release-secrets.sh ~/Downloads/x.p12   vorhandene Datei
#
set -euo pipefail

REPO="${REPO:-flagbit/session-echo}"
IDENTITY_PREFIX="Developer ID Application"
P12_PATH=""
KEEP_P12=0

cleanup() {
  [[ "$KEEP_P12" == "1" ]] && return 0
  if [[ -n "$P12_PATH" && -f "$P12_PATH" ]]; then
    rm -f "$P12_PATH"
    echo "  Temporaere .p12 geloescht."
  fi
  return 0
}
trap cleanup EXIT INT TERM

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  \033[32m+\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die() { printf '\n\033[31mAbbruch:\033[0m %s\n\n' "$1" >&2; exit 1; }

say "Vorbedingungen"

[[ "$(uname -s)" == "Darwin" ]] || die "Nur auf macOS."
command -v gh >/dev/null || die "gh fehlt: brew install gh"
gh auth status >/dev/null 2>&1 || die "gh nicht angemeldet: gh auth login"
ok "gh angemeldet"
gh repo view "$REPO" >/dev/null 2>&1 || die "Kein Zugriff auf $REPO."
ok "Zugriff auf $REPO"

IDENTITY_LINE="$(security find-identity -v -p codesigning 2>/dev/null \
  | grep "$IDENTITY_PREFIX" | head -1 || true)"
[[ -n "$IDENTITY_LINE" ]] || die "Kein '$IDENTITY_PREFIX'-Zertifikat im Schluesselbund."
SIGNING_IDENTITY="$(sed -E 's/.*"(.*)".*/\1/' <<<"$IDENTITY_LINE")"
TEAM_ID="$(sed -E 's/.*\(([A-Z0-9]{10})\)$/\1/' <<<"$SIGNING_IDENTITY")"
[[ "$TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || die "Team-ID nicht lesbar aus '$SIGNING_IDENTITY'."
ok "Identitaet: $SIGNING_IDENTITY"
ok "Team-ID:    $TEAM_ID"

say "Zertifikat"

if [[ $# -ge 1 ]]; then
  P12_PATH="$1"
  [[ -f "$P12_PATH" ]] || die "Datei nicht gefunden: $P12_PATH"
  KEEP_P12=1
  echo "  Vorhandene Datei: $P12_PATH  (bleibt erhalten)"
  echo
  read -r -s -p "  Passwort dieser .p12: " P12_PASSWORD; echo
  [[ -n "$P12_PASSWORD" ]] || die "Passwort darf nicht leer sein."
else
  P12_PATH="$HOME/Desktop/session-echo-signing.p12"
  [[ -e "$P12_PATH" ]] && die "Es liegt schon eine Datei unter $P12_PATH."
  # openssl statt tr|head: diese Pipe stirbt an SIGPIPE (141) und reisst
  # unter 'set -o pipefail' das ganze Skript kommentarlos mit.
  P12_PASSWORD="$(openssl rand -hex 16)"
  printf '%s' "$P12_PASSWORD" | pbcopy
  cat <<GUIDE

  'security export' kann keine einzelne Identitaet filtern und wuerde auch
  das persoenliche Entwicklerzertifikat in die CI schieben - deshalb von Hand:

    1. Links 'Anmeldung', Kategorie 'Meine Zertifikate'
    2. Rechtsklick auf die Zeile MIT aufklappbarem Dreieck:
         $SIGNING_IDENTITY
    3. 'Exportieren ...', Format '.p12'
    4. Auf dem Schreibtisch speichern als: session-echo-signing.p12
    5. Passwort mit Cmd-V einfuegen (liegt in der Zwischenablage)

GUIDE
  open -a "Keychain Access" 2>/dev/null || open -a "Schlüsselbundverwaltung" 2>/dev/null || true
  read -r -p "  Enter, sobald exportiert: " _
  [[ -f "$P12_PATH" ]] || die "Datei nicht gefunden: $P12_PATH"
fi

# Drei Pruefungen, die sonst erst der Release-Lauf nach dem Build meldet.
CERTS="$(openssl pkcs12 -in "$P12_PATH" -passin "pass:$P12_PASSWORD" -nokeys -clcerts 2>/dev/null || true)"
[[ -n "$CERTS" ]] || die "Die .p12 laesst sich mit diesem Passwort nicht oeffnen."
ok "Passwort korrekt"

SUBJECT="$(printf '%s' "$CERTS" | openssl x509 -noout -subject 2>/dev/null || true)"
if [[ "$SUBJECT" != *"$IDENTITY_PREFIX"* ]]; then
  printf '\n  Enthalten ist:\n    %s\n' "${SUBJECT#subject=}"
  die "Kein '$IDENTITY_PREFIX'. Ein '3rd Party Mac Developer'-Zertifikat gehoert zum App Store, nicht zum Direktvertrieb."
fi
ok "Developer ID Application enthalten"

openssl pkcs12 -in "$P12_PATH" -passin "pass:$P12_PASSWORD" -nocerts -noout >/dev/null 2>&1 \
  || die "Kein privater Schluessel - beim Export war nur das Zertifikat markiert, nicht die Identitaet."
ok "Privater Schluessel enthalten"

P12_EXPIRY="$(printf '%s' "$CERTS" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
if [[ -n "$P12_EXPIRY" ]]; then ok "Gueltig bis: $P12_EXPIRY"; fi

say "Apple-Zugang fuer die Notarisierung"
echo "  App-spezifisches Passwort: appleid.apple.com -> Anmeldung und"
echo "  Sicherheit -> App-spezifische Passwoerter. NICHT das normale Passwort."
echo
read -r -p "  Apple-ID (E-Mail des Entwicklerkontos): " APPLE_ID
[[ -n "$APPLE_ID" ]] || die "Apple-ID darf nicht leer sein."
read -r -s -p "  App-spezifisches Passwort: " APPLE_PASSWORD; echo
[[ -n "$APPLE_PASSWORD" ]] || die "Passwort darf nicht leer sein."
if [[ ! "$APPLE_PASSWORD" =~ ^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$ ]]; then
  warn "Sieht nicht wie ein app-spezifisches Passwort aus (xxxx-xxxx-xxxx-xxxx)."
  read -r -p "  Trotzdem setzen? [j/N]: " CONFIRM
  [[ "$CONFIRM" == "j" || "$CONFIRM" == "J" ]] || die "Abgebrochen."
fi

say "Secrets setzen"
set_secret() { printf '%s' "$2" | gh secret set "$1" --repo "$REPO" >/dev/null; ok "$1"; }

base64 -i "$P12_PATH" | gh secret set APPLE_CERTIFICATE --repo "$REPO" >/dev/null
ok "APPLE_CERTIFICATE"
set_secret APPLE_CERTIFICATE_PASSWORD "$P12_PASSWORD"
set_secret APPLE_SIGNING_IDENTITY "$SIGNING_IDENTITY"
set_secret APPLE_TEAM_ID "$TEAM_ID"
set_secret APPLE_ID "$APPLE_ID"
set_secret APPLE_PASSWORD "$APPLE_PASSWORD"
set_secret KEYCHAIN_PASSWORD "$(openssl rand -hex 16)"

say "Kontrolle"
REQUIRED=(APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_ID APPLE_PASSWORD
          APPLE_SIGNING_IDENTITY APPLE_TEAM_ID KEYCHAIN_PASSWORD
          TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
          RELEASES_TOKEN)
PRESENT="$(gh secret list --repo "$REPO" --json name -q '.[].name' 2>/dev/null || true)"
MISSING=()
for name in "${REQUIRED[@]}"; do
  grep -qx "$name" <<<"$PRESENT" || MISSING+=("$name")
done
if (( ${#MISSING[@]} )); then
  printf '\n  \033[33mNoch offen:\033[0m\n'; printf '    %s\n' "${MISSING[@]}"; echo
else
  printf '\n  \033[32mAlle benoetigten Secrets sind gesetzt.\033[0m\n\n'
fi
