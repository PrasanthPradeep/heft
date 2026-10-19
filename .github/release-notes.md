Offline-first weight tracking for Android. No account, no server, no subscription.

## Install

1. Download the `.apk` below.
2. Tap it, and allow *install unknown apps* if Android asks.
3. On first run, choose how Heft stores your data:
   - **Health Connect** — read your existing weight history and write new readings back.
   - **Local only** — everything stays in the app's own database. No health permissions requested.

## Requirements

- Android 8.0 or newer, on a real phone. The APK carries native libraries for both 64-bit and 32-bit devices, which between them cover every Android phone. It will *not* install on an Android emulator running on Intel or AMD hardware.
- Health Connect is built into Android 14+. On Android 8–13, install the [Health Connect app](https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata) first.
- Local-only mode needs nothing at all.

## What's inside

- **Latest weight, insights and history** — 30 and 90 day change, plus a chart.
- **Reminders** for weigh-ins and water. Off by default; turning one on is the only time Heft asks for the notification permission, and the alerts are scheduled on the device.
- **Export and import** readings as CSV or JSON, through the system share sheet.
- **Optional AI assistant**, off by default and only if you supply your own OpenAI key.
- Only the readings Heft itself wrote are ever edited or deleted. Anything imported from Health Connect is left untouched.

## Updates

This build receives fixes automatically: JavaScript and assets arrive over the air, so there is no need to reinstall to get them.

## Verifying the download

```
APK SHA-256    {SHA256}
```

Package `com.heft.app`, version {VERSION}.
