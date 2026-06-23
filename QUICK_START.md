# SteveGuard Production Upgrade - Quick Start Guide

## 📋 Prerequisites

- **Node.js** 18+ (use `nvm` to manage versions)
- **Docker & Docker Compose** (for running Kafka, Redis, Postgres, etc.)
- **Git** for version control
- **TypeScript** knowledge (the new code is all typed)

## 🚀 Quick Start (5 minutes)

### Step 1: Install Dependencies

```bash
npm install
```

This installs:
- ✅ `kafkajs` - Kafka client
- ✅ `redis` / `ioredis` - Redis clients
- ✅ `pino` - Structured logging
- ✅ `prom-client` - Prometheus metrics
- ✅ `opossum` - Circuit breaker
- ✅ `@opentelemetry/*` - Distributed tracing
- ✅ And more...

### Step 2: Start Infrastructure (Docker Compose)

```bash
# Start all services (Postgres, Redis, Kafka, Jaeger, Prometheus, Grafana)
docker-compose up -d

# Verify all are running
docker-compose ps

# View logs
docker-compose logs -f
```

**What starts:**
- 🐘 PostgreSQL on `5432`
- 🔴 Redis on `6379`
- 🎯 Kafka on `9092`
- 📊 Prometheus on `9090`
- 📈 Grafana on `3001` (admin/admin)
- 🔍 Jaeger on `16686`
- 🖥️ Kafka UI on `8080`

### Step 3: Setup Environment

```bash
# Copy example env
cp .env.example .env.local

# For development, the defaults in .env.local should work with docker-compose
```

**Key variables to verify:**
```
DATABASE_URL=postgresql://steveguard:steveguard-dev-password@localhost:5432/steveguard
REDIS_HOST=localhost
KAFKA_BROKERS=localhost:9092
JAEGER_HOST=localhost
```

### Step 4: Setup Database

```bash
# Run Prisma migrations to create tables
npm run db:migrate

# Or deploy existing migrations
npx prisma migrate deploy
```

This creates all tables including:
- ✅ `review`
- ✅ `review_feedback`
- ✅ `review_score`
- ✅ `llm_usage`

### Step 5: Create Kafka Topics

```bash
# Docker exec into Kafka container
docker exec -it steveguard-kafka bash

# Create topics
kafka-topics.sh --create \
  --topic pr.review.requested \
  --bootstrap-server localhost:9092 \
  --partitions 3 \
  --replication-factor 1

kafka-topics.sh --create \
  --topic pr.review.completed \
  --bootstrap-server localhost:9092 \
  --partitions 3 \
  --replication-factor 1

kafka-topics.sh --create \
  --topic pr.review.failed \
  --bootstrap-server localhost:9092 \
  --partitions 3 \
  --replication-factor 1

# Exit container
exit
```

Or use Kafka UI: http://localhost:8080

### Step 6: Start the Application

**Terminal 1 - Main App:**
```bash
npm run dev
```

**Terminal 2 - Consumer Worker:**
```bash
npm run dev:consumer
```

Or start both at once:
```bash
npm run dev:all
```

**Or use Docker Compose (alternative):**
```bash
docker-compose up  # Remove -d to see logs
```

### Step 7: Test the Setup

```bash
# Check app is running
curl http://localhost:3000

# Check health endpoint
curl http://localhost:3000/api/health

# Check metrics endpoint
curl http://localhost:3000/api/metrics | head -50

# Send test event to Kafka
curl -X POST http://localhost:3000/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -d '{
    "action": "opened",
    "number": 123,
    "pull_request": {
      "title": "Test PR",
      "html_url": "https://github.com/test/test/pull/123"
    },
    "repository": {
      "name": "test",
      "owner": { "login": "testuser" }
    },
    "sender": { "id": 999, "login": "testuser", "email": "test@example.com" }
  }'
```

### Step 8: View Dashboards

Once running, access:

| Service | URL | Login |
|---------|-----|-------|
| **App** | http://localhost:3000 | - |
| **Prometheus** | http://localhost:9090 | - |
| **Grafana** | http://localhost:3001 | admin/admin |
| **Jaeger** | http://localhost:16686 | - |
| **Kafka UI** | http://localhost:8080 | - |

## 📊 Verifying Everything Works

### 1. Check Logs with Structured Logging

```bash
# Main app logs show trace IDs
npm run dev

# Should see entries like:
# {"level":"INFO","traceId":"550e8400-e29b-41d4-a716-446655440000","owner":"test","repo":"repo","prNumber":123}
```

### 2. View Metrics

Visit http://localhost:9090 and query:
```promql
steveguard_reviews_total
steveguard_review_latency_ms
steveguard_cache_hits_total
```

### 3. View Traces

Visit http://localhost:16686 and search for service "steveguard"

### 4. Check Kafka Topics

```bash
# List topics
docker exec steveguard-kafka kafka-topics.sh --list --bootstrap-server localhost:9092

# Check consumer lag
docker exec steveguard-kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group steveguard-review-processor --describe

# View messages in topic
docker exec steveguard-kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic pr.review.requested --from-beginning --max-messages 5
```

### 5. Check Redis Cache

```bash
# Connect to Redis
redis-cli -a steveguard-dev-password

# Check keys
KEYS "rag:chunks:*"
KEYS "ratelimit:*"
KEYS "repo_access:*"

# Check cache hit rate
GET "cache:hit:vector"
```

