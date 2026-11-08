/**
 * App Runner source deployments keep the service configuration, so the KS AI
 * Tutor endpoint has to be written into the service itself rather than into
 * .env or the image.
 *
 * DEV does this in `dev-deploy.yml` through `scripts/apprunner-set-env.mjs`.
 * SIT and UAT had no equivalent step, so nothing ever re-asserted the value:
 * UAT ran with no `KS_TUTOR_BASE_URL` until 2026-11-08 and hid every AI Tutor
 * entry in both the course room and the live study-group room, while DEV and
 * SIT worked.
 *
 * Merging here (rather than as a separate workflow step) keeps it atomic with
 * the release: the release's own update-service carries the value, instead of
 * starting a second deployment the release would then collide with.
 */
export function mergeKsTutorConfiguration(source, env = process.env) {
  const baseUrl = env.KS_TUTOR_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) return false;
  const values = source?.CodeRepository?.CodeConfiguration?.CodeConfigurationValues;
  if (!values) return false;
  values.RuntimeEnvironmentVariables = {
    ...(values.RuntimeEnvironmentVariables || {}),
    KS_TUTOR_BASE_URL: baseUrl,
    ...(env.KS_TUTOR_TIMEOUT_MS?.trim() ? { KS_TUTOR_TIMEOUT_MS: env.KS_TUTOR_TIMEOUT_MS.trim() } : {})
  };
  // Only set when KS runs with AUTH_ENABLED=true; the value must be the same
  // Secrets Manager entry the service reads as AUTH_TOKEN.
  if (env.KS_TUTOR_API_KEY_SECRET_ARN?.trim()) {
    values.RuntimeEnvironmentSecrets = {
      ...(values.RuntimeEnvironmentSecrets || {}),
      KS_TUTOR_API_KEY: env.KS_TUTOR_API_KEY_SECRET_ARN.trim()
    };
  }
  return true;
}
