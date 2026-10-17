# Heft

Heft is an offline-first body-weight tracker. You photograph your scale's LCD,
the app reads the number on-device with Google ML Kit, you confirm the reading,
and it is stored locally in SQLite. Cloud sync with Supabase is opt-in.

The local-first flow works with **no account and no network**.

## How it works

```
Dashboard ──▶ Camera capture ──▶ Confirmation ──▶ SQLite (transactional) ──▶ Dashboard
   │                                    │                    │
   └── Add manually ────────────────────┘              sync_outbox ──▶ Supabase
```

1. **Dashboard** (`src/app/index.tsx`) — latest reading, history, entry points.
2. **Camera** (`src/app/scan.tsx`) — captures a photo and runs OCR on-device.
3. **Confirmation** (`src/app/confirm-weight.tsx`) — the safety step: edit the
   candidate value and pick the measurement date/time before saving.
4. **Storage** (`src/db/database.ts`, `src/features/measurements/repository.ts`)
   — the entry and a `sync_outbox` record are written in one transaction.
5. **Sync** (`src/features/sync/sync.ts`) — pushes pending entries to Supabase
   with an idempotent upsert keyed on the local id.

## Requirements

- Node.js 20+
- Expo SDK 57 (pinned in `package.json`)
- An Android device for camera/OCR testing (a simulator cannot validate focus,
  reflections, or the native OCR module)

## Setup

```bash
npm install

# Android native development build (required: ML Kit is a native module)
npx expo prebuild --platform android
npx expo run:android
```

`expo-go` **cannot** run this app. The OCR module and `expo-sqlite` need a
development build (or EAS Build with an Android development profile).

To use EAS Build:

```bash
eas build --profile development --platform android
```

Rebuild the development client whenever native dependencies change.

## OCR compatibility note

The original design specified `@react-native-ml-kit/text-recognition`. That
package is a **legacy React Native bridge module** (no Expo config plugin, old
`compileSdk`, no `namespace`) and is unreliable on Expo SDK 57 / RN 0.86 /
AGP 8. This project uses **`expo-mlkit-ocr`** instead, which is a proper Expo
module with a config plugin and the same underlying Google ML Kit engine.

The provider is isolated behind one adapter: `src/features/camera/WeightOcr.ts`.
Everything else (parser, confirmation screen, database) is provider-agnostic, so
swapping OCR providers only touches that file.

The parser (`src/features/camera/parser.ts`) is pure and tested without a
device:

```bash
npm test
```

It is geometry-aware: `expo-mlkit-ocr` returns per-token bounding boxes, and the
parser keeps only the numeric candidates whose glyphs are the **largest** on the
photo (the LCD readout is always the biggest text). Smaller numbers elsewhere on
the scale — a room-temperature readout, a model sticker, a `kg` marker — are
discarded. Numeric fragments split around a decimal point (`55` `.` `2`) are
rejoined, and when no geometry is available it falls back to plain-text parsing.

Seven-segment decimal points are often **not** recognised by ML Kit: a scale
showing `55.2` commonly comes back as `552`. When the largest token sits next to
a `kg`/`lb` unit and its plain integer is outside the profile range, the parser
recovers the decimal placement (`552` → `55.2`) that fits the range and aligns
with the profile's graduation. Pick the profile that matches your scale under
**Settings** so the recovery picks the right precision.

## Scale profiles

Display resolutions differ between scales, so each profile carries its own
graduation (`src/features/camera/profiles.ts`). The selected profile is stored
in `AsyncStorage` and validated on save, so the Flora Sports 0.05 kg step is
**not** applied to every scale. Pick your scale under **Settings**.

## Cloud sync (optional)

Sync is skipped entirely until Supabase is configured. To enable it:

1. Create a Supabase project.
2. Copy `.env.example` to `.env` and fill in the **publishable/anon** key only:

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
   ```

   Never put a service-role/secret key in the app. `.env` is gitignored.

3. Apply the database migration (see
   `supabase/migrations/0001_weight_entries.sql`). Row Level Security is enabled
   and policies restrict every row to `auth.uid() = user_id`.
4. Rebuild the development client so the new env vars are embedded, then sign in
   from **Settings → Cloud sync**.

The sync engine uses the locally generated UUID as the PostgreSQL primary key,
so retrying the same upload cannot create duplicates.

### Self-hosting

Use the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase init
supabase start                     # local Postgres + Auth + API
supabase db reset                  # applies supabase/migrations
supabase status                    # prints local URL + anon key
```

Point `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` at the local
values. Authentication is Supabase email/password; no other configuration is
required for a local project.

## Testing

```bash
npm test          # parser unit tests with OCR fixtures
npm run typecheck # tsc --noEmit
npm run lint      # expo lint
npx expo-doctor   # dependency/config health check
```

Manual device checklist:

- The scale shows `54.25`; OCR proposes the right candidate.
- OCR misreads a value that conflicts with the selected graduation; you correct it.
- The photo is blurry or the LCD is unreadable (manual entry still works).
- Camera permission is denied (manual entry fallback).
- A reading is confirmed while offline, the app is closed and reopened, and the
  record is still there.
- Sync retries and succeeds without duplication; a second account cannot read
  the first account's rows.

## Project layout

```
src/
  app/                         expo-router screens (index, scan, confirm-weight, settings)
  components/ui.tsx            shared Button/Card/Screen primitives
  constants/theme.ts           colors, spacing, radii
  db/database.ts               SQLite schema + connection
  features/
    camera/parser.ts           pure OCR result -> weight candidates (largest-font LCD first)
    camera/WeightOcr.ts        OCR adapter (expo-mlkit-ocr)
    camera/profiles.ts         scale profiles
    measurements/repository.ts validation + transactional save/list/delete
    settings/preferences.tsx   selected scale profile (context + AsyncStorage)
    sync/sync.ts               outbox -> Supabase upsert
  lib/format.ts                deterministic formatting helpers
  lib/supabase.ts              Supabase client (optional)
supabase/migrations/           Postgres schema + RLS
```

## Known limitations / next steps

- **Candidate ranking.** Candidates are ranked by glyph height (largest first),
  which reliably selects the LCD. It does not yet verify that the largest text
  is *centered* on the display, so an unusually large sticker could still rank
  first; confirm on device and adjust `DOMINANT_SIZE_RATIO` in
  `src/features/camera/parser.ts` if needed.
- **Cropping.** The camera guide rectangle is visual only; it does not crop or
  perspective-correct the image.
- **Sync is push-only.** Remote edits made on other devices are not pulled yet.
- **No auth UI for a configured backend beyond email/password** in Settings.
- A full end-to-end Android build has not been run in CI; validate
  `npx expo run:android` on a physical device before release.
