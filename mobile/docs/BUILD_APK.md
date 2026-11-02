# Building an APK for testers

The short version, on any machine with Node 20 and this folder:

```bash
cd mobile
npm install
npx eas-cli login          # your Expo account — free, one-time
npx eas-cli init           # one-time, links this app to an EAS project
npm run build:apk
```

The last command prints a link. When the build finishes (10–20 minutes for a
first build, faster after) that page has a **Download** button and a QR code.
The APK behind it is what you send to testers.

Nothing needs to be installed beyond Node — no Android Studio, no SDK, no JDK.
The build happens on Expo's servers.

---

## What `npm run build:apk` does

1. **Checks the API first.** `scripts/check-api-url.mjs` reads the URL the
   build will use out of `eas.json` and calls `GET <url>/health`. A build
   takes fifteen minutes; a wrong URL costs that twice, because the APK
   installs fine and only fails when a tester taps Sign in. This catches it in
   about a second, and stops the build.
2. **Builds a release APK** on EAS with the `preview` profile, signed, pointed
   at the live API.

If the check fails but you are sure the URL is right (the server is asleep,
say), build without it:

```bash
npx eas-cli build --platform android --profile preview
```

## Profiles

| Command | Output | Points at | Use |
|---|---|---|---|
| `npm run build:apk` | **APK** | production API | **what you send to testers** |
| `npm run build:apk:staging` | APK | staging API | testing against staging |
| `npm run build:aab` | .aab | production API | Google Play upload only |

An `.aab` is **not installable on a phone**. Google Play requires it; testers
cannot use it. For anything you hand out directly, use `build:apk`.

## The API URL

One place, `eas.json`:

```json
"preview": {
  "env": {
    "USE_STAGING": "false",
    "PRODUCTION_BASE_URL": "https://heabroncoopscore.com/api"
  }
}
```

It is here rather than in `.env` because the config is evaluated on the EAS
build server, where your local `.env` does not exist — a value set only there
produces an app with no server to talk to.

**It must end with `/api`,** and it must be `https`. Both are checked twice:
by `npm run check:api` before the build, and by `app.config.ts` on the build
server, which fails the build rather than letting a broken APK out. Android
blocks cleartext traffic in release builds, so `http://` cannot work on a
phone even if it works in the simulator.

> Confirm `https://heabroncoopscore.com/api` is right before the first build.
> `npm run check:api -- preview` answers in a second: a JSON body means yes;
> HTML means the dashboard answered instead of the API and the URL is wrong.

## Signing

The first `eas build` offers to generate an Android keystore and keep it on
your Expo account. Say yes. It is reused for every later build, which is what
lets a tester install an update over the previous APK instead of uninstalling
first.

Do not generate a new keystore later for the same app — a differently-signed
APK will not install over an existing one.

## Version numbers

`eas.json` sets `appVersionSource: "remote"` with `autoIncrement`, so EAS owns
the Android `versionCode` and bumps it on every build. Two builds on the same
day will not collide, and you never edit a number by hand.

The user-facing version (`1.0.0`) is `version` in `app.config.ts`. Change it
when you want testers to see a different number.

## Installing it

Send the download link, or the APK file itself. On the phone:

1. Open the link in Chrome and download.
2. Android asks to allow installs from this source — allow it.
3. Open the downloaded file and install.

A tester updating to a newer build installs over the top; no uninstall needed,
and their data stays.

## Before you build

```bash
npm run verify
```

Typecheck, lint, 232 tests and the backend contract check. Worth the ninety
seconds: a build that fails on EAS still costs the queue time.

---

## Building locally instead (optional)

Only if you want to avoid EAS. Needs **JDK 17** and the **Android SDK**
(Android Studio installs both).

```bash
cd mobile
npm install
npm run prebuild:android     # generates the android/ folder
cd android
./gradlew assembleRelease
```

The APK lands at `android/app/build/outputs/apk/release/app-release.apk`.

Two caveats:

- `android/` is generated and git-ignored. It is not a folder to edit by
  hand — `prebuild --clean` rewrites it from `app.config.ts`, which is why all
  the manifest and permission settings live there.
- A local release build is **unsigned** unless you add a keystore and a
  `signingConfigs` block to `android/app/build.gradle`. An unsigned APK will
  not install. EAS handles this for you, which is the main reason to prefer
  it.

Set the API URL for a local build in the environment, since `eas.json` is not
read here:

```bash
USE_STAGING=false PRODUCTION_BASE_URL=https://heabroncoopscore.com/api npm run prebuild:android
```
