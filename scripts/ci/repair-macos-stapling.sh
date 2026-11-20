#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/macos-ticket-network.sh"

target="${1:?usage: repair-macos-stapling.sh <target-triple>}"
[[ "$target" == x86_64-apple-darwin || "$target" == aarch64-apple-darwin ]] || exit 1
test "${OPENBITFUN_APPLE_SIGNING_CONFIGURED:-false}" = true
test -n "${OPENBITFUN_SIGNING_KEY:-}"
test -n "${OPENBITFUN_SIGNING_PUBKEY:-}"
bundle="target/$target/release/bundle"
app="$bundle/macos/OpenBitFun.app"
shopt -s nullglob
# The native updater archive (scripts/ci/package-native-macos-release.sh).
updaters=("$bundle/macos/"OpenBitFun-nsh_*.app.tar.gz)
test "${#updaters[@]}" -eq 1
updater="${updaters[0]}"
updater_name="$(basename "$updater")"
dmgs=("$bundle/dmg/"*.dmg)
test "${#dmgs[@]}" -eq 1
dmg="${dmgs[0]}"
codesign --verify --deep --strict --verbose=2 "$app"
codesign -dv --verbose=4 "$app" 2>&1 | grep -Fq 'Authority=Developer ID Application:'

# An accepted app can lack its ticket when stapling silently fails.
# Only repair that precise state. Other verification errors remain failures.
if ticket_output="$(stapler_with_network_retry validate "$app" 2>&1)"; then
  printf '%s\n' "$ticket_output"
  echo "Application ticket is present; retaining packages and any existing notary receipt."
  exit 0
else
  ticket_status=$?
fi
printf '%s\n' "$ticket_output" >&2
[[ "$ticket_status" -eq 65 && "$ticket_output" == *'does not have a ticket stapled to it.'* ]] || exit "$ticket_status"
# Never silently replace bytes associated with a retained Apple submission.
test ! -f "$dmg.notary-submission.json"

work="$(mktemp -d)"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$work/mount" || return
  fi
  rm -rf "$work"
}
trap cleanup EXIT
if ! command -v minisign >/dev/null 2>&1; then brew install minisign; fi
node scripts/write-minisign-public-key.mjs --out "$work/minisign.pub"
base64 -d < "$updater.sig" > "$work/original.minisig"
minisign -Vm "$updater" -p "$work/minisign.pub" -x "$work/original.minisig"
stapler_with_network_retry staple "$app"
stapler_with_network_retry validate "$app"
codesign --verify --deep --strict --verbose=2 "$app"
spctl --assess --type execute --verbose=4 "$app"

# Both distribution containers must include the repaired app, not just the loose bundle.
hdiutil convert -format UDRW -o "$work/writable.dmg" "$dmg"
mkdir "$work/mount"
hdiutil attach -nobrowse -noautoopen -mountpoint "$work/mount" "$work/writable.dmg"
mounted=true
test -d "$work/mount/OpenBitFun.app"
test ! -L "$work/mount/OpenBitFun.app"
rm -rf "$work/mount/OpenBitFun.app"
ditto "$app" "$work/mount/OpenBitFun.app"
codesign --verify --deep --strict --verbose=2 "$work/mount/OpenBitFun.app"
stapler_with_network_retry validate "$work/mount/OpenBitFun.app"
hdiutil detach "$work/mount"
mounted=false
hdiutil convert -format UDZO -o "$work/repaired.dmg" "$work/writable.dmg"
codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$work/repaired.dmg"
codesign --verify --strict --verbose=2 "$work/repaired.dmg"
COPYFILE_DISABLE=1 tar -czf "$work/$updater_name" -C "$bundle/macos" OpenBitFun.app
bash scripts/sign-release-assets.sh "$work/$updater_name"
base64 -d < "$work/$updater_name.sig" > "$work/repaired.minisig"
minisign -Vm "$work/$updater_name" -p "$work/minisign.pub" -x "$work/repaired.minisig"
mv "$work/repaired.dmg" "$dmg"
rm -f "$dmg.sig"
mv "$work/$updater_name" "$updater"
mv "$work/$updater_name.sig" "$updater.sig"
echo "Rebuilt signed installer and updater around the stapled application; full Apple verification is still required."
