# Heft

Heft is an offline-first body-weight tracker for Android. The core app needs
**no account, no server, and no subscription**. You enter each reading by hand,
and you choose where it lives:

- **Health Connect** — your weight history lives in the Android Health Connect
  app. Heft reads the accessible history, writes new readings back, and keeps
  only settings plus a small, disposable cache on the device. Optional **activity
  data** (steps and exercise sessions) can also be read from Health Connect —
  this is how Google Fit / Fitbit / Samsung Health data reaches Heft, since
  Google now surfaces those apps through Health Connect.
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
Write new readings          │
Queue failures in           └── weight_entries
pending_weights
```

1. **Onboarding** (`src/app/onboarding.tsx`) — pick Health Connect or local
   storage. If Health Connect is unavailable or permission is denied, Heft offers
   local storage instead of blocking.
2. **Dashboard** (`src/app/index.tsx`) — latest reading, the recent list, a
   one-tap Sync now, a pull-to-refresh, and an in-app weigh-in reminder.
3. **Add / edit** (`src/app/add-weight.tsx`, `src/features/weight/WeightEntryForm.tsx`)
   — a manual form (weight, date/time, note). The same screen handles edits.
4. **History** (`src/app/history.tsx`) — the full list with edit and delete.
5. **Insights** (`src/app/insights.tsx`) — chart, 7-day average, weekly and
   30-day change, goal weight and milestone progress, plus (in Health Connect
   mode) a weekly activity summary.
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
app that has not declared the historical-read permission. Heft deliberately
requests only `READ_WEIGHT` / `WRITE_WEIGHT` and syncs a 30-day window; reading
further back would require the `READ_HEALTH_DATA_HISTORY` permission and a Play
Store declaration.

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

### Local-only mode

SQLite is authoritative. Every reading is stored in `weight_entries`, there is
no health permission, and nothing syncs. Export and import both work in this
mode.

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
apps* and tap it. To build locally instead:

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease   # app/build/outputs/apk/release/
```

The generated `release` block signs with the **debug keystore**, so give it a
real release keystore (and keep that file safe) before handing an APK to anyone.
Android only installs an update over an existing app when the signature matches,
so losing the key means every user has to uninstall and reinstall.

A locally built APK also carries **no update channel**: it installs and runs
perfectly, but it will never pick up an `eas update`. Only `eas build` injects
`expo-channel-name` into the manifest. If you genuinely want a Gradle-only APK to
update, add it yourself through `updates.requestHeaders` in `app.json`.

### One CPU architecture (arm64)

`expo-build-properties` pins `android.buildArchs` to `arm64-v8a` in `app.json`,
so the APK carries native libraries for a single CPU family instead of four.
That takes a preview APK from **105 MB to 46 MB** with no loss for anyone: every
phone made since roughly 2016 is arm64, including every current mainstream
device.

The trade-off is deliberate. The APK will *not* install on a 32-bit-only phone
(`armeabi-v7a`) or on an Android emulator running on Intel/AMD hardware
(`x86_64`). For a universal build, restore all four architectures in `buildArchs`
and rebuild.

This is packaging only. Installed apps keep working and keep receiving
over-the-air updates either way, and `runtimeVersion` stays `1.0.0`.

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
attaches the APK to it.

Two resources to keep in mind: EAS allows 15 Android builds a month on the free
plan, and a cloud build can wait in a low-priority queue for up to 45 minutes.
Both workflows need the same `EXPO_TOKEN` secret.

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
- Assistant: connect via ChatGPT (or paste an API key), pick a model, send a
  message; toggle **Share health data** and confirm **Preview shared data**
  matches what is sent.

## Project layout

```
src/
  app/                              expo-router screens
    _layout.tsx                     providers, onboarding redirect, launch sync
    onboarding.tsx                  first-run storage choice
    index.tsx                       dashboard (latest, recent, sync, reminder)
    add-weight.tsx                  add / edit / delete a reading
    history.tsx                     full history list
    insights.tsx                    chart, trends, goal + milestones, activity
    assistant.tsx                   opt-in AI chat over your data
    settings.tsx                    storage, units, reminders, AI, export/import
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
      healthConnectPermissions.ts   availability + weight/activity permissions
      healthConnectAdapter.ts       read / write / delete via Health Connect
      weightCache.ts                cache read + windowed replace
      weightSync.ts                 two-way sync + activity refresh
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
  lib/format.ts                     deterministic formatting helpers
```

## Schema

`PRAGMA user_version` drives migrations (see `src/db/migrations.ts`). Schema v5:

| Table              | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `preferences`      | Key/value store; app preferences as one JSON blob    |
| `weight_entries`   | Authoritative store for **local-only** mode          |
| `weight_cache`     | Disposable 30-day mirror of Health Connect           |
| `pending_weights`  | Heft readings awaiting a Health Connect write        |
| `activity_daily`   | Disposable per-day step counts from Health Connect   |
| `activity_sessions`| Disposable recent exercise sessions from Health Connect |
| `ai_messages`      | Local assistant transcript (cleared by delete-all)   |

Settings and cache live locally in **both** modes; only `weight_entries` is
mode-specific.

## Privacy

- No account, no sign-in, no server, no analytics — unless you opt into the
  assistant.
- Local mode: data never leaves the device.
- Health Connect mode: data is read from and written to Android Health Connect
  under your control. Heft never touches records it did not create. Activity is
  read-only.
- Assistant: off by default. When on, requests go straight to OpenAI with your
  own credentials. Weight/trend data is only attached after you turn on **Share
  health data with the AI**, which shows exactly what will be sent.
- Reminders are **in-app only** — Heft does not request the notification
  permission.

## Known limitations / next steps

- **30-day read window.** Older Health Connect history is not imported (see
  above); extending it needs the historical-read permission.
- **Push-then-pull sync only.** Heft does not reconcile Health Connect edits made
  by other apps for records it already cached beyond re-reading the window.
- **Import is local-only** by design, to avoid duplicating Health Connect data.
- **No native notifications.** The reminder is a banner shown inside the app.
- **ChatGPT sign-in is experimental on mobile.** It relies on intercepting a
  loopback redirect inside a WebView and skips ID-token signature verification.
  It cannot be fully verified without a physical device; the API-key path is the
  dependable fallback.
- **Activity needs Health Connect mode.** Local-only mode never reads Health
  Connect, preserving its "no health permission" promise.
- A full end-to-end Android build has not been run in CI; validate
  `npx expo run:android` on a physical device before release.
