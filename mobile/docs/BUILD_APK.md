# Building an APK for testers

The short version, on any machine with Node 20 and this folder:

```bash
cd mobile
npm install
npx eas-cli login          # your Expo account — free, one-time
npm run build:apk
```

There is no `eas init` step: the project already exists
(`@dammy-v/heabron-mobile`) and both `owner` and `extra.eas.projectId` are
set in `app.config.ts`. Running `eas init` again would offer to create a
second project — say no if it ever asks.

> If you ran `eas init` and it stopped with *"Cannot automatically write to
> dynamic config at: app.config.ts"*, that is expected and already handled.
> `eas init` edits a static `app.json`; this project uses TypeScript config,
> which it cannot edit, so it prints the project ID and stops. The ID it
> printed is in `app.config.ts` under `extra.eas.projectId`.

The last command prints a link. When the build finishes (10–20 minutes for a
first build, faster after) that page has a **Download** button and a QR code.
The APK behind it is what you send to testers.

Nothing needs to be installed beyond Node — no Android Studio, no SDK, no JDK.
The build happens on Expo's servers.

---

## What `npm run build:apk` does

Two checks, then the build. Both checks exist because EAS fails *slowly*:
queue, spin up a builder, install, and only then discover the problem.

1. **The lock file matches package.json.** EAS installs with `npm ci`, which
   refuses outright when they disagree — it does not fall back to
   `npm install`. Nothing locally notices, because `npm install` and
   `expo start` both repair the lock as they go. `scripts/check-lockfile.mjs`
   runs the builder's own `npm ci --dry-run` here instead.
2. **The API answers.** `scripts/check-api-url.mjs` reads the URL the build
   will use out of `eas.json` and calls `GET <url>/health`. A wrong URL costs
   the whole build twice over, because the APK installs fine and only fails
   when a tester taps Sign in.
3. **Builds a release APK** on EAS with the `preview` profile, signed, pointed
   at the live API.

If a check fails but you are sure it is wrong (the server is asleep, say),
build without them:

```bash
npx eas-cli build --platform android --profile preview
```

### If the build fails at "Install dependencies"

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json ... are in sync.
```

Run `npm install`, make sure the updated `package-lock.json` is saved, and
build again. `npm run check:lock` reproduces this in a few seconds.

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
    "PRODUCTION_BASE_URL": "https://api.heabroncoopscore.com/api"
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

> The API is on its own subdomain, `api.heabroncoopscore.com` — **not** the
> domain the dashboard is served from. `heabroncoopscore.com/api/health`
> answers 200 with the dashboard's HTML, because the SPA serves its index
> page for any path it does not recognise; an APK built against it installs
> fine and then fails on the first request. `npm run check:api` exists for
> exactly that: it rejects an HTML body even on a 200.

## Signing

The first `eas build` offers to generate an Android keystore and keep it on
your Expo account. Say yes. It is reused for every later build, which is what
lets a tester install an update over the previous APK instead of uninstalling
first.

Do not generate a new keystore later for the same app — a differently-signed
APK will not install over an existing one.

For the same reason, builds must come from the `dammy-v` account, which is
why `owner` is pinned in `app.config.ts`. Someone building from their own
Expo account would get a separate project with a separate keystore, and the
APKs it produced would refuse to install over the ones testers already have.
To let a colleague build, add them to the `dammy-v` account on expo.dev
rather than letting them create their own project.

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

Typecheck, lint, 232 tests, the backend contract check and the lock-file
check. Worth the ninety seconds: a build that fails on EAS still costs the
queue time.

## Node version

The builder runs Node 22.13.0, set in `eas.json` under `build.base.node`.
Expo SDK 58 and React Native 0.88 require `^22.13.0 || ^24.3.0 || >=26.0.0` —
on Node 20 the install fills with `EBADENGINE` warnings and the build is not
supported. Use Node 22 locally too, for the same reason.

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
USE_STAGING=false PRODUCTION_BASE_URL=https://api.heabroncoopscore.com/api npm run prebuild:android
```
