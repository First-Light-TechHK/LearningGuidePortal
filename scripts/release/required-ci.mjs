import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const requiredWorkflows = {
  'ci.yml': ['Typecheck', 'Lint', 'Build and test'],
  'forge-check.yml': ['forge-check'],
  'overlay-check.yml': ['overlay-check']
};

export function evaluateRequiredCI({ sha, branch, workflows }) {
  const failures = [];
  const evidence = [];
  for (const [workflow, requiredJobs] of Object.entries(requiredWorkflows)) {
    // A newer failed, cancelled or pending run must supersede an older green run.
    const run = (workflows[workflow] || [])
      .filter(item => item.head_sha === sha && item.head_branch === branch && item.event === 'push')
      .sort((a, b) => b.id - a.id || (b.run_attempt || 1) - (a.run_attempt || 1))[0];
    if (!run) { failures.push(`${workflow}: missing push run for ${branch}@${sha}`); continue; }
    evidence.push({ workflow, id: run.id, attempt: run.run_attempt, conclusion: run.conclusion, url: run.html_url });
    if (run.status !== 'completed' || run.conclusion !== 'success') failures.push(`${workflow}: ${run.status}/${run.conclusion}`);
    for (const name of requiredJobs) {
      const job = run.jobs?.find(item => item.name === name);
      if (job?.status !== 'completed' || job.conclusion !== 'success') failures.push(`${workflow}/${name}: ${job?.conclusion || 'missing or pending'}`);
    }
  }
  return { ok: failures.length === 0, failures, evidence };
}

export function checkRequiredCI({ sha, branch, repo = 'First-Light-TechHK/LearningGuidePortal' }) {
  const gh = endpoint => JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  if (!/^[a-f0-9]{40}$/.test(sha) || !branch) throw new Error('Exact release SHA and branch are required');
  if (gh(`repos/${repo}/commits/${encodeURIComponent(branch)}`).sha !== sha) throw new Error('Release branch moved; re-test the new revision');
  const workflows = {};
  for (const workflow of Object.keys(requiredWorkflows)) {
    const runs = gh(`repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`).workflow_runs;
    const matching = runs.filter(run => run.head_sha === sha && run.head_branch === branch && run.event === 'push').sort((a, b) => b.id - a.id);
    const latest = matching[0];
    if (latest) latest.jobs = gh(`repos/${repo}/actions/runs/${latest.id}/attempts/${latest.run_attempt || 1}/jobs?per_page=100`).jobs;
    workflows[workflow] = matching;
  }
  const result = evaluateRequiredCI({ sha, branch, workflows });
  if (!result.ok) throw new Error(`Release blocked: ${result.failures.join('; ')}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(checkRequiredCI({ sha: process.env.RELEASE_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), branch: process.env.RELEASE_BRANCH || process.env.GITHUB_REF_NAME || execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim() })));
}
