import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const template = readFileSync("deploy/uat-infrastructure.yml", "utf8");
const provisioner = readFileSync("scripts/provision-uat.mjs", "utf8");
const archiveResource = "arn:aws:s3:::aitutor-data-851987565851/learning-guide/dev/documents/mvp/*";

test("UAT may read only the static legacy course-media archive", () => {
  const policy = template.match(/- PolicyName: course-media-archive-read-only([\s\S]*?)(?=\n        - PolicyName:|\n  Connector:)/)?.[1];
  assert.ok(policy, "CloudFormation must define the UAT course-media policy");
  assert.match(policy, /Action: s3:GetObject/);
  assert.ok(policy.includes(archiveResource));
  assert.doesNotMatch(policy, /s3:\*|s3:PutObject|s3:DeleteObject|aitutor-data-851987565851\/\*/);
});

test("UAT provisioning restores the same least-privilege media permission", () => {
  assert.match(provisioner, /PolicyName: 'course-media-archive-read-only'/);
  assert.match(provisioner, /Action: 's3:GetObject'/);
  assert.ok(provisioner.includes(archiveResource));
});
