# Release Checklist

## Before Deploy

1. CI is green on main branch.
2. Uptime workflow has no active incident issue.
3. Required secrets and variables are set:
   - `RAILWAY_TOKEN`
   - `UPTIME_FAILURE_COOLDOWN_MINUTES` (optional)
   - `DATABASE_URL_BACKUP` (for backup workflow)
4. If using shared cache/state:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

## Deploy

1. Push release commit to `main`.
2. Confirm `Railway Deploy` workflow status is success.
3. Confirm services are Online in Railway architecture view.

## Post Deploy Smoke Checks

1. `GET /` on web returns 200.
2. `GET /health` on api returns 200.
3. `GET /api/intel/overview?limit=1` returns 200.
4. `GET /api/news/archive?limit=1` returns 200.

## Rollback Procedure

1. Identify last known-good commit SHA.
2. Redeploy previous image/tag in Railway, or revert commit in Git and push.
3. Re-run smoke checks.
4. Update incident issue with rollback details.