# OpenBitFun phone app (NSH)

The OpenBitFun app for iOS and Android: the same NSH UI as the desktop
(`src/nsh-ui`, responsive compact layout), used as a **controller** of the
account's devices. The phone has no backend of its own and never serves OBP;
the user signs in with the email verification code, sees the account's
devices, taps one and drives it with the full UI.

The legacy Kotlin and HarmonyOS apps stay in
[OpenBitFun-Mobile](https://github.com/openBitFun/OpenBitFun-Mobile) (relay
pairing, older hosts).

## Layout

| Path | What |
|---|---|
| `nsh.json` | App id `com.openbitfun.mobile`, version, icon, capabilities, the native crate |
| `App.tsx` | Installs the native controller port, then mounts `src/nsh-ui/App.tsx` |
| `src/nativeController.ts` | `ControllerPort` (`src/nsh-ui/src/controller/controllerPort.ts`) over the native module |
| `native/` | `openbitfun/mobile` (crate `openbitfun-mobile-native`, its own Cargo workspace like `desktop-nsh/native`) |

The native module is a transport and identity adapter, not a product backend:

- `account.rs`: the account APIs every OpenBitFun device uses. Sign-in is a
  device sign-in transaction of the identity service
  (`/auth/desktop/start?methods=all`) whose ticket takes the email code
  (`/auth/email/send`, `/auth/email/verify`); `/auth/desktop/poll` then hands
  this phone its token pair (`/auth/refresh` keeps it fresh). The phone
  registers its X25519 public key with the account directory
  (`/relay/api/auth/login`, kind `mobile`) and reads the other devices' names
  and keys there. The directory is never a transport.
- `keystore.rs`: the device key, the token pair and the directory token as one
  record. iOS: Keychain, `AfterFirstUnlockThisDeviceOnly`; the iOS simulator
  (an ad hoc signed app gets no keychain group, `errSecMissingEntitlement`)
  keeps a 0600 file in the app container.
- `keystore_android.rs`: on Android the record is sealed with an AES-256-GCM
  key in the Android Keystore (`controller/identity.sealed`, 0600). NSH does
  not hand native modules the app's JVM, so the module takes it from
  `JNI_GetCreatedJavaVMs` (`libnativehelper.so`, an NDK public library from
  Android 12) and uses the framework classes (`KeyStore`, `KeyGenerator`,
  `Cipher`). A plaintext record of an older build is sealed on first read and
  removed. Android 8 to 11 (no public `libnativehelper`) and a Keystore that
  refuses to seal keep the owner-only private file (`network().keyStore` is
  `private_file` then, `android_keystore` otherwise). A record the Keystore
  cannot open (restored onto another phone, Keystore reset) is kept and
  treated as signed out until the next sign-in replaces it.
- `device.rs`: the phone's name in the account's device lists (the
  directory's device name and Link's `display_name`, which desktops show
  under "Signed in now"): Android `Build.MANUFACTURER` + `Build.MODEL`
  (`Google Pixel 9`), the iOS simulator's device name, else the iOS hardware
  model (`iPhone (iPhone17,1)`).
