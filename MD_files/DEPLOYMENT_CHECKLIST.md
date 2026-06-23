# SteveGuard Production Upgrade - Deployment Checklist

## Pre-Deployment (Before Going Live)

### ✅ Dependencies & Environment
- [ ] Run `npm install` to install all 12+ new dependencies
- [ ] Copy `.env.example` to `.env.local` for development
- [ ] Copy `.env.example` to `.env.production` for production
- [ ] All required env vars are set (see `.env.example`)
- [ ] Database URL points to correct PostgreSQL instance
- [ ] Kafka brokers are accessible
- [ ] Redis is accessible

### ✅ Database & Schema
- [ ] PostgreSQL database created
- [ ] Run `prisma migrate deploy` to create tables
- [ ] Verify tables exist: `user`, `review`, `review_feedback`, `review_score`, `llm_usage`
- [ ] Database backups configured
- [ ] Connection pooling configured (for scaling)

### ✅ Infrastructure Services
- [ ] PostgreSQL running and accessible
- [ ] Redis running and accessible
- [ ] Kafka running with 3+ brokers (for HA)
- [ ] Zookeeper running (for Kafka)
- [ ] Jaeger running (for tracing)
- [ ] Prometheus running (for metrics)
- [ ] Grafana running (for dashboards)

### ✅ Kafka Topics
- [ ] Topic `pr.review.requested` created (3 partitions)
- [ ] Topic `pr.review.completed` created (3 partitions)
- [ ] Topic `pr.review.failed` created (3 partitions)
- [ ] Consumer group `steveguard-review-processor` exists
- [ ] Topic retention configured appropriately

### ✅ Application Code
- [ ] All new library files created:
  - [ ] `lib/kafka.ts`
  - [ ] `lib/redis.ts`
  - [ ] `lib/logger.ts`
  - [ ] `lib/metrics.ts`
  - [ ] `lib/tracing.ts`
  - [ ] `lib/evaluation.ts`
  - [ ] `lib/cost-tracker.ts`
  - [ ] `lib/resilience.ts`
  - [ ] `lib/review-consumer.ts`
- [ ] Webhook handler updated (`app/api/webhooks/github/route.ts`)
- [ ] Metrics endpoint created (`app/api/metrics/route.ts`)
- [ ] Health check endpoint created (`app/api/health/route.ts`)
- [ ] Worker process created (`worker.ts`)
- [ ] Build passes without errors: `npm run build`

### ✅ GitHub Integration
- [ ] GitHub App created
- [ ] GitHub App ID set in env vars
- [ ] GitHub App Private Key set in env vars
- [ ] GitHub Webhook Secret set in env vars
- [ ] OAuth credentials (Client ID/Secret) configured
- [ ] Webhook permissions configured (Pull Requests)

### ✅ Third-Party APIs
- [ ] Gemini API key obtained and working
- [ ] Pinecone API key obtained and working
- [ ] Polar (payment) API key configured
- [ ] API rate limits understood and accounted for

### ✅ Configuration Files
- [ ] `docker-compose.yml` exists and validated
- [ ] `prometheus.yml` exists and configured
- [ ] `grafana-datasources.yml` exists
- [ ] `.env.example` documents all variables
- [ ] `.env.production` has production values

### ✅ Documentation
- [ ] `QUICK_START.md` reviewed
- [ ] `PRODUCTION_UPGRADE_GUIDE.md` reviewed
- [ ] `IMPLEMENTATION_SUMMARY.md` reviewed
- [ ] Team trained on new architecture

---

## Development Workflow

### First Time Setup
```bash
# 1. Install dependencies
npm install

# 2. Start infrastructure
docker-compose up -d

# 3. Wait for services to be healthy
docker-compose ps
docker-compose logs

# 4. Create Kafka topics
docker exec steveguard-kafka bash
kafka-topics.sh --create --topic pr.review.requested --bootstrap-server localhost:9092 --partitions 3 --replication-factor 1
exit

# 5. Setup database
npm run db:migrate

# 6. Start development servers
npm run dev         # Terminal 1 - Main app
npm run dev:consumer # Terminal 2 - Consumer worker
```

### Daily Development
```bash
# Start services
docker-compose up -d

# Start app and consumer
npm run dev:all

# Or individually
npm run dev         # App on :3000
npm run dev:consumer # Consumer worker
```

