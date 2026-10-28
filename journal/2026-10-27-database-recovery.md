# Database recovery and modern-secret rotation — 2026-10-27 CT

Resumed original personal Russell free-tier Supabase project `fkaawrrlhxcmzhhvgdmf` through its official paused-project restore endpoint. It became ACTIVE_HEALTHY and the organization stayed free; no purchase, plan change, recreation, migration, schema or row mutation.

Replaced exposed modern secret UUID `792f84ba-1c1f-47ae-9903-833bbec7af77` with `council_server`, UUID `9b146b36-70f9-42cf-9d47-3ae81e4acb8b`. Canonical BWS AI Keys name: `SUPABASE_SECRET_KEY_AICOUNCIL`, record `06b3be08-bd55-44c2-b4c5-b4f100228101`. Updated Railway AI Council, older qualifier, Trigger authenticated prod, and both local environment files. Every unrelated provider key and consumer variable unchanged. Dev/staging URLs with a production-scoped Trigger key are not separate environment evidence.

AI Council sole-active SUCCESS deployment `6a152133-6894-4376-a507-9af3e4ad4c17` runs unchanged commit `15e32c877d89029ea62ca9f3385a153d032b5b1e`. No local code pushed: checkout contains unrelated newer commits and dirty files. Current/next/active-snapshot variables match the replacement. Old key revoked and absent, old/invalid keys return 401, new returns 200 on Auth Admin and zero-row sessions/rounds queries.

After revocation, production `GET /council?limit=1` returned HTTP 200 with total 40 existing sessions; detail for `278320a6-55e6-47a2-a2ad-05279e2655e9` returned HTTP 200 with 10 historical rounds. Historical data is reachable. No new debate or paid model run tested; the separate Anthropic billing block is not fixed by database recovery. No Discord post.

Authoritative receipts: `../Home Base/artifacts/railway-security-review-20261027/AICOUNCIL-RECOVERY-STATUS.md` and `council-db-rotation.json` beside it. Encrypted recovery files are in that evidence directory. Never restore the revoked key during rollback; fix forward or revert code with the new credential.
