#!/usr/bin/env bash
#
# Prueft ein Token gegen das Release-Repository und speichert es nur, wenn es
# dort wirklich ein Release anlegen darf. In einem echten Terminal ausfuehren -
# das Token wird verdeckt eingelesen und landet nicht in der Shell-Historie.
#
#   ./scripts/set-releases-token.sh
#
set -euo pipefail

REPO="${REPO:-flagbit/session-echo}"
RELEASES_REPO="$(jq -er '.releaseRepository' scripts/desktop-release-platforms.json)"

ok()   { printf '  \033[32m+\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[31mAbbruch:\033[0m %s\n\n' "$1" >&2; exit 1; }

printf '\n\033[1mToken fuer %s\033[0m\n' "$RELEASES_REPO"
cat <<'HINWEIS'

  Fein granulares Token (empfohlen):
    Resource owner MUSS die Organisation sein, nicht das eigene Konto.
    Repository access: das Release-Repository auswaehlen.
    Permissions -> Repository permissions -> Contents: Read and write.

  Klassisches Token: Scope 'public_repo' genuegt fuer ein oeffentliches Repo.

HINWEIS

read -r -s -p "  Token einfuegen: " TOKEN; echo
[[ -n "$TOKEN" ]] || die "Token darf nicht leer sein."

printf '\n\033[1mPruefung\033[0m\n'

export GH_TOKEN="$TOKEN"

WHO=$(gh api /user --jq '.login' 2>/dev/null) || die "Token ist ungueltig oder abgelaufen."
ok "gueltig, gehoert zu: $WHO"

gh api "repos/$RELEASES_REPO" >/dev/null 2>&1 \
  || die "Token sieht $RELEASES_REPO nicht. Bei einem fein granularen Token ist meist der Resource owner das eigene Konto statt der Organisation."
ok "sieht $RELEASES_REPO"

# Der einzige ehrliche Test: schreiben. Ein Draft erzeugt keinen Tag und ist
# fuer niemanden sichtbar. Lesende Rechtefelder luegen hier - .permissions.push
# meldet, was der NUTZER darf, nicht was dem Token erlaubt wurde.
DRAFT_ID=""
cleanup() {
  [[ -n "$DRAFT_ID" ]] && gh api "repos/$RELEASES_REPO/releases/$DRAFT_ID" -X DELETE >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! DRAFT=$(gh api "repos/$RELEASES_REPO/releases" -X POST \
      -f tag_name="token-probe" -f name="token probe" -F draft=true 2>&1); then
  printf '\n  Antwort von GitHub:\n'
  printf '    %s\n' "$(sed -n '1p' <<<"$DRAFT")"
  die "Token darf dort keine Releases anlegen. Contents auf 'Read and write' setzen - 'Read' genuegt nicht."
fi
DRAFT_ID=$(jq -r '.id' <<<"$DRAFT")
ok "darf Releases anlegen"

cleanup; DRAFT_ID=""
ok "Testrelease wieder entfernt"

printf '\n\033[1mSpeichern\033[0m\n'
unset GH_TOKEN
printf '%s' "$TOKEN" | gh secret set RELEASES_TOKEN --repo "$REPO"
ok "RELEASES_TOKEN gesetzt auf $REPO"

printf '\n  Fertig. Der Release-Lauf kann jetzt starten.\n\n'
