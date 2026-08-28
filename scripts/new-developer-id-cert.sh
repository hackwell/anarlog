#!/usr/bin/env bash
#
# Erzeugt ein neues Developer-ID-Zertifikat, ohne die Schluesselbundverwaltung.
# Der private Schluessel entsteht lokal und bleibt lokal - genau das Problem,
# an dem der Export des alten Zertifikats scheitert (Zertifikat im System-
# Schluesselbund, Schluessel in iCloud, .p12 braucht aber beides zusammen).
#
#   ./scripts/new-developer-id-cert.sh
#
set -euo pipefail

WORKDIR="${WORKDIR:-$HOME/session-echo-cert}"
KEY="$WORKDIR/developer-id.key"
CSR="$WORKDIR/developer-id.csr"
P12="$WORKDIR/developer-id.p12"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  \033[32m+\033[0m %s\n' "$1"; }
die() { printf '\n\033[31mAbbruch:\033[0m %s\n\n' "$1" >&2; exit 1; }

mkdir -p "$WORKDIR"
chmod 700 "$WORKDIR"

# --- 1. Schluessel und Anforderung ---------------------------------------

say "Schritt 1 von 3: Schluessel und Zertifikatsanforderung"

if [[ -f "$KEY" ]]; then
  ok "Schluessel existiert bereits: $KEY"
else
  openssl genrsa -out "$KEY" 2048 2>/dev/null
  chmod 600 "$KEY"
  ok "Privater Schluessel erzeugt (2048 bit)"
fi

read -r -p "  E-Mail des Apple-Entwicklerkontos: " EMAIL
[[ -n "$EMAIL" ]] || die "E-Mail darf nicht leer sein."
read -r -p "  Name (erscheint in der Anforderung) [Flagbit GmbH & Co. KG]: " CNAME
CNAME="${CNAME:-Flagbit GmbH & Co. KG}"

openssl req -new -key "$KEY" -out "$CSR" \
  -subj "/emailAddress=$EMAIL/CN=$CNAME/C=DE" 2>/dev/null
ok "Anforderung erzeugt: $CSR"

# --- 2. Zertifikat holen (Browser) ---------------------------------------

say "Schritt 2 von 3: Zertifikat bei Apple anfordern"

cat <<GUIDE

  Der Upload laeuft ueber das Entwicklerportal - Apple bietet dafuer
  keine offene CLI ohne App-Store-Connect-API-Schluessel.

    1. https://developer.apple.com/account/resources/certificates/add
    2. Unter 'Software' -> 'Developer ID Application' waehlen
       (NICHT 'Apple Development', NICHT 'Mac App Distribution')
    3. Profile Type: 'G2 Sub-CA (Xcode 11.4.1 or later)'
    4. Choose File -> diese Datei hochladen:
         $CSR
    5. 'Continue' -> 'Download' -> die .cer merken

GUIDE

open "https://developer.apple.com/account/resources/certificates/add" 2>/dev/null || true
read -r -p "  Pfad zur heruntergeladenen .cer [~/Downloads/developerID_application.cer]: " CER
CER="${CER:-$HOME/Downloads/developerID_application.cer}"
CER="${CER/#\~/$HOME}"
[[ -f "$CER" ]] || die "Datei nicht gefunden: $CER"

# --- 3. .p12 bauen und pruefen -------------------------------------------

say "Schritt 3 von 3: .p12 zusammensetzen"

CERT_PEM="$WORKDIR/developer-id.pem"
openssl x509 -in "$CER" -inform DER -out "$CERT_PEM" 2>/dev/null \
  || openssl x509 -in "$CER" -out "$CERT_PEM" 2>/dev/null \
  || die "Die .cer laesst sich nicht lesen."

SUBJECT="$(openssl x509 -in "$CERT_PEM" -noout -subject 2>/dev/null)"
CN="$(sed -E 's/.*CN=([^,\/]+).*/\1/' <<<"$SUBJECT")"
if [[ "$CN" != "Developer ID Application"* ]]; then
  printf '\n  Erhalten:\n    %s\n\n' "$CN"
  die "Das ist kein Developer-ID-Zertifikat. In Schritt 2 den falschen Typ gewaehlt?"
fi
ok "Zertifikat: $CN"

# Passen Zertifikat und Schluessel zusammen? Sonst faellt es erst beim
# Signieren auf - dann mit einer sehr viel unklareren Meldung.
MOD_CERT="$(openssl x509 -in "$CERT_PEM" -noout -modulus 2>/dev/null | openssl md5)"
MOD_KEY="$(openssl rsa -in "$KEY" -noout -modulus 2>/dev/null | openssl md5)"
[[ "$MOD_CERT" == "$MOD_KEY" ]] || die "Zertifikat und privater Schluessel gehoeren nicht zusammen."
ok "Schluessel passt zum Zertifikat"

P12_PASSWORD="$(openssl rand -hex 16)"
openssl pkcs12 -export -legacy -inkey "$KEY" -in "$CERT_PEM" -out "$P12" \
  -passout "pass:$P12_PASSWORD" 2>/dev/null || die "Konnte die .p12 nicht bauen."
chmod 600 "$P12"
ok "Erzeugt: $P12"

printf '%s' "$P12_PASSWORD" | pbcopy 2>/dev/null || true

say "Fertig"
cat <<NEXT
  Passwort liegt in der Zwischenablage.

  Weiter mit:
    ./scripts/setup-release-secrets.sh "$P12"

  Danach loeschen - der Ordner enthaelt den privaten Schluessel:
    rm -rf "$WORKDIR"

  Zum lokalen Signieren zusaetzlich in den Schluesselbund importieren:
    security import "$P12" -k ~/Library/Keychains/login.keychain-db -P '<Passwort>'

NEXT
