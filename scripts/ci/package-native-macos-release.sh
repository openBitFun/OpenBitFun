#!/usr/bin/env bash
# Turns the packaged native desktop app (`pnpm run desktop-nsh:package:mac`,
# `target/desktop-nsh/OpenBitFun.app`) into the macOS release outputs, in the
# bundle layout the verification, recovery and publication steps read:
#
#   target/<target>/release/bundle/macos/OpenBitFun.app
#       Developer ID signed (hardened runtime, timestamp), notarized and stapled
#       when Apple signing is configured; otherwise the packaging script's ad hoc
#       signature (artifact-only builds).
#   target/<target>/release/bundle/dmg/OpenBitFun_<version>_<aarch64|x64>.dmg
#       manual installer (app + /Applications link); signed when configured.
#       `scripts/ci/verify-macos-signing.sh` notarizes and staples it.
#   target/<target>/release/bundle/macos/OpenBitFun-nsh_<version>_<aarch64|x86_64>.app.tar.gz (+ .sig)
#       in-app update package of the native updater (`darwin-<arch>-nsh`) and,
#       through the `Contents/MacOS/openbitfun-desktop` link, of installed Tauri
#       builds (`darwin-<arch>`). Signed with the release minisign key
#       (`scripts/sign-release-assets.sh`) when OPENBITFUN_SIGNING_KEY is set.
#
# Usage: package-native-macos-release.sh <aarch64-apple-darwin|x86_64-apple-darwin> <version>
# Environment:
#   OPENBITFUN_APPLE_SIGNING_CONFIGURED, APPLE_SIGNING_IDENTITY, APPLE_API_ISSUER,
#   APPLE_API_KEY, APPLE_API_KEY_PATH   from scripts/ci/setup-macos-signing.sh
#   OPENBITFUN_MACOS_ENTITLEMENTS       entitlements of the signed executables
#                                       (default src/apps/desktop/Entitlements.plist)
#   OPENBITFUN_REQUIRE_LEGACY_BRIDGE    true: fail when the bundle lacks the
#                                       `openbitfun-desktop` link (release builds)
#   OPENBITFUN_SIGNING_KEY / _PASSWORD / _PUBKEY   minisign release key
#   OPENBITFUN_NATIVE_APP               packaged app (default target/desktop-nsh/OpenBitFun.app)
set -euo pipefail

target="${1:?usage: package-native-macos-release.sh <target-triple> <version>}"
version="${2:?usage: package-native-macos-release.sh <target-triple> <version>}"
case "${target}" in
  aarch64-apple-darwin) arch=aarch64; dmg_arch=aarch64; lipo_arch=arm64 ;;
  x86_64-apple-darwin) arch=x86_64; dmg_arch=x64; lipo_arch=x86_64 ;;
  *) echo "Unsupported macOS target: ${target}" >&2; exit 1 ;;
esac

script_dir="$(cd "$(dirname "$0")" && pwd)"
source "${script_dir}/macos-ticket-network.sh"

source_app="${OPENBITFUN_NATIVE_APP:-target/desktop-nsh/OpenBitFun.app}"
bundle="target/${target}/release/bundle"
app="${bundle}/macos/OpenBitFun.app"
runner="${app}/Contents/MacOS/OpenBitFun"
dmg="${bundle}/dmg/OpenBitFun_${version}_${dmg_arch}.dmg"
archive="${bundle}/macos/OpenBitFun-nsh_${version}_${arch}.app.tar.gz"
signing="${OPENBITFUN_APPLE_SIGNING_CONFIGURED:-false}"

test -d "${source_app}" || { echo "Packaged app not found: ${source_app} (run pnpm run desktop-nsh:package:mac)" >&2; exit 1; }
rm -rf "${bundle}"
mkdir -p "${bundle}/macos" "${bundle}/dmg"
ditto "${source_app}" "${app}"

# The release must carry the requested architecture and version.
lipo "${runner}" -verify_arch "${lipo_arch}"
plist_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${app}/Contents/Info.plist")"
if [[ "${plist_version}" != "${version}" ]]; then
  echo "Packaged app version ${plist_version} does not match release ${version}" >&2
  exit 1
