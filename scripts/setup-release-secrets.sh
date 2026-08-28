#!/usr/bin/env bash
#
# Richtet die Secrets ein, die desktop_cd.yaml zum Signieren und Notarisieren
# braucht. Auszufuehren in einem echten Terminal - nicht ueber einen Agenten
# oder eine Pipe, weil Passwoerter interaktiv abgefragt werden.
#
#   ./scripts/setup-release-secrets.sh
#
set -euo pipefail

REPO="${REPO:-flagbit/session-echo}"
IDENTITY_PREFIX="Developer ID Application"
P12_PATH=""

cleanup() {
  if [[ -n "$P12_PATH" && -f "$P12_PATH" ]]; then
    rm -f "$P12_PATH"
    echo "  Temporaere .p12 geloescht."
  fi
}
trap cleanup EXIT INT TERM

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
die() { printf '\n\033[31mAbbruch:\033[0m %s\n\n' "$1" >&2; exit 1; }

# --- Vorbedingungen -------------------------------------------------------

say "Vorbedingungen"

[[ "$(uname -s)" == "Darwin" ]] || die "Nur auf macOS - das Zertifikat liegt im Schluesselbund."
command -v gh >/dev/null || die "gh fehlt. Installieren mit: brew install gh"
gh auth status >/dev/null 2>&1 || die "gh ist nicht angemeldet. Erst: gh auth login"
ok "gh angemeldet"

gh repo view "$REPO" >/dev/null 2>&1 || die "Kein Zugriff auf $REPO."
ok "Zugriff auf $REPO"

# Identitaet dynamisch suchen, damit das Skript eine Zertifikatserneuerung ueberlebt.
IDENTITY_LINE="$(security find-identity -v -p codesigning 2>/dev/null \
  | grep "$IDENTITY_PREFIX" | head -1 || true)"
[[ -n "$IDENTITY_LINE" ]] || die "Kein '$IDENTITY_PREFIX'-Zertifikat im Schluesselbund gefunden."

