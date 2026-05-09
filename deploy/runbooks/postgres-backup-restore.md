# PostgreSQL Backup and Restore

## Automated Backups

- Workflow: `.github/workflows/postgres-backup.yml`
- Schedule: daily at 02:25 UTC
- Trigger: schedule or manual `workflow_dispatch`

Requirements:

1. Repository secret `DATABASE_URL_BACKUP` must be configured.
2. Optional repository variable `BACKUP_RETENTION_DAYS` (default: 7).

Artifacts:

- Backup format: `pg_dump --format=custom`
- Artifact name pattern: `postgres-backup-<run_id>`

## Manual Backup (local)

```bash
pg_dump --no-owner --no-privileges --format=custom --file postgres-manual.dump "$DATABASE_URL"
```

## Restore

Warning: restore can overwrite existing data. Restore only to an isolated or approved target database.

```bash
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$TARGET_DATABASE_URL" postgres-manual.dump
```

## Validation After Restore

1. Run api health check.
2. Verify critical tables exist and contain expected row counts.
3. Run application smoke checks for api and web.