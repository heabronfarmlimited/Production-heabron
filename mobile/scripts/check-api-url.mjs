#!/usr/bin/env node
/**
 * Does the API this build will point at actually answer?
 *
 * Run: node scripts/check-api-url.mjs [profile]   (default: preview)
 *
 * WHY
 *
 * An Android build takes ten to twenty minutes on EAS. A wrong base URL
 * costs all of it twice: once to build, once to notice — because the app
 * installs fine and only fails when a tester taps Sign in, by which point
 * the APK is in a WhatsApp group and everyone is reporting a different
 * symptom.
 *
 * The URL is resolved exactly the way the build resolves it (eas.json ->
 * build.<profile>.env, inherited through `extends`), and `GET <url>/health`
 * is called. Thirty seconds, before the build starts.
 *
 * This is a pre-build convenience, not a gate on the app: it is wired into
 * the `build:*` scripts with `&&`, so a failure stops the build.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profileName = process.argv[2] || 'preview';

const bar = '─'.repeat(70);

/**
 * Stops the script with a message and a non-zero status.
 *
 * `process.exit()` is deliberately not used. On Windows, exiting while a
 * socket is still closing trips a libuv assertion —
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c`
 * — which prints a crash after the real message and makes a working check
 * look broken. Setting `exitCode` and letting the process finish on its own
 * gives the same status to the `&&` in `npm run build:apk` without the noise.
 */
class Stop extends Error {}
const die = (msg) => {
  throw new Stop(msg);
};

/**
 * eas.json is strict JSON and EAS validates it against a closed schema — a
 * `"//"` comment key is rejected outright ("// is not allowed"), which is why
 * there are no comments in it and the explanation lives in docs/BUILD_APK.md.
 */
async function main() {
  let eas;
  try {
    eas = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8'));
  } catch (err) {
    die(`Could not read eas.json: ${err.message}`);
  }

  /** `env` of a profile, with everything it `extends` folded in underneath. */
  function envFor(name, seen = new Set()) {
    if (seen.has(name)) die(`eas.json: build profile "${name}" extends itself.`);
    seen.add(name);
    const profile = eas.build?.[name];
    if (!profile) {
      const known = Object.keys(eas.build || {}).join(', ');
      die(`eas.json has no build profile "${name}". Profiles: ${known}`);
    }
    const parent = profile.extends ? envFor(profile.extends, seen) : {};
    return { ...parent, ...(profile.env || {}) };
  }

  const env = envFor(profileName);
  const useStaging = env.USE_STAGING !== 'false';
  const varName = useStaging ? 'STAGING_BASE_URL' : 'PRODUCTION_BASE_URL';
  const baseUrl = env[varName];

  if (!baseUrl) {
    die(
      `Profile "${profileName}" sets USE_STAGING=${env.USE_STAGING ?? '(unset)'},\n` +
        `so it needs ${varName} — and build.${profileName}.env does not set it.\n` +
        'The build would fail on the EAS builder (app.config.ts checks this too).',
    );
  }

  const health = `${baseUrl.replace(/\/+$/, '')}/health`;
  console.log(`\n${bar}`);
  console.log(`profile   : ${profileName}`);
  console.log(`environment: ${useStaging ? 'staging' : 'production'}`);
  console.log(`API       : ${baseUrl}`);
  console.log(`checking  : GET ${health}`);
  console.log(bar);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  let res;
  try {
    res = await fetch(health, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    die(
      `Could not reach ${health}\n  ${err.name === 'AbortError' ? 'timed out after 15s' : err.message}\n\n` +
        'Check the URL in eas.json, and that the backend is deployed and awake.\n' +
        'Build anyway with:  npx eas-cli build --platform android --profile ' + profileName,
    );
  }
  clearTimeout(timer);

  const body = await res.text().catch(() => '');

  if (!res.ok) {
    die(`${health} answered ${res.status} ${res.statusText}\n${body.slice(0, 300)}`);
  }

  /**
   * A 200 is not proof: a single-page app serves 200 and an HTML document for
   * any unknown path, so a base URL missing its `/api` prefix passes a naive
   * status check and then 404s every real request from the phone.
   */
  if (/^\s*</.test(body)) {
    die(
      `${health} answered 200 but returned HTML, not JSON.\n\n` +
        'That is the web dashboard answering, not the API — the base URL is\n' +
        `probably missing its /api suffix. Got: ${body.slice(0, 120).replace(/\s+/g, ' ')}`,
    );
  }

  console.log(`  OK — ${res.status}, ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
  console.log(`${bar}\n`);

}

try {
  await main();
} catch (err) {
  if (err instanceof Stop) {
    console.error(`\n${bar}\n${err.message}\n${bar}\n`);
  } else {
    console.error(`\n${bar}\nUnexpected failure in check-api-url:\n${err?.stack || err}\n${bar}\n`);
  }
  // Not process.exit() — see `die` above. The status still reaches the `&&`
  // in `npm run build:apk`, so a failed check stops the build.
  process.exitCode = 1;
}
