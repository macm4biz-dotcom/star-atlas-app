# Railway Deployment Guide

## Prerequisites

- GitHub account with this repository
- Railway account (free tier: https://railway.app)
- Docker installed locally (for testing)

---

## Phase 1: Local Docker Testing

Before deploying to Railway, test Docker builds locally:

### 1.1 Build Docker images
```bash
cd /Users/biz/star-atlas-app

# Build Web app
docker build -f apps/web/Dockerfile -t star-atlas-web:latest .

# Build API app
docker build -f apps/api/Dockerfile -t star-atlas-api:latest .

# Build Bot app
docker build -f apps/bot/Dockerfile -t star-atlas-bot:latest .
```

### 1.2 Test with Docker Compose
```bash
# Start all services locally
docker-compose -f infra/docker-compose.yml up

# Check health
curl http://localhost/health
curl http://localhost:4100/health
```

### 1.3 Verify logs
```bash
docker-compose -f infra/docker-compose.yml logs -f api
docker-compose -f infra/docker-compose.yml logs -f web
```

---

## Phase 2: Railway Project Setup

### 2.1 Create Railway Account & Project

1. Go to https://railway.app
2. Sign in with GitHub
3. Create new project
4. Name: `star-atlas-app`

### 2.2 Add Services

In Railway dashboard, add these services:

#### Service 1: PostgreSQL Database
```
Name: postgres
Type: PostgreSQL
Tier: Free (shared) or Hobby (recommended)
```

**Configure:**
- Username: `postgres`
- Password: (Railway generates)
- Store these credentials for .env

#### Service 2: Redis Cache
```
Name: redis
Type: Redis
Tier: Free (shared) or Hobby
```

**Configure:**
- Use default settings
- Store connection string for .env

#### Service 3: Web App
```
Name: web
Type: GitHub Repository
```

**Configure:**
- Build: Dockerfile (`apps/web/Dockerfile`)
- Port: 80 (exposed by Nginx)
- Memory: 256MB (minimum)
- Restart: Always

#### Service 4: API App
```
Name: api
Type: GitHub Repository
```

**Configure:**
- Build: Dockerfile (`apps/api/Dockerfile`)
- Port: 4100 (internal), Railway assigns public port
- Memory: 512MB (recommended)
- Restart: Always
- Health check: `/health`

#### Service 5: Bot App
```
Name: bot
Type: GitHub Repository
```

**Configure:**
- Build: Dockerfile (`apps/bot/Dockerfile`)
- No port exposed (background service)
- Memory: 256MB
- Restart: Always

---

## Phase 3: Environment Variables

### 3.1 Create .env file for Railway

Create `railway.env` with these variables:

```env
# Database
DATABASE_URL=postgresql://user:pass@postgres-service-url:5432/star-atlas
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<from Railway>
POSTGRES_DB=star-atlas

# Redis
REDIS_URL=redis://default:pass@redis-service-url:6379

# API Configuration
PORT=4100
HOST=0.0.0.0
API_LOG_LEVEL=info

# Solana RPC (public endpoint)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# CORS
CORS_ORIGIN=https://your-domain.com

# Bot Configuration (Discord/Telegram tokens)
DISCORD_BOT_TOKEN=<your-token>
TELEGRAM_BOT_TOKEN=<your-token>
TELEGRAM_CHAT_ID=<your-chat-id>
```

### 3.2 Set variables in Railway Dashboard

For each service:

1. Go to service → Variables
2. Add all relevant variables from above
3. For Database and Redis, Railway provides connection URLs automatically

**Example for API service:**
```
PORT=4100
HOST=0.0.0.0
DATABASE_URL=${{postgres.DATABASE_URL}}
REDIS_URL=${{redis.DATABASE_URL}}
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

---

## Phase 4: GitHub Actions Integration

### 4.1 Add Railway Token to GitHub Secrets

1. In Railway → Settings → Tokens
2. Create new token named `RAILWAY_PRODUCTION`
3. Copy the token

4. In GitHub → Settings → Secrets and variables → Actions
5. Add secret: `RAILWAY_TOKEN` = `<your-railway-token>`

### 4.2 Connect Repository

1. In Railway dashboard → select `web` service
2. Click "Connect Repository"
3. Select this GitHub repository
4. Set build settings:
   - Dockerfile: `apps/web/Dockerfile`
   - Service: `web`

Repeat for `api` and `bot` services.

### 4.3 Verify CI/CD Pipeline

1. In GitHub → Actions
2. Check that `railway-deploy.yml` workflow appears
3. On next push to `main`, workflow should trigger automatically

---

## Phase 5: Networking & Domains

### 5.1 Get Railway Public URLs

After deployment:

1. In Railway → Web service → Deployments
2. Get public URL (e.g., `https://star-atlas-web-prod.up.railway.app`)
3. Note API public URL separately

### 5.2 Connect Custom Domain (Optional)

1. Buy domain: Namecheap / Reg.ru (~$10/year)

2. In Railway → Web service → Settings → Domains
   - Add custom domain
   - Get CNAME record
   - Point domain DNS CNAME to Railway URL

3. Example (Namecheap):
   ```
   CNAME: www → star-atlas-web-prod.up.railway.app
   A: @ → Railway IP (if provided)
   ```

4. SSL/HTTPS automatically via Let's Encrypt

### 5.3 Update Environment Variables

Update `.env` with actual URLs:

```env
WEB_URL=https://your-domain.com
API_URL=https://api.your-domain.com
CORS_ORIGIN=https://your-domain.com
```

Redeploy after changes.

---

## Phase 6: Monitoring & Operations

### 6.1 Health Checks

Railway automatically monitors services via health checks defined in Dockerfiles:

- **API**: `/health` endpoint (defined in Dockerfile)
- **Web**: Nginx returns 200 on `/health`
- **Bot**: Restart policy (no health check needed)

Check status in Railway dashboard → Deployments.

### 6.2 Logs

View logs in Railway dashboard:

```
Web service → Logs → last 100 lines
API service → Logs → filter by timestamp
Bot service → Logs → recent errors
```

Or via CLI:
```bash
railway logs -s api
railway logs -s web --follow
```

### 6.3 Database Backups

Railway provides automatic backups for PostgreSQL:

1. In Railway → PostgreSQL service → Backups
2. Configure backup frequency (daily/weekly)
3. Manual backup: Backups → Snapshot
4. Export backups to AWS S3 (optional):
   ```
   railway db backup export s3://my-bucket/backups
   ```

### 6.4 Scaling

To scale services:

1. Railway → Service → Scale
2. Adjust CPU/Memory
3. Example: API from 512MB → 1GB for more load

---

## Phase 7: Troubleshooting

### Issue: Deployment Failed

**Check:**
1. Railway → Deployments → click failed deployment
2. View build logs
3. Check for:
   - Build timeout (>15 minutes) → optimize Dockerfile
   - Missing environment variables
   - Docker build error → test locally first

### Issue: Health Check Failing

**Check:**
1. Is service port correct?
2. Is `/health` endpoint responding?
   ```bash
   curl https://api.your-domain.com/health
   ```
3. Check logs for startup errors

### Issue: API Can't Connect to Database

**Check:**
1. `DATABASE_URL` is correct
2. Service can reach postgres:
   ```bash
   railway logs -s api | grep "connect"
   ```
3. Database credentials match

### Issue: High Memory Usage

**Check:**
1. Railway → Metrics → Memory
2. Identify service with spike
3. Scale up or optimize code
4. Example: `npm --production ci` in Dockerfile to reduce node_modules

---

## Phase 8: Maintenance Schedule

| Task | Frequency | Notes |
|------|-----------|-------|
| Monitor uptime | Daily | Check Railway dashboard |
| Review logs | Daily | Alert on errors |
| Database backups | Auto daily | Configure in Railway |
| Update dependencies | Weekly | Run `npm audit` |
| Load testing | Monthly | Test before scaling |
| Cost review | Monthly | Keep under $40/month |
| Full backup export | Weekly | To S3 or local |

---

## Cost Estimate

| Service | Tier | Price/Month |
|---------|------|------------|
| Web App | Hobby | $5-10 |
| API App | Hobby | $5-10 |
| Bot App | Free | $0 |
| PostgreSQL | Hobby | $12 |
| Redis | Free | $0 |
| **Total** | | **$20-30** |

---

## Quick Commands

```bash
# Test local Docker build
docker build -f apps/web/Dockerfile -t star-atlas-web .

# Check Docker image size
docker images | grep star-atlas

# Test container locally
docker run -p 3000:80 star-atlas-web

# Push code to trigger Railway deploy
git push origin main

# Check Railway logs
railway logs -s api --tail 100

# SSH into Railway container (if needed)
railway shell -s api
```

---

## Next Steps

1. ✅ Test Docker builds locally (Phase 1)
2. ✅ Create Railway project and services (Phase 2)
3. ✅ Set environment variables (Phase 3)
4. ✅ Connect GitHub Actions (Phase 4)
5. ✅ Configure custom domain (Phase 5)
6. ⏳ Monitor after first deployment (Phase 6)
7. ⏳ Maintain and optimize (Phase 8)

**Ready to deploy?** → Push code to `main` branch and Railway will auto-deploy!

---

## Support

- Railway Docs: https://docs.railway.app
- Railway Community: https://community.railway.app
- GitHub Actions: https://docs.github.com/en/actions
