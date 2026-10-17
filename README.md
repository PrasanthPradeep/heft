# Heft

Heft is an offline-first body-weight tracker for Android. There is **no account,
no server, and no AI service**. You enter each reading by hand, and you choose
where it lives:

- **Health Connect** — your weight history lives in the Android Health Connect
  app. Heft reads the accessible history, writes new readings back, and keeps
  only settings plus a small, disposable cache on the device.
- **Local storage only** — your complete history lives on this device in SQLite.
  No health permission is requested.

The app works with **no network**. Everything below runs on-device.

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
   30-day change, plus goal weight and milestone progress.
6. **Settings** (`src/app/settings.tsx`) — storage mode, units, remind time,
   export / import, and delete-all.

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

### Local-only mode

SQLite is authoritative. Every reading is stored in `weight_entries`, there is
no health permission, and nothing syncs. Export and import both work in this
mode.

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
- Put the device offline, add a reading: it is marked **NOT SYNCED** and listed
  in Settings as waiting; go online and **Sync now** uploads it without
  duplicating.
- Revoke permission mid-use: the app keeps working from the cache and queued
  readings stay put.
- A Health Connect record from another app cannot be edited or deleted in Heft.
- Switching to local storage stops syncing and does not delete Health Connect
  data.
- Export then import in local mode; duplicate readings are skipped.
- Kill and relaunch the app: local-mode readings persist; Health Connect mode
  re-syncs on launch.

## Project layout

```
src/
  app/                              expo-router screens
    _layout.tsx                     providers, onboarding redirect, launch sync
    onboarding.tsx                  first-run storage choice
    index.tsx                       dashboard (latest, recent, sync, reminder)
    add-weight.tsx                  add / edit / delete a reading
    history.tsx                     full history list
    insights.tsx                    chart, trends, goal + milestones
    settings.tsx                    storage, units, reminders, export/import
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
      healthConnectPermissions.ts   availability + permission flow
      healthConnectAdapter.ts       read / write / delete via Health Connect
      weightCache.ts                cache read + windowed replace
      weightSync.ts                 two-way sync orchestration
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

`PRAGMA user_version` drives migrations (see `src/db/migrations.ts`). Schema v1:

| Table             | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `preferences`     | Key/value store; app preferences as one JSON blob    |
| `weight_entries`  | Authoritative store for **local-only** mode          |
| `weight_cache`    | Disposable 30-day mirror of Health Connect           |
| `pending_weights` | Heft readings awaiting a Health Connect write        |

Settings and cache live locally in **both** modes; only `weight_entries` is
mode-specific.

## Privacy

- No account, no sign-in, no server, no analytics.
- Local mode: data never leaves the device.
- Health Connect mode: data is read from and written to Android Health Connect
  under your control. Heft never touches records it did not create.
- Reminders are **in-app only** — Heft does not request the notification
  permission.

## Known limitations / next steps

- **30-day read window.** Older Health Connect history is not imported (see
  above); extending it needs the historical-read permission.
- **Push-then-pull sync only.** Heft does not reconcile Health Connect edits made
  by other apps for records it already cached beyond re-reading the window.
- **Import is local-only** by design, to avoid duplicating Health Connect data.
- **No native notifications.** The reminder is a banner shown inside the app.
- A full end-to-end Android build has not been run in CI; validate
  `npx expo run:android` on a physical device before release.