## 🔧 Common Commands

```bash
# Development
npm run dev              # Start main app
npm run dev:consumer    # Start worker
npm run dev:all         # Start both

# Docker
docker-compose up -d    # Start services
docker-compose down     # Stop services
docker-compose logs -f  # View logs

# Database
npm run db:migrate      # Create migration
npm run db:push         # Push schema
npm run db:studio       # Open Prisma Studio

# Build & Deploy
npm run build           # Build for production
npm start              # Start production server
```

## 🚨 Troubleshooting

### Issue: "Kafka broker not available"

```bash
# Check Kafka is running
docker ps | grep kafka

# Check Kafka logs
docker-compose logs kafka

# Recreate Kafka
docker-compose down
docker-compose up -d kafka zookeeper
```

### Issue: "Redis connection refused"

```bash
# Check Redis is running
docker ps | grep redis

# Check Redis password is correct
redis-cli -a steveguard-dev-password ping
# Should return: PONG
```

### Issue: "Database connection error"

```bash
# Check Postgres is running
docker ps | grep postgres

# Test connection
psql postgresql://steveguard:steveguard-dev-password@localhost:5432/steveguard

# Check migrations
npx prisma migrate status
```

### Issue: "Consumer not processing events"

```bash
# Check Kafka topics exist
docker exec steveguard-kafka kafka-topics.sh --list --bootstrap-server localhost:9092

# Check consumer group
docker exec steveguard-kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group steveguard-review-processor --describe

# View consumer logs
npm run dev:consumer  # Check terminal for errors
```

### Issue: "No traces showing in Jaeger"

```bash
# Check tracing is enabled
echo $ENABLE_TRACING  # Should be "true"

# Check Jaeger is running
curl http://localhost:16686

# Check connection in logs
npm run dev  # Look for "Tracing initialized" message
```

## 📚 Architecture Overview

```
GitHub Webhook (< 100ms)
  ↓
API Handler (rate limit + quota check)
  ↓
Kafka Producer (publish event)
  ↓
[pr.review.requested topic]
  ↓
Kafka Consumer (separate process)
  ↓
RAG Retrieval (with Redis cache)
  ↓
Gemini LLM (with circuit breaker)
  ↓
GitHub API (post comment)
  ↓
[pr.review.completed topic]
  ↓
Cost Tracking + Evaluation
```

## 🎯 What Each Layer Does

### Layer 1: Kafka (Async)
- Webhook publishes event immediately (< 100ms)
- Consumer processes asynchronously
- Decoupled from LLM latency

### Layer 2: Redis (Caching)
- RAG embeddings cached (1hr TTL)
- Rate limiting tracked
- Repo quota managed

### Layer 3: Observability
- Pino logs with trace IDs
- Prometheus metrics endpoint
- Jaeger distributed tracing
- Full request correlation

### Layer 4: Evaluation
- Review quality scoring
- LLM-as-Judge validation
- Feedback tracking
- Precision metrics

### Layer 5: Cost Tracking
- Token counting per LLM call
- Per-review cost calculation
- Monthly budget enforcement
- User tier limits

### Layer 6: Resilience
- Circuit breaker (prevent cascade failures)
- Retry with backoff
- Graceful degradation
- Bulkhead pattern (concurrency limits)

## 🚀 Next Steps

1. **Test End-to-End**
   - Send test webhook
   - Check Kafka topics for events
   - Verify logs with trace IDs
   - View metrics in Prometheus

2. **Configure GitHub Webhook**
   - GitHub Settings → Webhooks
   - Payload URL: `https://your-domain/api/webhooks/github`
   - Secret: Use your `GITHUB_WEBHOOK_SECRET`
   - Events: `Pull requests`

3. **Production Deployment**
   - Set environment variables from `.env.example`
   - Deploy to Google Cloud Run / AWS / Kubernetes
   - Configure managed services (Cloud SQL, Memorystore, Pub/Sub)
   - Set up monitoring alerts

4. **Performance Tuning**
   - Monitor Prometheus metrics
   - Adjust Kafka partitions based on throughput
   - Tune Redis eviction policy
   - Profile with Jaeger traces

## 📖 Documentation

- [Full Production Guide](./PRODUCTION_UPGRADE_GUIDE.md)
- [Kafka Documentation](https://kafka.apache.org/documentation)
- [Redis Documentation](https://redis.io/documentation)
- [Prometheus Queries](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [OpenTelemetry](https://opentelemetry.io/docs/)

## 💬 Interview Talking Points

✅ **"Sub-100ms webhook response"** — Kafka decoupling + Redis caching

✅ **"End-to-end tracing"** — Trace every review across all services with correlation IDs

✅ **"Cost-aware engineering"** — Track every token, enforce budgets by tier

✅ **"Production resilience"** — Circuit breakers, retries, graceful degradation

✅ **"Observability first"** — Structured logs, metrics, and tracing from day one

## 🎓 Learning Resources

- Kafka: Read about publish-subscribe and event-driven architecture
- Redis: Understand caching strategies and TTLs
- Prometheus: Learn about scraping, storage, and queries
- Jaeger: Explore distributed tracing concepts
- OpenTelemetry: Understand instrumentation

---

**Version:** 1.0.0  
**Last Updated:** 2024-12-22  
**Status:** Ready for Development ✅
