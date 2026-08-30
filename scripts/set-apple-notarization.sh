#!/usr/bin/env bash
#
# Prueft Apple-ID und app-spezifisches Passwort direkt bei Apple und speichert
# sie nur, wenn die Notarisierung sie akzeptiert. In einem echten Terminal
# ausfuehren - das Passwort wird verdeckt eingelesen.
#
#   ./scripts/set-apple-notarization.sh
#
set -euo pipefail

REPO="${REPO:-flagbit/session-echo}"

ok()   { printf '  \033[32m+\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[31mAbbruch:\033[0m %s\n\n' "$1" >&2; exit 1; }

command -v xcrun >/dev/null || die "xcrun fehlt - Xcode Command Line Tools installieren."
command -v gh >/dev/null    || die "gh fehlt: brew install gh"

# Die Team-ID stammt aus dem Zertifikat im Schluesselbund, nicht aus einer
# Eingabe: das signierende Zertifikat bestimmt, welches Team notarisieren darf.
IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
  | grep "Developer ID Application" | head -1 | sed -E 's/.*"(.*)".*/\1/')
[[ -n "$IDENTITY" ]] || die "Kein 'Developer ID Application'-Zertifikat im Schluesselbund."
TEAM_ID=$(sed -E 's/.*\(([A-Z0-9]{10})\)$/\1/' <<<"$IDENTITY")
[[ "$TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || die "Team-ID nicht lesbar aus '$IDENTITY'."

printf '\n\033[1mZugangsdaten\033[0m\n'
printf '  Signierendes Team: %s\n' "$TEAM_ID"
printf '  Die Apple-ID muss Mitglied genau dieses Teams sein.\n\n'

read -r -p "  Apple-ID (E-Mail): " APPLE_ID
[[ -n "$APPLE_ID" ]] || die "Apple-ID darf nicht leer sein."
read -r -s -p "  App-spezifisches Passwort: " APPLE_PASSWORD; echo

# Fuehrende/nachlaufende Leerzeichen still entfernen: ein mitkopiertes
# Zeilenende ist eine der haeufigsten Ursachen fuer ein 401 bei korrekten Daten.
APPLE_ID="${APPLE_ID#"${APPLE_ID%%[![:space:]]*}"}"
APPLE_ID="${APPLE_ID%"${APPLE_ID##*[![:space:]]}"}"
APPLE_PASSWORD="${APPLE_PASSWORD#"${APPLE_PASSWORD%%[![:space:]]*}"}"
APPLE_PASSWORD="${APPLE_PASSWORD%"${APPLE_PASSWORD##*[![:space:]]}"}"

[[ -n "$APPLE_PASSWORD" ]] || die "Passwort darf nicht leer sein."
if [[ ! "$APPLE_PASSWORD" =~ ^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$ ]]; then
  warn "Das sieht nicht wie ein app-spezifisches Passwort aus (xxxx-xxxx-xxxx-xxxx)."
  warn "Das normale Apple-Passwort wird von der Notarisierung immer abgelehnt."
  read -r -p "  Trotzdem pruefen? [j/N]: " CONFIRM
  [[ "$CONFIRM" == "j" || "$CONFIRM" == "J" ]] || die "Abgebrochen."
fi

printf '\n\033[1mPruefung bei Apple\033[0m\n'
if ! OUT=$(xcrun notarytool history \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_PASSWORD" \
      --team-id "$TEAM_ID" 2>&1); then
  printf '\n  Antwort von Apple:\n'
  printf '    %s\n' "$(grep -m2 -iE 'error|401|forbidden|invalid' <<<"$OUT" | head -2)"
  case "$OUT" in
    *401*|*"Invalid credentials"*)
      die "Apple lehnt die Daten ab. Entweder gehoert die Apple-ID nicht zu Team $TEAM_ID, oder das Passwort ist nicht das app-spezifische." ;;
    *403*|*"not a member"*)
      die "Die Apple-ID ist nicht Mitglied von Team $TEAM_ID." ;;
    *)
      die "Notarisierung nicht erreichbar. Vollstaendige Ausgabe oben." ;;
  esac
fi
ok "Apple akzeptiert die Zugangsdaten fuer Team $TEAM_ID"

printf '\n\033[1mSpeichern\033[0m\n'
# printf statt echo: echo haengt ein \n an, und ein Zeilenumbruch im Secret
# erzeugt genau das 401, das wir gerade beseitigt haben.
printf '%s' "$APPLE_ID"       | gh secret set APPLE_ID --repo "$REPO";       ok "APPLE_ID"
printf '%s' "$APPLE_PASSWORD" | gh secret set APPLE_PASSWORD --repo "$REPO"; ok "APPLE_PASSWORD"
printf '%s' "$TEAM_ID"        | gh secret set APPLE_TEAM_ID --repo "$REPO";  ok "APPLE_TEAM_ID"

printf '\n  Fertig. Die Notarisierung sollte jetzt durchlaufen.\n\n'
