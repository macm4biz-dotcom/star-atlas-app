# Incident Response Runbook

## Trigger

- A GitHub issue with title `Uptime Alert: Railway production check failed` is opened or reopened.

## Immediate Response (first 10 minutes)

1. Open the failing workflow run from the issue comment.
2. Download artifact `uptime-response-snapshots`.
3. Verify which check failed:
   - web root
   - api `/health`
   - api `/api/intel/overview`
4. Check Railway service states in production environment:
   - web
   - @star-atlas/api
   - @star-atlas/bot
   - Postgres

## Diagnosis

1. If web fails and api passes:
   - inspect web deploy logs
   - check API base URL env in web service
2. If api health fails:
   - inspect api service logs
   - verify Postgres and external dependencies availability
   - validate recent deploy SHA
3. If intel endpoint fails but health passes:
   - investigate external source timeouts
   - verify cache behavior and fallback paths

## Mitigation

1. Roll back to previous known-good deployment when incident is user-facing.
2. If rollback is not possible, redeploy current image and re-check health.
3. If dependency outage is external, keep service operational with degraded mode and cache.

## Recovery Criteria

All checks must pass in workflow:

- web root returns 200
- api `/health` returns 200
- api `/api/intel/overview` returns 200

The workflow auto-closes the incident issue on successful recovery.

## Postmortem Checklist

1. Record root cause in the incident issue.
2. Link relevant commit(s) and deploy run(s).
3. Add one preventive action item with owner and ETA.