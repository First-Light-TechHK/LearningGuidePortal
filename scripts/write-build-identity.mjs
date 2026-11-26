import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function resolveBuildCommit({requested,gitHead,dirty}) {
  if (!requested) return null;
  if (!/^[a-f0-9]{40}$/.test(requested)) throw new Error('BUILD_COMMIT must be a lowercase full SHA');
  if (gitHead && (gitHead !== requested || dirty)) throw new Error('BUILD_COMMIT must match a clean checkout');
  return requested;
}
function main() {
  let gitHead = null, dirty = false;
  try { gitHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); }
  catch { /* Container builds may not contain Git metadata. */ }
  if (gitHead) dirty=Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim());
  const buildCommit=resolveBuildCommit({requested:process.env.BUILD_COMMIT || '',gitHead,dirty});
  const dist=resolve('.next');
  mkdirSync(dist,{recursive:true});
  writeFileSync(resolve(dist,'build-identity.json'),JSON.stringify({buildCommit})+'\n');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main();
