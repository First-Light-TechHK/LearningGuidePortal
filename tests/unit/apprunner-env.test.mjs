import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicHttpsUrl, assertSecretArn, mergeRuntimeConfiguration } from "../../scripts/apprunner-env.mjs";

function codeRepository(overrides = {}) {
  return {
    CodeRepository: {
      CodeConfiguration: {
        CodeConfigurationValues: {
          Runtime: "NODEJS_22",
          Port: "8080",
          RuntimeEnvironmentVariables: { APP_ENV: "DEV", KS_TUTOR_TIMEOUT_MS: "60000" },
          RuntimeEnvironmentSecrets: { SESSION_SECRET: "arn:aws:secretsmanager:ap-southeast-1:851987565851:secret:session" },
        },
      },
    },
    ...overrides,
  };
}

test("mergeRuntimeConfiguration preserves existing keys and adds new ones", () => {
  const result = mergeRuntimeConfiguration(codeRepository(), {
    variables: { KS_TUTOR_BASE_URL: "https://ks.example.com" },
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.applied.variables, ["KS_TUTOR_BASE_URL"]);
  const values = result.sourceConfiguration.CodeRepository.CodeConfiguration.CodeConfigurationValues;
  assert.equal(values.Port, "8080");
  assert.equal(values.RuntimeEnvironmentVariables.APP_ENV, "DEV");
  assert.equal(values.RuntimeEnvironmentVariables.KS_TUTOR_BASE_URL, "https://ks.example.com");
  assert.deepEqual(values.RuntimeEnvironmentSecrets, { SESSION_SECRET: "arn:aws:secretsmanager:ap-southeast-1:851987565851:secret:session" });
});

test("mergeRuntimeConfiguration reports no change when values already match", () => {
  const source = codeRepository();
  source.CodeRepository.CodeConfiguration.CodeConfigurationValues.RuntimeEnvironmentVariables.KS_TUTOR_BASE_URL = "https://ks.example.com";
  const result = mergeRuntimeConfiguration(source, { variables: { KS_TUTOR_BASE_URL: "https://ks.example.com" } });
  assert.equal(result.changed, false);
});

test("mergeRuntimeConfiguration skips empty values so drift is not cleared accidentally", () => {
  const result = mergeRuntimeConfiguration(codeRepository(), {
    variables: { KS_TUTOR_BASE_URL: "" },
    secrets: { KS_TUTOR_API_KEY: "" },
  });
  assert.equal(result.changed, false);
  assert.deepEqual(result.applied, { variables: [], secrets: [] });
});

test("mergeRuntimeConfiguration supports image-based services", () => {
  const source = {
    ImageRepository: {
      ImageConfiguration: {
        Port: "8080",
        RuntimeEnvironmentVariables: {},
      },
    },
  };
  const result = mergeRuntimeConfiguration(source, { variables: { KS_TUTOR_BASE_URL: "https://ks.example.com" } });
  assert.equal(result.sourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.KS_TUTOR_BASE_URL, "https://ks.example.com");
});

test("mergeRuntimeConfiguration rejects an unknown source configuration", () => {
  assert.throws(() => mergeRuntimeConfiguration({}, {}), /neither CodeRepository nor ImageRepository/);
});

test("assertPublicHttpsUrl accepts an App Runner https origin and strips trailing slashes", () => {
  assert.equal(
    assertPublicHttpsUrl("https://cpzmzuzkkj.ap-southeast-1.awsapprunner.com///"),
    "https://cpzmzuzkkj.ap-southeast-1.awsapprunner.com",
  );
});

test("assertPublicHttpsUrl rejects the local-development values that cause the cloud offline", () => {
  assert.throws(() => assertPublicHttpsUrl("http://localhost:3000"), /must use https/);
  assert.throws(() => assertPublicHttpsUrl("https://admin.example.com:3000"), /must not include a port/);
  assert.throws(() => assertPublicHttpsUrl("https://localhost"), /must not point to localhost/);
  assert.throws(() => assertPublicHttpsUrl("https://[::1]"), /must not point to localhost/);
  assert.throws(() => assertPublicHttpsUrl("https://user:pass@ks.example.com"), /must not contain credentials/);
  assert.throws(() => assertPublicHttpsUrl(""), /required/);
});

test("assertSecretArn requires a Secrets Manager ARN", () => {
  assert.equal(
    assertSecretArn("arn:aws:secretsmanager:ap-southeast-1:851987565851:secret:learning-guide/admin/dev/token", "TOKEN"),
    "arn:aws:secretsmanager:ap-southeast-1:851987565851:secret:learning-guide/admin/dev/token",
  );
  assert.throws(() => assertSecretArn("plain-token", "TOKEN"), /not a Secrets Manager ARN/);
});