### Testing
```bash
# Send test webhook
curl -X POST http://localhost:3000/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -d '{...}'

# Check metrics
curl http://localhost:3000/api/metrics

# Monitor consumer
npm run dev:consumer  # Check terminal output

# View Jaeger traces
open http://localhost:16686

# View Prometheus metrics
open http://localhost:9090

# View Grafana
open http://localhost:3001
```

---

## Staging Deployment

### Before Deploying to Staging
- [ ] All development tests pass
- [ ] Code reviewed
- [ ] Database migrations tested on staging db
- [ ] Environment variables exported correctly

### Staging Environment Setup
```bash
# 1. Deploy to staging cloud platform
gcloud run deploy steveguard-staging \
  --source . \
  --platform managed \
  --region us-central1

# 2. Deploy consumer worker
gcloud run deploy steveguard-consumer-staging \
  --source . \
  --platform managed \
  --region us-central1

# 3. Configure environment
gcloud run services update steveguard-staging \
  --set-env-vars DATABASE_URL=$DATABASE_URL,...

# 4. Configure managed services
# - Cloud SQL for PostgreSQL
# - Memorystore for Redis
# - Cloud Pub/Sub for Kafka alternative
```

### Staging Testing
- [ ] Deploy application
- [ ] Run database migrations
- [ ] Configure GitHub webhook (staging URL)
- [ ] Send test PR to GitHub
- [ ] Verify webhook received
- [ ] Verify consumer processed event
- [ ] Check Prometheus metrics
- [ ] Check Jaeger traces
- [ ] Check Grafana dashboards
- [ ] Monitor for 24 hours
- [ ] Test failover scenarios

---

## Production Deployment

### Production Environment Setup (Google Cloud)

#### 1. Cloud SQL (PostgreSQL)
```bash
gcloud sql instances create steveguard-prod-db \
  --database-version POSTGRES_15 \
  --tier db-g1-small \
  --region us-central1 \
  --backup-start-time 03:00 \
  --enable-bin-log \
  --retained-backups-count 30
```

#### 2. Cloud Memorystore (Redis)
```bash
gcloud redis instances create steveguard-prod-cache \
  --size 5 \
  --region us-central1 \
  --redis-version 7.0 \
  --enable-auth
```

#### 3. Cloud Pub/Sub (Replace Kafka)
```bash
gcloud pubsub topics create pr-review-requested
gcloud pubsub topics create pr-review-completed
gcloud pubsub topics create pr-review-failed
gcloud pubsub subscriptions create pr-review-processor \
  --topic pr-review-requested
```

#### 4. Cloud Run (Main App)
```bash
gcloud run deploy steveguard-app \
  --source . \
  --platform managed \
  --region us-central1 \
  --max-instances 50 \
  --set-env-vars NODE_ENV=production,DATABASE_URL=$DB_URL,... \
  --allow-unauthenticated
```

#### 5. Cloud Run (Consumer)
```bash
gcloud run deploy steveguard-consumer \
  --source . \
  --platform managed \
  --region us-central1 \
  --max-instances 100 \
  --command tsx,worker.ts \
  --set-env-vars NODE_ENV=production,...
```

#### 6. Cloud Monitoring & Logging
```bash
# Prometheus remote write
gcloud monitoring prometheus-managed-service create

# CloudTrace setup (automatic with OpenTelemetry)

# Cloud Logging (automatic)
```

### Pre-Production Checklist
- [ ] All staging tests pass
- [ ] Load testing completed (100+ reviews/min)
- [ ] Failover testing completed
- [ ] Cost estimates reviewed
- [ ] Incident response plan documented
- [ ] On-call rotation established
- [ ] Runbooks created
- [ ] Team trained on new system

### Production Deployment Steps
1. [ ] Enable feature flag for Kafka (ENV: `ENABLE_KAFKA=true`)
2. [ ] Deploy main app to production
3. [ ] Monitor for 1 hour (webhook latency, errors)
4. [ ] Deploy consumer worker
5. [ ] Monitor for 24 hours (success rates, costs)
6. [ ] Gradually increase traffic (canary deployment)
7. [ ] Monitor metrics dashboard
8. [ ] Set up alerts

### Post-Deployment
- [ ] Monitor metrics for 48 hours
- [ ] Review error logs
- [ ] Verify cost tracking working
- [ ] Confirm cache hit rates > 30%
- [ ] Check webhook latency < 100ms
- [ ] Verify consumer processing queue depth
- [ ] Test incident response procedures

---

## Monitoring & Alerting