SIGNING_IDENTITY="$(sed -E 's/.*"(.*)".*/\1/' <<<"$IDENTITY_LINE")"
TEAM_ID="$(sed -E 's/.*\(([A-Z0-9]{10})\)$/\1/' <<<"$SIGNING_IDENTITY")"
[[ "$TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || die "Team-ID nicht aus '$SIGNING_IDENTITY' lesbar."

ok "Identitaet: $SIGNING_IDENTITY"
ok "Team-ID:    $TEAM_ID"

EXPIRY="$(security find-certificate -c "$SIGNING_IDENTITY" -p 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
[[ -n "$EXPIRY" ]] && ok "Gueltig bis: $EXPIRY"

# --- Zertifikat exportieren (gefuehrt) ------------------------------------

say "Zertifikat exportieren"

P12_PATH="$(mktemp -t session-echo-signing).p12"
rm -f "$P12_PATH"

# Zufallspasswort: nie getippt, geht direkt ins Secret, staerker als Erfundenes.
P12_PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"

cat <<EOF

  Der Export muss von Hand erfolgen: 'security export' kann keine einzelne
  Identitaet filtern und wuerde auch dein persoenliches Entwicklerzertifikat
  in die CI schieben.

  Im gleich geoeffneten Schluesselbund:

    1. Links 'Anmeldung' waehlen, Kategorie 'Meine Zertifikate'
    2. Rechtsklick auf:
         $SIGNING_IDENTITY
    3. 'Exportieren ...', Format 'Persoenlicher Informationsaustausch (.p12)'
    4. Als Dateiname exakt eintragen:
         $P12_PATH
    5. Beim Passwort GENAU DAS EINFUEGEN (Zwischenablage liegt bereit):

EOF

printf '%s' "$P12_PASSWORD" | pbcopy
echo "       (in der Zwischenablage - mit Cmd-V einfuegen)"
echo
echo "  Danach hier Enter druecken."
echo

open -a "Keychain Access" 2>/dev/null || open -a "Schlüsselbundverwaltung" 2>/dev/null || true
read -r -p "  Enter, sobald die Datei exportiert ist: " _

[[ -f "$P12_PATH" ]] || die "Datei nicht gefunden: $P12_PATH"

# Passwort pruefen, bevor irgendetwas hochgeht - ein falsches .p12-Passwort
# faellt sonst erst im Release-Lauf auf.
if ! openssl pkcs12 -in "$P12_PATH" -passin "pass:$P12_PASSWORD" -nokeys -noout >/dev/null 2>&1; then
  die "Die .p12 laesst sich mit dem vorgegebenen Passwort nicht oeffnen. Beim Export ein anderes verwendet? Nochmal starten."
fi
ok "Export lesbar und Passwort korrekt"

if ! openssl pkcs12 -in "$P12_PATH" -passin "pass:$P12_PASSWORD" -nocerts -noout >/dev/null 2>&1; then
  die "Die .p12 enthaelt keinen privaten Schluessel - beim Export war nicht die Identitaet, sondern nur das Zertifikat markiert."
fi
ok "Privater Schluessel enthalten"

# --- Apple-ID abfragen ----------------------------------------------------

say "Apple-Zugang fuer die Notarisierung"

echo "  Das App-spezifische Passwort erzeugst du unter appleid.apple.com"
echo "  -> Anmeldung und Sicherheit -> App-spezifische Passwoerter."
echo "  Es ist NICHT euer normales Apple-Passwort."
echo

read -r -p "  Apple-ID (E-Mail des Entwicklerkontos): " APPLE_ID
[[ -n "$APPLE_ID" ]] || die "Apple-ID darf nicht leer sein."

read -r -s -p "  App-spezifisches Passwort: " APPLE_PASSWORD; echo
[[ -n "$APPLE_PASSWORD" ]] || die "Passwort darf nicht leer sein."

# Form pruefen: xxxx-xxxx-xxxx-xxxx. Ein normales Apple-Passwort scheitert
# sonst erst bei der Notarisierung, nach dem kompletten Build.
if [[ ! "$APPLE_PASSWORD" =~ ^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$ ]]; then
  echo
  echo "  Warnung: Das sieht nicht wie ein app-spezifisches Passwort aus"
  echo "  (erwartet: xxxx-xxxx-xxxx-xxxx). Trotzdem setzen?"
  read -r -p "  [j/N]: " CONFIRM
  [[ "$CONFIRM" == "j" || "$CONFIRM" == "J" ]] || die "Abgebrochen."
fi

# --- Secrets setzen -------------------------------------------------------

say "Secrets setzen"

set_secret() {
  local name="$1" value="$2"
  printf '%s' "$value" | gh secret set "$name" --repo "$REPO" >/dev/null
  ok "$name"
}

base64 -i "$P12_PATH" | gh secret set APPLE_CERTIFICATE --repo "$REPO" >/dev/null
ok "APPLE_CERTIFICATE"

set_secret APPLE_CERTIFICATE_PASSWORD "$P12_PASSWORD"
set_secret APPLE_SIGNING_IDENTITY "$SIGNING_IDENTITY"
set_secret APPLE_TEAM_ID "$TEAM_ID"
set_secret APPLE_ID "$APPLE_ID"
set_secret APPLE_PASSWORD "$APPLE_PASSWORD"
set_secret KEYCHAIN_PASSWORD "$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"

# --- Kontrolle ------------------------------------------------------------

say "Kontrolle"

REQUIRED=(APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_ID APPLE_PASSWORD
          APPLE_SIGNING_IDENTITY APPLE_TEAM_ID KEYCHAIN_PASSWORD
          TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
          RELEASES_TOKEN)

PRESENT="$(gh secret list --repo "$REPO" --json name -q '.[].name' 2>/dev/null)"
MISSING=()
for name in "${REQUIRED[@]}"; do
  grep -qx "$name" <<<"$PRESENT" || MISSING+=("$name")
done

if (( ${#MISSING[@]} )); then
  printf '\n  \033[33mNoch offen:\033[0m\n'
  printf '    %s\n' "${MISSING[@]}"
  printf '\n  Diese setzt das Skript nicht - siehe README oder frag nach.\n\n'
else
  printf '\n  \033[32mAlle benoetigten Secrets sind gesetzt.\033[0m\n\n'
fi

echo "  Hinweis: gh zeigt nur Namen, nie Werte. Ob ein Wert stimmt, sagt"
echo "  erst der Vorabtest im Release-Lauf - der scheitert in Sekunden,"
echo "  nicht erst nach der Build-Matrix."
echo
