# Heft

Heft is an offline-first body-weight tracker for Android. The core app needs
**no account, no server, and no subscription**. You enter each reading by hand,
log water from the dashboard if you want to, and you choose where your data
lives:

- **Health Connect** — your weight history lives in the Android Health Connect
  app. Heft reads the accessible history, writes new readings back, and keeps
  only settings plus a small, disposable cache on the device. Optional **activity
  data** (steps and exercise sessions) can also be read from Health Connect —
  this is how Google Fit / Fitbit / Samsung Health data reaches Heft, since
  Google now surfaces those apps through Health Connect. Water is optional too:
  once you connect it, Heft writes its own entries and reads everyone else's.
- **Local storage only** — your complete history lives on this device in SQLite.
  No health permission is requested.

Every core feature works with **no network**. The only optional online feature is
the built-in **Assistant**, which is **off by default** and never used unless you
connect it yourself (see [Assistant](#assistant-optional-ai)).

## How it works

```
Onboarding ──▶ choose storage mode
                │
   ┌────────────┴─────────────┐
   ▼                          ▼
Health Connect mode        Local-only mode
   │                          │
   │  launch + "Sync now"     │  every read/write
   ▼                          ▼
Read 30-day history ◀──────▶ SQLite (authoritative)
Write weight + water         │
Queue failures in            ├── weight_entries
pending_weights,             └── water_entries
pending_water
```

1. **Onboarding** (`src/app/onboarding.tsx`) — pick Health Connect or local
   storage. If Health Connect is unavailable or permission is denied, Heft offers
   local storage instead of blocking.
2. **Dashboard** (`src/app/index.tsx`) — latest reading, the water card, the
   recent list, a one-tap Sync now, a pull-to-refresh, and the weigh-in reminder.
3. **Add / edit** (`src/app/add-weight.tsx`, `src/features/weight/WeightEntryForm.tsx`)
   — a manual form (weight, date/time, note). The same screen handles edits.
4. **History** (`src/app/history.tsx`) — the full list with edit and delete.
5. **Insights** (`src/app/insights.tsx`) — chart, 7-day average, weekly and
   30-day change, goal weight and milestone progress, a BMI section (current and
   goal BMI on the adult category scale), plus (in Health Connect mode) a weekly
   activity summary.
6. **Assistant** (`src/app/assistant.tsx`) — an opt-in chat that can analyse your
   data and help you plan. Off until you connect it; see below.
7. **Settings** (`src/app/settings.tsx`) — storage mode, units, remind time,
   activity permissions, the assistant connection, export / import, and
   delete-all.

## Storage modes

### Health Connect mode

Health Connect is the **source of truth**. Heft keeps only:

- settings and preferences,
- a 30-day **cache** of readings read back from Health Connect
  (`weight_cache`), and
- a `pending_weights` queue for readings that could not be written yet.

Sync runs once on app launch and whenever you tap **Sync now** or pull to
refresh. Each sync:

1. skips if the mode is local-only or Health Connect is unavailable,
2. re-checks permissions (they can be revoked at any time),
3. retries any queued Heft writes,
4. mirrors the accessible history into the cache, and
5. records the last-sync time.

Heft writes new readings with a `clientRecordId`, so the record can be tracked
and de-duplicated. This library version has no `updateRecords` call, so an edit
is a delete-then-rewrite under the **same** `clientRecordId`; if the rewrite
fails the edit is queued instead of lost.

> **Imported records are never modified.** A reading that came from another app
> (for example Google Fit) is shown read-only as `HEALTH CONNECT`. Heft refuses
> to edit or delete it, so it never mutates data it does not own.

**Delete all** in Settings removes the readings Heft wrote to Health Connect (by
`clientRecordId`) and clears the local cache. Readings saved by other apps are
left untouched.

**Read window.** Health Connect only exposes roughly the last **30 days** to an
app that has not been granted the historical-read permission, so Heft requests
`READ_HEIGHT` and `READ_HEALTH_DATA_HISTORY` alongside `READ_WEIGHT` /
`WRITE_WEIGHT`. Once granted, each sync mirrors the **full accessible weight
history** into the local cache; without it Health Connect simply returns the last
30 days. Height is read from Health Connect to fill in the BMI section, with a
manual height entered on the BMI card as a fallback.

**BMI.** The Insights BMI section uses the latest reading, your goal weight, and
your height (manual or from Health Connect). Categories follow the adult BMI
bands — under 18.5, 18.5–24.9, 25–29.9, and 30 or more — and height changes
recalculate both values immediately. Nothing here needs an account, the cloud,
or the assistant; it works identically in both storage modes.

**Activity (Google Fit and friends).** Activity is a **separate, optional**
permission — onboarding stays weight-only. Tapping **Connect activity data** in
Settings requests read access to `Steps` and `ExerciseSession`. Once granted,
each sync stores per-day steps and recent sessions in `activity_daily` /
`activity_sessions` and the Insights screen shows a weekly summary. Steps are
read with Health Connect's daily aggregation (`aggregateGroupByPeriod`) rather
than paging tens of thousands of minute-level records. Activity is **read-only**;
Heft never writes it. Android has no live Google Fit API for new apps anymore
(Google shut down sign-ups in 2024 and directs mobile apps to Health Connect),
which is exactly why Heft reads Fitness data through Health Connect.

**Water (optional, both modes).** The dashboard card totals the day against a
goal set in Settings and offers **+250 ml** / **+500 ml** quick adds plus
one-tap **Undo** for the latest entry. In Health Connect mode, **Connect water
data** in Settings requests `READ_HYDRATION` / `WRITE_HYDRATION`; new entries are
written as `HydrationRecord`s (a one-second interval, because Health Connect
rejects zero-length records), and hydration logged by other apps is read back
into `water_cache`. Water is requested only when you tap that button — onboarding
and the weight flow never ask. Without the permission, entries are kept in
`pending_water` and upload after access is granted and a sync runs. As with
weight, only records Heft created (matched by `clientRecordId`) can be deleted
from the app.

### Local-only mode

SQLite is authoritative. Every reading is stored in `weight_entries` and every
drink in `water_entries`, there is no health permission, and nothing syncs.
Export and import both work in this mode.

## Assistant (optional AI)

The assistant is a chat that can analyse your weight data and help you plan. It
is **off by default** and entirely optional; if you never turn it on, the app
never makes a network request.

There are two ways to connect it, both in **Settings → Assistant**:

1. **Continue with ChatGPT** — an in-app sign-in against your ChatGPT account
   using OpenAI's `dynamic_agent_client` OAuth flow, adapted for mobile. This is
   **experimental**: OpenAI requires a loopback redirect (`http://127.0.0.1:1455/
   auth/callback`) that a phone has no server for, so Heft hosts the sign-in page
   in a WebView and intercepts that navigation to read the authorization code.
   Access tokens last ~1 hour and are refreshed silently (refresh tokens ~30
   days). The ID-token signature is **not** cryptographically verified (React
   Native has no WebCrypto RSA); `iss`, `aud` and `nonce` claims are still
   checked. If the web view is blocked on your device, use option 2.
2. **Use an OpenAI API key** — paste an `sk-…` key. It is stored in the device
   keystore via `expo-secure-store` and billed to your OpenAI account.

What leaves your device:

- your chat messages, and
- **only if you enable it**, a plain-text summary of your weight history and
  trends (and activity, when available). The toggle is off by default and shows a
  confirmation the first time; the exact text is previewed with **Preview shared
  data** on the Assistant screen.

Requests go directly to `https://api.openai.com/v1` (model list + the Responses
API with `store: false`). Heft has no backend of its own. Chat history is stored
locally in `ai_messages` and can be cleared with **New chat** or **Delete all**.

The assistant is **not a medical professional** and cannot diagnose or treat
anything; it says so, and so does the app.

## Requirements

- Node.js 20+
- Expo SDK 57 (pinned in `package.json`)
- Android 8.0+ (API 26) — required by Health Connect
- A physical Android device for Health Connect testing (a simulator or Expo Go
  cannot validate the Health Connect module)

## Setup

```bash
npm install

# Native development build (required: Health Connect and expo-sqlite are native)
npx expo prebuild --platform android
npx expo run:android
```

The Health Connect module needs a **development build** — `expo-go` cannot run
this app. To use EAS Build:

```bash
eas build --profile development --platform android
```

Rebuild the development client whenever native dependencies or `app.json`
change. For Health Connect to work, the device also needs the
[Health Connect app](https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata)
installed (or Android 14+, where it is built in).

## Releasing

### A shareable APK

EAS Build produces an **AAB** by default, and an AAB cannot be installed
directly. The `preview` profile is set up for internal distribution and asks for
an APK:

```bash
npx eas-cli@latest build --platform android --profile preview
```

The build page returns a URL/QR for the `.apk`; recipients allow *install unknown
apps* and tap it.

The same build can run on your own machine, which skips the cloud queue and does
not count against the free plan's build allowance:

```bash
EAS_LOCAL_BUILD_WORKINGDIR=~/eas-local-build \
EAS_LOCAL_BUILD_ARTIFACTS_DIR=~/heft-builds \
ANDROID_HOME=~/Android/Sdk ANDROID_SDK_ROOT=~/Android/Sdk \
npx eas-cli@latest build --platform android --profile preview --local
```

Give the working directory room: a failed build leaves its Gradle tree behind, and
building inside a small `tmpfs` dies partway through with
`java.io.IOException: Disk quota exceeded`. Keeping the artifact directory beside
it means the APK is easy to find afterwards (`~/heft-builds` here).

There is a Gradle-only path as well, with two catches:

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease   # app/build/outputs/apk/release/
```

It signs with the **debug keystore** unless you wire up the release keystore
yourself, and it carries **no update channel**: it installs and runs perfectly, but
it will never pick up an `eas update`, because only `eas build` injects
`expo-channel-name` into the manifest. If you genuinely want a Gradle-only APK to
update, add the channel yourself through `updates.requestHeaders` in `app.json`.
Both catches are why a *release* should go through `eas build`, cloud or local.
Android only installs an update over an existing app when the signature matches, so
losing the release key means every user has to uninstall and reinstall.

### Two CPU architectures, not four

`expo-build-properties` pins `android.buildArchs` to `arm64-v8a` and
`armeabi-v7a` in `app.json`. Together those cover every phone Android runs on,
64-bit and 32-bit alike, while leaving out the x86/x86_64 libraries that only an
emulator on Intel/AMD hardware would ever load. Measured inside a universal
build, that omission is 44 MB of dead weight — `x86` is 22.3 MB of native
libraries and `x86_64` is 21.9 MB, against 21.4 MB for arm64 and 14.7 MB for
arm32 — which is why a two-architecture APK lands near 63 MB where a universal
one is 110 MB.

The 32-bit half is not optional. A Galaxy M13 5G — a 2022 Samsung sold in India,
with a Dimensity 700 inside — reports `ro.product.cpu.abilist` as
`armeabi-v7a,armeabi` and an *empty* `abilist64`: 64-bit silicon running a
32-bit userspace, which is still how OEMs ship budget handsets. An arm64-only
APK fails there with `INSTALL_FAILED_NO_MATCHING_ABIS`, which surfaces to the
user as "app isn't compatible with your phone" and looks like a bug in the app.

Narrowing to fewer architectures is a size optimisation, not a correctness one,
so it is only ever safe while every intended phone is arm64. That judgement
should not live in someone's memory: `release.yml` now refuses to publish an APK
that is missing either `lib/arm64-v8a/` or `lib/armeabi-v7a/`.

An x86_64 emulator needs `"x86_64"` back in `buildArchs`; a genuinely universal
build needs all four.

`android/` is generated by `expo prebuild` and gitignored, so a cloud build always
derives its ABI list from `app.json`. A local Gradle build does not: it reads the
generated `android/gradle.properties`, whose `reactNativeArchitectures` mirrors
`buildArchs`. After changing `buildArchs`, run
`npx expo prebuild --clean -p android` (or edit that one line) before building
locally, or the local APK stays arm64-only — the same silent failure, this time
reproduced on your own machine.

Native dependencies behave the same way. `expo-notifications` contributes the
status-bar icon and the `POST_NOTIFICATIONS` permission from `app.json`, so a
checkout that has not been prebuilt since it was added compiles an APK without
them. Cloud builds prebuild from a clean tree and are unaffected.

This is packaging only. Installed apps keep working and keep receiving
over-the-air updates either way, and `runtimeVersion` stays on `appVersion`, so
it follows `expo.version` without anyone having to remember to change it.

`expo-dev-client` is in `dependencies`, so its launcher is compiled into release
builds too, at about 4 MB of dead weight. It is only needed by the `development`
profile, and it can be excluded on release via a platform-specific Gradle task —
worth doing only if the APK needs to get smaller still.

### Over-the-air updates

`expo-updates` is configured (see `updates` / `runtimeVersion` in `app.json`), so
JavaScript and asset changes ship without a new APK:

```bash
npx eas-cli@latest update --channel preview --message "fix the header" --environment preview
```

A build carrying the `preview` channel downloads the update in the background
and applies it on the **next** launch. `fallbackToCacheTimeout` is `0`, so a slow
or missing network never delays startup — which matters for an app whose core is
offline.

Only JavaScript and assets travel this way. Anything native — a new native
module, a new permission, the icon or splash, an Expo SDK upgrade — needs a new
build. `runtimeVersion` uses the `appVersion` policy, so **bump `expo.version`
whenever the native side changes**: that makes existing installs ignore an
incompatible update rather than load it and break. Development builds keep
loading from the local Metro server and are unaffected.

### Verifying an over-the-air update

`fallbackToCacheTimeout` is `0`, so an update is fetched in the background and
applied on the **next** launch. Launch, then launch again, and read Expo's own log:

```bash
adb logcat -c
adb shell monkey -p com.heft.app -c android.intent.category.LAUNCHER 1   # fetch
adb logcat -d -s dev.expo.updates:* | grep -E "Check|Download|Available"
# CheckCompleteAvailable -> Download -> DownloadComplete

adb shell am force-stop com.heft.app
adb shell monkey -p com.heft.app -c android.intent.category.LAUNCHER 1   # apply
adb logcat -d -s dev.expo.updates:* | grep NEW_UPDATE_LOADED
```

`EndStartup … isUpdatePending=true, downloadProgress=1.0` together with the
`updateGroup` in `downloadedManifest` is the proof: that group ID is the one
`eas update:list` shows for the branch. A release build is not debuggable, so
`run-as` cannot open the update directory — the log is the only window into it.

### Shipping from `stable`

`main` is where work lands; **`stable` is what phones run**. Open a pull request
from `main` into `stable` and merge it — the merge *is* the release action, and
`.github/workflows/publish-update.yml` publishes the update for you.

The workflow runs on every push to `stable` and on pull requests into it. It
installs, typechecks, lints and tests first, so a red run means nothing shipped.
Pull requests stop after the checks, which is how you see a green tick before
merging; pushes continue on to `eas update --channel preview`. It can also be run
by hand from the Actions tab (`workflow_dispatch`).

The one-time setup is an Expo access token stored as a repository secret:

```bash
gh secret set EXPO_TOKEN     # prompted for the value, nothing is echoed
```

Create the token at <https://expo.dev/settings/access-tokens>. Expo's CLI has no
command to mint one, so that step is manual.

The trigger is a git branch, but the *lane* the update ships on is the `preview`
channel, because that is what the installed APK subscribes to — a channel is
baked into a build, so renaming it would mean rebuilding and reinstalling the
APK. To publish out of band, run the `eas update` command above by hand.

### Cutting a version release

Merging into `stable` ships JavaScript only. A new **APK** is a separate,
deliberate step, because it is what moves `expo.version` — and installs on an old
version stop receiving over-the-air updates until they take the new APK.

The easy way is the **Release a new version** workflow (Actions → *Release a new
version* → *Run workflow*). Pick `patch`, `minor` or `major` and one run does all
of it: the checks, raising `expo.version`, committing it to `main`, merging `main`
into `stable`, tagging `vX.Y.Z`, then asking the APK build and the update publish
to run. It refuses to start if the tag already exists, so a repeat run cannot
half-release.

Two numbers move here and they mean different things. `expo.version` is the name
people see; `versionCode` is the integer Android compares. EAS keeps the latter
on its own servers (`appVersionSource: "remote"`) and, because `preview` sets
`autoIncrement`, raises it by one before each build — so each APK is
unambiguously newer, a store would accept the sequence, and
`dumpsys package com.heft.app | grep versionCode` can identify which build a
phone is running. Under the `appVersion` policy `expo.version` is *also* the
`runtimeVersion`, which is why raising it is exactly what ends the previous
version's OTA chain.

By hand, it is the same three steps:

```bash
# 1. raise expo.version in app.json and commit it to main
# 2. merge main into stable, so the update for the new runtime gets published
# 3. tag that same commit — the tag builds the APK and opens the release
git tag v1.1.0 && git push origin v1.1.0
```

`.github/workflows/release.yml` takes it from there. It checks that the tag
matches `expo.version` (a mismatch fails rather than shipping a mislabelled
build), runs the same checks as the publish workflow, builds a signed APK on EAS
with the `preview` profile, and publishes a GitHub Release with the APK attached
and the install notes filled in from `.github/release-notes.md`. If you would
rather write the notes yourself, draft the release first and the workflow simply
attaches the APK to it — it only rewrites notes that came from the template.

Worth knowing about the trigger: a tag pushed by hand starts the build, but
pushes made with the workflow token deliberately do *not* start other workflows.
That is why the bump workflow ends by dispatching the other two explicitly rather
than relying on its own tag push.

Two traps when a release run fails. **A re-run replays the workflow file as it was
at that ref**, so a fix pushed afterwards is not picked up — dispatch a fresh run
instead. And the notes template is looked for in the checked-out tag first, then on
the default branch, because a tag can predate the file: `v1.0.0` does, and the
first automated release failed with `sed: .github/release-notes.md: No such file`
after the APK had already been built. Replacing the asset on an existing release —
what the workflow does with `--clobber` when one already exists — also resets that
asset's download counter to zero.

Two resources to keep in mind. Free-plan builds are a limited monthly allowance of
low-priority cloud jobs, so a release build can sit in the queue for 45 minutes;
building locally with `--local` uses your own machine instead, which is the escape
hatch Expo's billing FAQ points at once the allowance is spent. Both workflows need
the same `EXPO_TOKEN` secret.

### Verifying a release

Four checks on any APK before it reaches someone. Each has caught something real.

```bash
APK=~/heft-builds/heft-1.0.1.apk
BT=$(ls -d $ANDROID_HOME/build-tools/* | sort -V | tail -1)

# what it claims to be, and which CPUs it carries: any APK meant for other
# people must list both arm64-v8a and armeabi-v7a
"$BT/aapt" dump badging "$APK" | grep -E "^package|sdkVersion|native-code"
# who signed it: must be the release keystore, or it will not install over the
# copy people already have
"$BT/apksigner" verify --print-certs "$APK" | grep "SHA-256 digest"
# the hash that belongs in the release notes
sha256sum "$APK"
```

The fourth is the one that actually proves a release: download the asset back from
the release URL, check the hash against the notes, and install it over the phone's
existing copy. `adb install -r` should say `Success` with no uninstall, and the app
should come up on the same version with its data intact.

```bash
curl -fsL -o /tmp/published.apk \
  https://github.com/PrasanthPradeep/heft/releases/download/v1.0.1/heft-1.0.1.apk
sha256sum /tmp/published.apk
adb install -r /tmp/published.apk
```

The asset carries no architecture suffix from v1.0.1 onwards, because one file now
serves both. The first release predates that: `v1.0.0`'s asset really is called
`heft-1.0.0-arm64.apk`, and it installs on arm64 phones only.

A cloud build and a local build of the same commit differ byte for byte, so compare
a hash against the notes for *that* artifact, not the other build. What has to match
across both is the package, the version name, the ABI list — both architectures —
and the signing certificate.

Worth installing by hand onto a 32-bit phone, because it is the one failure nothing
upstream reports: an APK with no `armeabi-v7a` libraries passes `aapt`, passes the
signature check, and only reveals itself when a real device refuses it.

### Brand assets

The icons, splash mark and header wordmark are all generated from the logo
masters in `assets/Heft Logo/` rather than hand-edited:

```bash
python3 scripts/generate-icons.py      # icon, adaptive layers, monochrome, favicon, splash
python3 scripts/generate-wordmark.py   # header wordmark @1x/@2x/@3x
```

`generate-icons.py` needs Pillow; `generate-wordmark.py` needs Pillow and NumPy.
Both are deterministic — re-running them reproduces the committed PNGs byte for
byte. The header wordmark is cut as density variants so the device paints a
bitmap that is already the size it needs, instead of shrinking one large image
~5x at draw time.

## Knowing whether anyone uses it

Two counters, neither needing a server of your own.

**Downloads** come from GitHub, which counts every fetch of the release file:

```bash
gh release view v1.0.0 --json assets -q '.assets[] | "\(.name): \(.downloadCount)"'
```

A re-download counts again, so read it as an upper bound on installs rather than a
head count. Repository traffic (`gh api repos/PrasanthPradeep/heft/traffic/views`)
is a rough interest signal, not usage.

**Use** comes from EAS Update, because the app already asks it for a newer version
on every cold start (`checkAutomatically: ON_LOAD`). That is enough for Expo to
count launches without a line of instrumentation:

```bash
npx eas-cli@latest update:list --branch preview       # group IDs
npx eas-cli@latest update:insights <group-id>         # launches, unique users, crash rate
npx eas-cli@latest channel:insights --channel preview --runtime-version 1.0.0
```

The last one splits users by the bundle they installed versus an update they
downloaded, which is the honest answer to "is anyone running my latest build".
"Unique users" means unique **installations** — an anonymous per-install ID, so a
reinstall counts as new, an uninstall is lost, and a launch with no network is
invisible. The channel totals are summed per update, so one phone that moved through
six updates is counted six times: read them as a ceiling, not a head count.

The GitHub counter is no better behaved. It lags behind the download, and swapping
an asset on a release — which the release workflow does with `--clobber` — resets
that asset's count to zero.

That counting is free precisely because the installs already telephone Expo, which
is worth being straight about in the app's own copy — see [Privacy](#privacy). The
trade is a launch request carrying an anonymous ID and no measurements, in return
for over-the-air updates and these numbers. Removing `expo-updates` removes both.

For more than counts — sessions, which screens get opened, retention, JavaScript
errors — add `expo-insights` (free while in preview) or EAS Observe (100k events a
month on the free plan), or PostHog if the data should live somewhere you control.

## Data portability

- **Export** — Settings shares the full history as **CSV** or **JSON** text
  through the system share sheet. Nothing leaves the device automatically.
- **Import** — paste exported CSV or JSON back in. The format is auto-detected,
  obviously invalid rows are dropped, and readings that already exist at the same
  time and value are skipped. Import is available in local mode only, so Health
  Connect records are never duplicated into the local database.

CSV columns: `measuredAt,weightKg,note,source`. `measuredAt` is an ISO-8601
timestamp; `weightKg` is always kilograms regardless of the display unit.

## Testing

```bash
npm test          # jest unit tests (calculations, trends, chart, export/import)
npm run typecheck # tsc --noEmit
npm run lint      # expo lint
npx expo-doctor   # dependency/config health check
```

The pure logic (weight calculation and validation, preference coercion, trend
math, chart geometry, CSV/JSON parsing) is covered by unit tests and runs
without a device.

### Manual device checklist

Health Connect can only be exercised on a physical Android device in a
development build:

- First launch shows onboarding; both storage choices are offered.
- Choosing Health Connect shows the system permission sheet; **denying** it
  falls back to local storage instead of blocking.
- Granting read + write imports existing weight records into the cache.
- A new reading appears in Health Connect and back in Heft.
- Add a reading while Health Connect is reachable: it appears in Health Connect
  and back in Heft. Health Connect stores everything on the device, so this
  works with no network at all.
- Revoke Health Connect write access mid-use (or otherwise make it unreachable):
  the app keeps working from its cache, and each new reading is saved on the
  device, marked **NOT SYNCED** and listed at the top of the dashboard as
  waiting. Restore access and **Sync now** uploads it without duplicating.
- A Health Connect record from another app cannot be edited or deleted in Heft.
- Switching to local storage stops syncing and does not delete Health Connect
  data.
- Export then import in local mode; duplicate readings are skipped.
- Kill and relaunch the app: local-mode readings persist; Health Connect mode
  re-syncs on launch.
- Tap **Connect activity data**, grant steps/exercise: Insights shows a weekly
  activity summary; denying leaves weight tracking unaffected.
- Water: tap **+250 ml** twice and **+500 ml** once; the card reads **1 L** and
  the bar fills halfway against the default 2 L goal. **Undo** removes the last
  entry. In Health Connect mode, grant **Connect water data** and confirm the
  entries appear in Health Connect's hydration list.
- Revoke hydration access in Health Connect, log another glass: it shows as
  waiting to sync, then uploads after access is restored and **Sync now** runs.
- Change **Water goal** in Settings and check the dashboard bar rescales.
- Assistant: connect via ChatGPT (or paste an API key), pick a model, send a
  message; toggle **Share health data** and confirm **Preview shared data**
  matches what is sent.
- Settings footer shows the version and a **GitHub** link that opens the
  repository.
- Reminders: switch on **Remind me to weigh in** and accept the permission; the
  OS now holds the schedule (`adb shell dumpsys alarm | grep -i heft` lists it).
  Deny the permission instead: the switch stays on, the card says why, and the
  dashboard banner still appears.
- Water reminder: choose a window and an interval, and check the summary line
  reads like **7 a day, every 2 hours from 09:00 to 21:00**.
- Restart the phone, then for the decisive check run
  `adb shell dumpsys alarm | grep -i heft` **before** opening Heft: the module is
  supposed to restore the schedule on boot, and opening the app would rebuild it
  anyway and hide the answer.
- The **Data & privacy** card names the update check as the only network request
  the app makes, rather than claiming nothing leaves the device.

## Project layout

```
.github/
  workflows/publish-update.yml      checks, then publishes on a push to stable
  workflows/release.yml             builds the APK and opens the Release on a v* tag
  workflows/bump.yml                one-button version release
  release-notes.md                  install notes, hash filled in per release
src/
  app/                              expo-router screens
    _layout.tsx                     providers, onboarding redirect, launch sync
    onboarding.tsx                  first-run storage choice
    index.tsx                       dashboard (latest, water, recent, sync, reminder)
    add-weight.tsx                  add / edit / delete a reading
    history.tsx                     full history list
    insights.tsx                    chart, trends, goal + milestones, activity
    assistant.tsx                   opt-in AI chat over your data
    settings.tsx                    storage, units, goal, reminders, AI, export/import
  components/ui.tsx                 shared Button/Card/Screen primitives
  constants/theme.ts                colors, spacing, radii
  db/
    database.ts                     SQLite connection + preference helpers
    migrations.ts                   versioned schema (PRAGMA user_version)
  features/
    weight/
      types.ts                      WeightEntry + row mappers
      weightCalculations.ts         pure validation/conversion helpers
      weightRepository.ts           Local + Health Connect repositories
      WeightEntryForm.tsx           manual entry form
    health-connect/
      healthConnectPermissions.ts   availability + weight/activity/hydration permissions
      healthConnectAdapter.ts       weight read / write / delete via Health Connect
      hydrationAdapter.ts           water read / write / delete via Health Connect
      weightCache.ts                weight cache read + windowed replace
      hydrationCache.ts             water cache read + windowed replace
      weightSync.ts                 two-way sync + activity/hydration refresh
    water/
      types.ts                      WaterEntry + row mappers
      waterCalculations.ts          pure volume/total/goal helpers (unit-tested)
      waterRepository.ts            Local + Health Connect water repositories
    activity/
      activityAdapter.ts            daily steps + exercise sessions via Health Connect
      activityCache.ts              activity persistence + windowed replace
      activityRepository.ts         activity loaders used by the UI
      activityCalculations.ts       pure step/exercise math (unit-tested)
      types.ts                      DailyActivity + ActivitySession + summary
    ai/
      types.ts                      AiMethod, AiModel, connection + errors
      base64.ts                     dependency-free base64url / UTF-8
      pkce.ts                       PKCE S256 helpers (expo-crypto)
      chatgptAuth.ts                Sign in with ChatGPT OAuth (RN adaptation)
      aiClient.ts                   model list + streaming Responses API
      modelCatalog.ts               pure parsers for both model-list shapes
      sse.ts                        pure Server-Sent Events parser
      healthContext.ts              build the shared weight/activity summary
      prompts.ts                    system instructions
      chatStore.ts                  local transcript (ai_messages)
      secureStore.ts                keystore for tokens / API key
      AiSettingsCard.tsx            Settings UI for connecting the assistant
      ChatGptSignInModal.tsx        WebView that intercepts the OAuth callback
    analytics/
      trendCalculations.ts          averages, changes, goals, reminders
      chartGeometry.ts              pure chart point math
      WeightChart.tsx               dependency-free line chart
    export/exportService.ts         CSV/JSON export + import parsing
    settings/
      types.ts                      AppPreferences + coercion
      preferenceStore.ts            JSON blob persisted in SQLite
      preferences.tsx               React context provider
    reminders/
      schedule.ts                   pure trigger math: what fires, and when
      notifications.ts              permission, channel, OS scheduling
      useReminderSync.ts            reschedules on launch and on any change
  lib/format.ts                     deterministic formatting helpers
```

## Schema

`PRAGMA user_version` drives migrations (see `src/db/migrations.ts`). Schema v6:

| Table              | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `preferences`      | Key/value store; app preferences as one JSON blob    |
| `weight_entries`   | Authoritative store for **local-only** mode          |
| `weight_cache`     | Disposable 30-day mirror of Health Connect           |
| `pending_weights`  | Heft readings awaiting a Health Connect write        |
| `water_entries`    | Authoritative water log for **local-only** mode      |
| `water_cache`      | Disposable mirror of Health Connect hydration        |
| `pending_water`    | Water entries awaiting a Health Connect write        |
| `activity_daily`   | Disposable per-day step counts from Health Connect   |
| `activity_sessions`| Disposable recent exercise sessions from Health Connect |
| `ai_messages`      | Local assistant transcript (cleared by delete-all)   |

Settings and cache live locally in **both** modes; only `weight_entries` and
`water_entries` are mode-specific.

## Privacy

- No account, no sign-in, no analytics, and no server of ours — unless you opt
  into the assistant.
- Over-the-air updates mean the app does ask Expo's update service, on launch,
  whether a newer version exists. That request carries an anonymous per-install ID
  and no measurements, and it is what the counts in
  [Knowing whether anyone uses it](#knowing-whether-anyone-uses-it) are built
  from. Removing `expo-updates` removes the request.
- Local mode: measurements and water never leave the device.
- Health Connect mode: data is read from and written to Android Health Connect
  under your control. Heft never touches records it did not create. Activity is
  read-only; hydration is read and written only after you connect it.
- Assistant: off by default. When on, requests go straight to OpenAI with your
  own credentials. Weight/trend data is only attached after you turn on **Share
  health data with the AI**, which shows exactly what will be sent.
- Reminders are **off by default**. Switching one on is the only moment Heft asks
  Android for the notification permission; nothing prompts on launch. The alerts
  are scheduled by the OS on the device, so nothing about them is sent anywhere.

## Known limitations / next steps

- **30-day read window.** Older Health Connect history is not imported (see
  above); extending it needs the historical-read permission.
- **Push-then-pull sync only.** Heft does not reconcile Health Connect edits made
  by other apps for records it already cached beyond re-reading the window.
- **Import is local-only** by design, to avoid duplicating Health Connect data.
- **Reminders survive a restart, but battery management can delay them.** The
  notifications module restores its own schedule after a reboot, and Heft rebuilds
  it on every launch as well. They are deliberately *inexact* alarms — which is
  what avoids needing the exact-alarm permission — so a phone in Doze, or one with
  an aggressive OEM battery saver, can deliver them late. The dashboard banner is
  unaffected, and nothing is ever pushed from a server.
- **ChatGPT sign-in is experimental on mobile.** It relies on intercepting a
  loopback redirect inside a WebView and skips ID-token signature verification.
  It cannot be fully verified without a physical device; the API-key path is the
  dependable fallback.
- **Activity needs Health Connect mode.** Local-only mode never reads Health
  Connect, preserving its "no health permission" promise.
- **Water is tracked but not exported yet.** The CSV/JSON export, import and the
  assistant's shared health summary currently cover weight and activity only.
  Water also follows the same 30-day Health Connect read window as weight.
- A full end-to-end Android build has not been run in CI; validate
  `npx expo run:android` on a physical device before release.