### Key Metrics to Monitor
```promql
# Webhook latency
histogram_quantile(0.95, rate(steveguard_review_latency_ms[5m]))

# Error rate
rate(steveguard_errors_total[5m])

# Queue depth (Kafka consumer lag)
steveguard_kafka_consumer_lag

# Cost tracking
rate(steveguard_cost_daily_usd[1d])

# Cache hit ratio
rate(steveguard_cache_hits_total[5m]) / (rate(steveguard_cache_hits_total[5m]) + rate(steveguard_cache_misses_total[5m]))
```

### Alert Rules to Configure
- [ ] Webhook latency > 500ms for 5min
- [ ] Error rate > 5% for 5min
- [ ] Consumer lag > 1000 messages for 10min
- [ ] Daily cost > $500 for this month
- [ ] Cache hit ratio < 20% for 30min
- [ ] Database connection errors for 1min

### Grafana Dashboards to Import
- [ ] Overview (main metrics)
- [ ] Performance (latency, throughput)
- [ ] Errors (error types, rates)
- [ ] Cost (daily, per-user, per-tier)
- [ ] Quality (review scores, false positives)
- [ ] Infrastructure (Redis, Kafka, DB)

---

## Troubleshooting Guide

### Issue: Webhook Timeout
**Symptoms:** GitHub shows webhook failed
**Fix:** Check webhook handler isn't doing heavy work (it should just Kafka publish)
```
# Should be < 100ms
curl -w "@curl-format.txt" http://localhost:3000/api/webhooks/github
```

### Issue: Consumer Not Processing
**Symptoms:** Messages pile up in Kafka topic
**Fix:** Check consumer logs and Kafka consumer group
```
docker-compose logs consumer
kafka-consumer-groups.sh --describe --group steveguard-review-processor
```

### Issue: High Memory Usage
**Symptoms:** App or consumer crashing due to memory
**Fix:** Check for cache memory leaks, increase Redis TTL
```
docker stats
redis-cli INFO memory
```

### Issue: Cost Spike
**Symptoms:** Daily cost suddenly high
**Fix:** Check LLM usage, review tokens consumed
```
SELECT * FROM llm_usage ORDER BY created_at DESC LIMIT 100;
SELECT SUM(estimated_cost_usd) FROM llm_usage WHERE DATE(created_at) = TODAY();
```

---

## Rollback Plan

If deployment causes issues:

### 1. Immediate Rollback (< 5 minutes)
```bash
# Disable Kafka processing
export ENABLE_KAFKA=false

# Revert to old webhook handler code
git revert <commit>

# Redeploy
gcloud run deploy steveguard-app --source .
```

### 2. Database Rollback
```bash
# If migrations caused issues
prisma migrate resolve --rolled-back <migration-name>
git revert <commit>
```

### 3. Monitoring Rollback
```bash
# Stop sending metrics if Prometheus overwhelmed
export ENABLE_METRICS=false

# Stop sending traces if Jaeger overwhelmed
export ENABLE_TRACING=false
```

---

## Performance Optimization

### After Deployment (Week 1)

Optimize based on metrics:

```promql
# Find slow endpoints
histogram_quantile(0.95, rate(steveguard_review_latency_ms[1h]))

# Find expensive LLM calls
SELECT * FROM llm_usage ORDER BY estimated_cost_usd DESC LIMIT 10

# Find cache issues
rate(steveguard_cache_misses_total{cache_type="vector"}[1h])
```

### Optimization Checklist
- [ ] Adjust Kafka partition count based on throughput
- [ ] Tune Redis eviction policy if memory high
- [ ] Increase consumer instances if queue backing up
- [ ] Reduce LLM max tokens if costs high
- [ ] Improve RAG chunking if precision low

---

## Success Criteria

### Week 1
- [ ] Webhook latency < 100ms consistently
- [ ] Consumer processing 100+ reviews/hour
- [ ] Zero data loss
- [ ] Error rate < 2%

### Month 1
- [ ] Cache hit ratio > 40%
- [ ] Review quality score > 7.0/10
- [ ] User acceptance rate > 60%
- [ ] Cost per review $0.04-0.06

### Quarter 1
- [ ] System 99%+ available
- [ ] All metrics trending positively
- [ ] Team comfortable with operations
- [ ] Cost optimization complete

---

**Status:** Ready for Deployment ✅  
**Version:** 1.0.0  
**Last Updated:** 2024-12-22
