import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function aws(service, operation, input = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lg-release-aws-'));
  try {
    const file = path.join(dir, 'input.json');
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    return JSON.parse(execFileSync('aws', [service, operation, '--region', 'ap-southeast-1', '--output', 'json', '--cli-input-json', `file://${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }) || '{}');
  } catch {
    throw new Error(`AWS ${service}/${operation} failed; details suppressed to protect credentials`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