fi

# Installed Tauri builds update through `darwin-<arch>`: their installer looks
# for its own executable name in the new bundle and restarts it.
legacy="${app}/Contents/MacOS/openbitfun-desktop"
if [[ ! -e "${legacy}" ]]; then
  if [[ "${OPENBITFUN_REQUIRE_LEGACY_BRIDGE:-false}" == "true" ]]; then
    echo "The native bundle lacks Contents/MacOS/openbitfun-desktop; installed Tauri builds could not update to it." >&2
    exit 1
  fi
  echo "::warning::The native bundle lacks Contents/MacOS/openbitfun-desktop; installed Tauri builds cannot update to this artifact."
fi

if [[ "${signing}" == "true" ]]; then
  entitlements="${OPENBITFUN_MACOS_ENTITLEMENTS:-src/apps/desktop/Entitlements.plist}"
  test -f "${entitlements}" || { echo "Entitlements file not found: ${entitlements}" >&2; exit 1; }
  sign() {
    codesign --force --timestamp --options runtime --sign "${APPLE_SIGNING_IDENTITY}" "$@"
  }
  # Inner code first (libraries, helper executables), then the bundle, whose
  # signature seals them and signs the main executable.
  while IFS= read -r -d '' candidate; do
    [[ "${candidate}" == "${runner}" ]] && continue
    file -b "${candidate}" | grep -q 'Mach-O' || continue
    case "${candidate}" in
      */Contents/MacOS/*) sign --entitlements "${entitlements}" "${candidate}" ;;
      *) sign "${candidate}" ;;
    esac
  done < <(find "${app}/Contents" -type f -print0)
  sign --entitlements "${entitlements}" "${app}"
  codesign --verify --deep --strict --verbose=2 "${app}"

  # Notarize the application itself, so the stapled ticket travels with the
  # bundle in both the DMG and the updater archive.
  work="$(mktemp -d)"
  trap 'rm -rf "${work}"' EXIT
  ditto -c -k --keepParent "${app}" "${work}/OpenBitFun.zip"
  output="$(xcrun notarytool submit "${work}/OpenBitFun.zip" \
    --issuer "${APPLE_API_ISSUER}" --key-id "${APPLE_API_KEY}" --key "${APPLE_API_KEY_PATH}" \
    --wait --output-format json)"
  printf '%s\n' "${output}"
  printf '%s' "${output}" | node -e '
    const result = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    if (result.status !== "Accepted") throw new Error("Apple notarization was not accepted: " + result.status);
  '
  stapler_with_network_retry staple "${app}"
  stapler_with_network_retry validate "${app}"
else
  echo "Apple signing is not configured; keeping the ad hoc signature of this artifact-only build."
fi

# Manual installer.
staging="$(mktemp -d)"
ditto "${app}" "${staging}/OpenBitFun.app"
ln -s /Applications "${staging}/Applications"
extras="src/apps/desktop/dmg-extras"
if [[ -d "${extras}" ]]; then
  cp "${extras}"/*.txt "${staging}/" 2>/dev/null || true
fi
hdiutil create -volname "OpenBitFun" -srcfolder "${staging}" -fs HFS+ -format UDZO -ov "${dmg}"
rm -rf "${staging}"
if [[ "${signing}" == "true" ]]; then
  codesign --force --timestamp --sign "${APPLE_SIGNING_IDENTITY}" "${dmg}"
  codesign --verify --strict --verbose=2 "${dmg}"
fi

# In-app update package. No AppleDouble entries: the archive must hold exactly
# one top-level .app for both updaters.
COPYFILE_DISABLE=1 tar -czf "${archive}" -C "${bundle}/macos" OpenBitFun.app
bash "${script_dir}/../sign-release-assets.sh" "${archive}"

echo "macOS release outputs for ${target}:"
ls -la "${bundle}/macos" "${bundle}/dmg"
