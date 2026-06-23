# 🛠️ New Infrastructure & Observability Tools

This document outlines the new tools and infrastructure components added to SteveGuard, detailing where they are located in the codebase and exactly how they are used.

---

## 1. Bun (JavaScript Runtime)
- **Where it is used:** `package.json` (`dev:consumer` script) and `worker.ts`.
- **How it is used:** Replaced `tsx` as the execution engine for the background Kafka consumer (`worker.ts`). 
- **Why:** Bun resolves complex CommonJS/ESM compatibility issues (specifically with `@octokit/rest`), prevents `ERR_PACKAGE_PATH_NOT_EXPORTED` crashes, and provides significantly faster startup and execution speeds for the background worker.

## 2. OpenTelemetry & Jaeger (Distributed Tracing)
- **Where it is used:** `lib/tracing.ts`, `lib/review-consumer.ts`, and `docker-compose.yml`.
- **How it is used:** 
  - `lib/tracing.ts` initializes the `@opentelemetry/sdk-node` and configures an `OTLPTraceExporter` to send traces to Jaeger on port `4318`.
  - The `traceAsync` wrapper function is used throughout the codebase to wrap critical operations (like `fetch-github-token`, `retrieve-context`, `generate-ai-review`).
  - Jaeger provides a UI (port `16686`) to visually inspect bottlenecks, track PR processing latency, and debug failed webhook requests across different microservices.

## 3. Prometheus & `prom-client` (Metrics Scraping)
- **Where it is used:** `lib/metrics.ts`, `prometheus.yml`, and `worker.ts`.
- **How it is used:**
  - `lib/metrics.ts` defines custom metrics such as `steveguard_reviews_total` (Counter), `steveguard_rag_latency_ms` (Histogram), and `steveguard_llm_tokens_used`.
  - The Next.js app exposes these metrics on `/api/metrics`.
  - `worker.ts` now spins up a dedicated lightweight HTTP server on port `3002` to expose the worker's internal metrics.
  - `prometheus.yml` is configured to scrape both `host.docker.internal:3000` (Next.js) and `host.docker.internal:3002` (Worker) every 15 seconds.

## 4. Grafana (Metrics Visualization)
- **Where it is used:** `docker-compose.yml`.
- **How it is used:** Connected directly to Prometheus as a data source. It is used to build live dashboards visualizing AI token costs, cache hit/miss ratios, Kafka consumption rates, and RAG retrieval latency over time. Accessible on port `3001`.

## 5. Apache Kafka & ZooKeeper (Message Queue)
- **Where it is used:** `lib/kafka.ts`, `app/api/webhooks/github/route.ts`, `worker.ts`, and `docker-compose.yml`.
- **How it is used:** 
  - Decouples the fast Next.js API from the slow AI processing. 
  - The webhook handler acts as a **Producer**, instantly publishing a `ReviewRequestEvent` to the `pr.review.requested` topic.
  - The `worker.ts` runs a **Consumer Group** (`steveguard-review-processor`) that subscribes to the topic and processes the AI reviews asynchronously.

## 6. Redis (Vector & Access Caching)
- **Where it is used:** `lib/redis.ts`, `lib/review-consumer.ts`, and `docker-compose.yml`.
- **How it is used:** 
  - Implements `vectorCache.getChunks(fileHash)` to intercept duplicate Pinecone RAG lookups. If the same file is modified across multiple PRs, the embedding retrieval is skipped, saving latency and API costs.
  - Redis also tracks `repo_access:{userId}` to enforce daily quota limits on user subscriptions.

## 7. Custom Load Generator (`generate-load.js`)
- **Where it is used:** `generate-load.js` (Root directory).
- **How it is used:** A custom Node.js script used for stress-testing the architecture. It fires off dozens of simulated GitHub webhooks asynchronously to test Kafka partition locks, consumer group scaling, and populates Jaeger and Prometheus with realistic traffic patterns.
