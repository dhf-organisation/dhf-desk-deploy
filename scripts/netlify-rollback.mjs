#!/usr/bin/env node
// Finds the last successful production deploy BEFORE a given (broken)
// commit, and restores it as the live deploy on Netlify — used by
// post-deploy-smoke.yml when production fails its smoke test after a push
// to master, so a bad deploy self-heals instead of staying live until
// someone notices.
//
// Usage:
//   node scripts/netlify-rollback.mjs <bad-commit-sha>            # finds + restores
//   node scripts/netlify-rollback.mjs <bad-commit-sha> --dry-run  # only prints what it would do
//
// Needs NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID in the environment. Never
// guesses which deploy is "good" beyond: state=ready (built successfully),
// context=production, and not the commit we were just told is bad — it
// can't know MORE than that a deploy built without knowing whether it's
// functionally correct, same limit the smoke test itself has.
const badSha = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!badSha) {
  console.error('usage: node scripts/netlify-rollback.mjs <bad-commit-sha> [--dry-run]');
  process.exit(1);
}

const token = process.env.NETLIFY_AUTH_TOKEN;
const siteId = process.env.NETLIFY_SITE_ID;
if (!token || !siteId) {
  console.error('netlify-rollback: NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID must be set');
  process.exit(1);
}

const api = (path, opts = {}) =>
  fetch(`https://api.netlify.com/api/v1${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
  });

console.log(`Looking for the last good production deploy before ${badSha} …`);
const res = await api(`/sites/${siteId}/deploys?per_page=25`);
if (!res.ok) {
  console.error(`netlify-rollback: could not list deploys (${res.status} ${await res.text()})`);
  process.exit(1);
}
const deploys = await res.json();

const candidates = deploys
  .filter((d) => d.state === 'ready' && d.context === 'production' && d.commit_ref !== badSha)
  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

const target = candidates[0];
if (!target) {
  console.error('netlify-rollback: no eligible previous deploy found — nothing to roll back to. Manual intervention needed.');
  process.exit(1);
}

console.log(
  `Found: deploy ${target.id}, commit ${target.commit_ref?.slice(0, 7) || '(unknown)'}, ` +
  `published ${target.published_at || target.created_at}`
);

if (dryRun) {
  console.log('--dry-run: not restoring. Would POST /sites/:id/deploys/:deploy_id/restore for the deploy above.');
  process.exit(0);
}

console.log(`Restoring deploy ${target.id} as the live production deploy …`);
const restoreRes = await api(`/sites/${siteId}/deploys/${target.id}/restore`, { method: 'POST' });
if (!restoreRes.ok) {
  console.error(`netlify-rollback: restore failed (${restoreRes.status} ${await restoreRes.text()})`);
  process.exit(1);
}

console.log(`Rolled back. Production is now serving deploy ${target.id} (commit ${target.commit_ref?.slice(0, 7) || '(unknown)'}).`);
