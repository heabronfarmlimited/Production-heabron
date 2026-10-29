/**
 * Environment configuration — replaces `app_environmental_variables.dart`
 * and the `ApiConstant` timeout/base-url block in `api_constants.dart`.
 *
 * Flutter read these through `String.fromEnvironment` with
 * `--dart-define-from-file=env.json`. The RN equivalent is `app.config.ts`
 * -> `expo-constants`, so values live in `.env` / EAS secrets instead.
 *
 * NOTE — the Dart defaults pointed at `staging.api.uteriflow.com` /
 * `api.uteriflow.com`, which belong to an unrelated project and would have
 * silently sent traffic to the wrong host if `env.json` were ever missing.
 * This port deliberately has no fallback host: a missing base URL throws at
 * startup instead of failing quietly.
 */
import Constants from 'expo-constants';

type Extra = {
  stagingBaseUrl?: string;
  productionBaseUrl?: string;
  useStaging?: boolean;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/**
 * `ApiConstant.useStaging` — switches between environments.
 * Defaults to staging in dev builds and production otherwise.
 */
export const USE_STAGING: boolean = extra.useStaging ?? __DEV__;

const STAGING_BASE_URL = extra.stagingBaseUrl ?? '';
const PRODUCTION_BASE_URL = extra.productionBaseUrl ?? '';

function resolveBaseUrl(): string {
  const url = USE_STAGING ? STAGING_BASE_URL : PRODUCTION_BASE_URL;

  if (!url) {
    throw new Error(
      `[config] Missing ${USE_STAGING ? 'STAGING_BASE_URL' : 'PRODUCTION_BASE_URL'}. ` +
        'Set it in .env and surface it through app.config.ts -> extra. ' +
        'The URL must include the /api suffix, e.g. https://host.tld/api',
    );
  }

  // Trailing slashes would produce `//auth/login` once joined with endpoints.
  return url.replace(/\/+$/, '');
}

/** `ApiConstant.baseUrl` */
export const BASE_URL: string = resolveBaseUrl();

/**
 * Request timeouts — `ApiConstant.connectTimeout` / `sendTimeout` /
 * `receiveTimeout`, all 30s in Dart. Axios has a single `timeout`, so the
 * receive timeout is the effective one.
 */
export const TIMEOUTS = {
  connect: 30_000,
  send: 30_000,
  receive: 30_000,
} as const;

/** Default page size — matches `ResponseMeta.pageSize` fallback of 20. */
export const DEFAULT_PAGE_SIZE = 20;