- `logging.rs`: NSH owns the `log` facade (Android: logcat tag `nsh`, info and
  up, installed in `JNI_OnLoad`; iOS: the unified log, warnings and errors in
  release builds), so `android_logger`/`oslog` could not be installed; the
  module's and Link's `log` lines go there. A `tracing` subscriber takes
  EasyTier's lines: logcat tag `OpenBitFun` on Android, the host's logger
  elsewhere. Filter `warn` (EasyTier's event bus and route sync `error`),
  OpenBitFun crates `info`; `OPENBITFUN_MOBILE_LOG` or, on Android,
  `adb shell setprop debug.openbitfun.log <directives>` changes it
  (`easytier_core=info`; a bare level such as `debug` replaces the default).
  Fields named like secrets (token, secret, password, credential, key,
  authorization) are written `<redacted>`; panics are logged before the
  previous hook runs. `adb logcat -s nsh OpenBitFun` shows both.
- `controller.rs`: OpenBitFun Link (`openbitfun-link`) joined with
  `NodeRole::Controller` (no OBP listener, no inbound streams, forwards no
  other device's data; desktops list it as a controller, never as an
  unreachable device), the device list (directory rows joined with the Link
  route: `direct_lan`, `direct_ipv4`, `direct_ipv6`, `relayed_peer` with the
  relaying device's name, `relayed_server`), and device connections that redial
  and resume the event stream after a drop.
- `obp.rs`: OBP to a device over a Link stream, the client side of the account
  mesh handshake (`backend_protocol/ws/mesh_client.rs` in the desktop is the
  reference): TLS to the device's self-signed certificate, `Authorization:
  ObpMesh <proof>` bound to the certificate fingerprint and the pair key, the
  device's proof checked in the `101`, then `hello`/`call`/`ack`/events with
  credit backpressure. The `account-device` scope applies: registry `Proxied`
  commands only; owner-only events are withheld.

A device connection is the same JSON wire as the desktop's in-process backend
(`jsonWireConnection.ts`, kind `mesh`), so the UI runs unchanged.

Port errors are `<code>: <sentence>` with the `ControllerErrorCode` codes; the
UI maps codes to copy. Device commands keep the device backend's own errors.

## Build and run

NSH needs rustc >= 1.97 (`RUSTUP_TOOLCHAIN=1.98.1`, which the scripts set).

```bash
rustup target add --toolchain 1.98.1 aarch64-apple-ios aarch64-apple-ios-sim
rustup target add --toolchain 1.98.1 aarch64-linux-android armv7-linux-androideabi
pnpm run mobile-nsh:check                 # TS (with the shared UI) and the native crate
pnpm run mobile-nsh:test                  # native unit tests (handshake, sign-in parsing, device rows, keystore)
pnpm run mobile-nsh:package:ios-sim -- --run
pnpm run mobile-nsh:package:ios -- --sign "Apple Distribution: ..." --profile App.mobileprovision
pnpm run mobile-nsh:package:android       # needs the Android SDK (platform 35), the NDK and a JDK
pnpm run mobile-nsh:package:android -- --abi arm64-v8a -o /tmp/apk   # one ABI, another output directory
```

Output goes to `target/mobile-nsh/<target>/` (or `-o <dir>`). Android needs
`ANDROID_HOME` (with `platforms/android-35`), `ANDROID_NDK_HOME` (r27c is
known to work) and `JAVA_HOME`; the APK holds arm64-v8a and armeabi-v7a
unless `--abi` says otherwise. Development: `nsh run
src/apps/mobile-nsh/App.tsx --target ios` (or `--target android`).

The app icon goes through `actool`, which needs a simulator runtime that
matches the Xcode SDK (`xcodebuild -downloadPlatform iOS`); with an older
runtime only, packaging stops at the asset catalog.

On Android, where an app gets no environment, `adb shell setprop
debug.openbitfun.mesh_disable_p2p 1` turns P2P off (relay only, like
`OPENBITFUN_MESH_DISABLE_P2P=1`) from the next start.

Development hosts may point elsewhere with `OPENBITFUN_ACCOUNT_API_URL`,
`OPENBITFUN_DIRECTORY_URL` and `OPENBITFUN_MESH_API_URL` (simulator:
`SIMCTL_CHILD_<name>`); `OPENBITFUN_MESH=off` turns Link off.

## Live check

`native/src/controller.rs` has an ignored test, `live_controller`, that runs
the whole controller against production as the phone does (sign-in with a
scratch mailbox, Link as a controller node, device list, OBP to a scratch
desktop, session list, a message): see its doc comment. Never run it with the
owner's account.

## Remote scenarios and compatibility

- Remote control is what this app is. Blocking prompts (permissions,
  questions) reach it through the device backend's mailbox, as on any client.
- A device on a build without Link is listed with `update_required`; one that
  is offline with `offline`. Nothing falls back to the legacy relay transport.
- The keystore record carries `version` and tolerates unknown fields; an
  unreadable record is kept untouched until the next sign-in replaces it.

## Not done yet

- Real devices: iOS device signing (Keychain path) and Android devices
  (Keystore on hardware, TEE/StrongBox) are not verified here; the emulator
  (API 36) and the iOS 18.3 simulator are.
- Android 8 to 11 keep the private file: reaching the JVM there needs NSH to
  hand native modules its `JavaVM` (it holds one from `JNI_OnLoad`, crate
  private), or a Java-side hook in the APK.
- The plaintext-to-sealed migration is covered by code review only: the debug
  APK is not debuggable, so an older record cannot be planted on the
  emulator.
- `mesh_client.rs` (desktop) and `obp.rs` (here) are two copies of the OBP
  mesh client; moving it into a shared services crate is the follow-up.
