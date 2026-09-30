import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error release tooling is native ESM
import { evaluateRequiredCI, requiredWorkflows } from '../../scripts/release/required-ci.mjs';

function fixture() {
  return { sha: 'a'.repeat(40), branch: 'uat', workflows: Object.fromEntries(Object.entries(requiredWorkflows).map(([file, names]) => [file, [{ id: 1, head_sha: 'a'.repeat(40), head_branch: 'uat', event: 'push', status: 'completed', conclusion: 'success', jobs: (names as string[]).map(name => ({ name, status: 'completed', conclusion: 'success' })) }]])) };
}
test('release requires every exact-revision workflow and job', () => assert.equal(evaluateRequiredCI(fixture()).ok, true));
for (const state of ['failure', 'cancelled', 'skipped', null]) {
  test(`a newer ${state} run cannot borrow an older success`, () => {
    const input = fixture();
    input.workflows['ci.yml'].push({ ...input.workflows['ci.yml'][0], id: 2, conclusion: state as string });
    assert.equal(evaluateRequiredCI(input).ok, false);
  });
}
test('missing, wrong-branch, wrong-SHA and skipped jobs fail closed', () => {
  for (const mutation of [
    (input: ReturnType<typeof fixture>) => { delete input.workflows['overlay-check.yml']; },
    (input: ReturnType<typeof fixture>) => { input.workflows['ci.yml'][0].head_branch = 'main'; },
    (input: ReturnType<typeof fixture>) => { input.workflows['ci.yml'][0].head_sha = 'b'.repeat(40); },
    (input: ReturnType<typeof fixture>) => { input.workflows['ci.yml'][0].jobs[0].conclusion = 'skipped'; }
  ]) { const input = fixture(); mutation(input); assert.equal(evaluateRequiredCI(input).ok, false); }
});
