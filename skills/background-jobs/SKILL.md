---
name: background-jobs
description: Implement robust background job processing with dead letter queues, retries, and state machines. Use when building async workflows, scheduled tasks, or any work that shouldn't block the request/response cycle.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: workers
  time: 4h
  source: drift-masterguide
---

# Background Jobs

Production-ready background job processing with reliability guarantees.

## When to Use This Skill

- Processing that takes longer than a request timeout
- Scheduled/recurring tasks (reports, cleanup, sync)
- Async workflows (email, notifications, webhooks)
- Work that can fail and needs retries

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   API       │────▶│   Queue     │────▶│   Worker    │
│   Server    │     │   (Redis)   │     │   Process   │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           │              ┌────┴────┐
                           │              │ Success │
                           │              └────┬────┘
                           │                   │
                           ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐
                    │    DLQ      │     │  Complete   │
                    │ (failures)  │     │   State     │
                    └─────────────┘     └─────────────┘
```

## Job State Machine

```
┌─────────┐
│ PENDING │──────────────────────────────┐
└────┬────┘                              │
     │ picked up                         │
     ▼                                   │
┌─────────┐                              │
│ RUNNING │──────────┐                   │
└────┬────┘          │                   │
     │               │ failure           │
     │ success       ▼                   │
     │         ┌──────────┐              │
     │         │ RETRYING │──────────────┤
     │         └────┬─────┘              │
     │              │ max retries        │
     ▼              ▼                    │
┌─────────┐  ┌──────────┐         ┌──────┴──────┐
│ SUCCESS │  │  FAILED  │         │  CANCELLED  │
└─────────┘  └──────────┘         └─────────────┘
```

## TypeScript Implementation

### Job Types and Queue

```typescript
// types.ts
type JobStatus = 'pending' | 'running' | 'success' | 'failed' | 'retrying' | 'cancelled';

interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  scheduledFor: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: unknown;
}

interface JobHandler<T = unknown> {
  (payload: T, job: Job<T>): Promise<unknown>;
}
```

### Queue Implementation (Redis)

```typescript
// queue.ts
import { Redis } from 'ioredis';
import { v4 as uuid } from 'uuid';

class JobQueue {
  private redis: Redis;
  private handlers = new Map<string, JobHandler>();

  constructor(redis: Redis) {
    this.redis = redis;
  }

  register<T>(type: string, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  async enqueue<T>(
    type: string,
    payload: T,
    options: { delay?: number; maxAttempts?: number } = {}
  ): Promise<string> {
    const job: Job<T> = {
      id: uuid(),
      type,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: options.maxAttempts || 3,
      createdAt: new Date(),
      scheduledFor: new Date(Date.now() + (options.delay || 0)),
    };

    await this.redis.zadd(
      'jobs:pending',
      job.scheduledFor.getTime(),
      JSON.stringify(job)
    );

    return job.id;
  }

  async process(): Promise<void> {
    while (true) {
      const result = await this.redis.bzpopmin('jobs:pending', 1);
      if (!result) continue;

      const job: Job = JSON.parse(result[1]);
      
      if (job.scheduledFor.getTime() > Date.now()) {
        // Not ready yet, put back
        await this.redis.zadd('jobs:pending', job.scheduledFor.getTime(), JSON.stringify(job));
        continue;
      }

      await this.executeJob(job);
    }
  }

  private async executeJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      console.error(`No handler for job type: ${job.type}`);
      return;
    }

    job.status = 'running';
    job.attempts++;
    job.startedAt = new Date();

    try {
      job.result = await handler(job.payload, job);
      job.status = 'success';
      job.completedAt = new Date();
      
      await this.redis.hset('jobs:completed', job.id, JSON.stringify(job));
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);

      if (job.attempts < job.maxAttempts) {
        job.status = 'retrying';
        const backoff = Math.pow(2, job.attempts) * 1000; // Exponential backoff
        job.scheduledFor = new Date(Date.now() + backoff);
        
        await this.redis.zadd('jobs:pending', job.scheduledFor.getTime(), JSON.stringify(job));
      } else {
        job.status = 'failed';
        job.completedAt = new Date();
        
        // Move to dead letter queue
        await this.redis.lpush('jobs:dlq', JSON.stringify(job));
      }
    }
  }
}

export { JobQueue, Job, JobHandler };
```

### Job Handlers

```typescript
// handlers/email.ts
import { JobHandler } from '../queue';

interface SendEmailPayload {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
}

export const sendEmailHandler: JobHandler<SendEmailPayload> = async (payload) => {
  const { to, subject, template, data } = payload;
  
  // Render template
  const html = await renderTemplate(template, data);
  
  // Send via email provider
  await emailProvider.send({
    to,
    subject,
    html,
  });

  return { sent: true, to };
};

// handlers/webhook.ts
interface WebhookPayload {
  url: string;
  event: string;
  data: unknown;
}

export const webhookHandler: JobHandler<WebhookPayload> = async (payload, job) => {
  const response = await fetch(payload.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Event': payload.event,
      'X-Webhook-Delivery': job.id,
    },
    body: JSON.stringify(payload.data),
  });

  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status}`);
  }

  return { status: response.status };
};
```

### Worker Process

```typescript
// worker.ts
import { Redis } from 'ioredis';
import { JobQueue } from './queue';
import { sendEmailHandler } from './handlers/email';
import { webhookHandler } from './handlers/webhook';

const redis = new Redis(process.env.REDIS_URL);
const queue = new JobQueue(redis);

// Register handlers
queue.register('send-email', sendEmailHandler);
queue.register('webhook', webhookHandler);

// Graceful shutdown
let isShuttingDown = false;

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  isShuttingDown = true;
});

// Start processing
console.log('Worker started, waiting for jobs...');
queue.process();
```

## Python Implementation

```python
# queue.py
import json
import uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Dict, Optional
from redis import Redis
from dataclasses import dataclass, asdict

class JobStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    RETRYING = "retrying"

@dataclass
class Job:
    id: str
    type: str
    payload: Dict[str, Any]
    status: JobStatus
    attempts: int
    max_attempts: int
    created_at: datetime
    scheduled_for: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    result: Optional[Any] = None

class JobQueue:
    def __init__(self, redis: Redis):
        self.redis = redis
        self.handlers: Dict[str, Callable] = {}

    def register(self, job_type: str, handler: Callable) -> None:
        self.handlers[job_type] = handler

    def enqueue(
        self,
        job_type: str,
        payload: Dict[str, Any],
        delay: int = 0,
        max_attempts: int = 3,
    ) -> str:
        job = Job(
            id=str(uuid.uuid4()),
            type=job_type,
            payload=payload,
            status=JobStatus.PENDING,
            attempts=0,
            max_attempts=max_attempts,
            created_at=datetime.utcnow(),
            scheduled_for=datetime.utcnow() + timedelta(seconds=delay),
        )
        
        self.redis.zadd(
            "jobs:pending",
            {json.dumps(asdict(job), default=str): job.scheduled_for.timestamp()},
        )
        
        return job.id

    def process(self) -> None:
        while True:
            result = self.redis.bzpopmin("jobs:pending", timeout=1)
            if not result:
                continue

            job_data = json.loads(result[1])
            job = Job(**job_data)
            job.status = JobStatus(job.status)
            
            self._execute_job(job)

    def _execute_job(self, job: Job) -> None:
        handler = self.handlers.get(job.type)
        if not handler:
            return

        job.status = JobStatus.RUNNING
        job.attempts += 1
        job.started_at = datetime.utcnow()

        try:
            job.result = handler(job.payload, job)
            job.status = JobStatus.SUCCESS
            job.completed_at = datetime.utcnow()
            
            self.redis.hset("jobs:completed", job.id, json.dumps(asdict(job), default=str))
        except Exception as e:
            job.error = str(e)
            
            if job.attempts < job.max_attempts:
                job.status = JobStatus.RETRYING
                backoff = 2 ** job.attempts
                job.scheduled_for = datetime.utcnow() + timedelta(seconds=backoff)
                
                self.redis.zadd(
                    "jobs:pending",
                    {json.dumps(asdict(job), default=str): job.scheduled_for.timestamp()},
                )
            else:
                job.status = JobStatus.FAILED
                job.completed_at = datetime.utcnow()
                
                self.redis.lpush("jobs:dlq", json.dumps(asdict(job), default=str))
```

## Dead Letter Queue Management

```typescript
// dlq.ts
class DLQManager {
  constructor(private redis: Redis) {}

  async getFailedJobs(limit = 100): Promise<Job[]> {
    const jobs = await this.redis.lrange('jobs:dlq', 0, limit - 1);
    return jobs.map(j => JSON.parse(j));
  }

  async retryJob(jobId: string): Promise<boolean> {
    const jobs = await this.getFailedJobs(1000);
    const job = jobs.find(j => j.id === jobId);
    
    if (!job) return false;

    // Reset and re-enqueue
    job.status = 'pending';
    job.attempts = 0;
    job.error = undefined;
    job.scheduledFor = new Date();

    await this.redis.zadd('jobs:pending', Date.now(), JSON.stringify(job));
    await this.redis.lrem('jobs:dlq', 1, JSON.stringify(job));
    
    return true;
  }

  async purgeOldJobs(olderThanDays = 7): Promise<number> {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const jobs = await this.getFailedJobs(10000);
    
    let purged = 0;
    for (const job of jobs) {
      if (new Date(job.completedAt!).getTime() < cutoff) {
        await this.redis.lrem('jobs:dlq', 1, JSON.stringify(job));
        purged++;
      }
    }
    
    return purged;
  }
}
```

## Scheduling Recurring Jobs

```typescript
// scheduler.ts
class JobScheduler {
  private intervals: NodeJS.Timeout[] = [];

  constructor(private queue: JobQueue) {}

  schedule(
    type: string,
    payload: unknown,
    cronExpression: string
  ): void {
    // Simple interval-based scheduling
    // For production, use node-cron or similar
    const interval = this.parseCron(cronExpression);
    
    const timer = setInterval(() => {
      this.queue.enqueue(type, payload);
    }, interval);
    
    this.intervals.push(timer);
  }

  stop(): void {
    this.intervals.forEach(clearInterval);
  }

  private parseCron(expr: string): number {
    // Simplified: "*/5 * * * *" = every 5 minutes
    const match = expr.match(/^\*\/(\d+)/);
    if (match) {
      return parseInt(match[1]) * 60 * 1000;
    }
    return 60000; // Default 1 minute
  }
}

// Usage
const scheduler = new JobScheduler(queue);
scheduler.schedule('cleanup-expired-sessions', {}, '*/15 * * * *');
scheduler.schedule('send-daily-digest', {}, '0 9 * * *');
```

## Best Practices

1. **Always use exponential backoff**: Prevents thundering herd on failures
2. **Set reasonable max attempts**: 3-5 for most jobs
3. **Monitor DLQ size**: Alert when it grows
4. **Make jobs idempotent**: Same job can run multiple times safely
5. **Include job ID in logs**: Makes debugging easier

## Common Mistakes

- Not handling worker crashes (jobs stuck in running state)
- No visibility into job status
- Forgetting to handle DLQ
- Jobs that aren't idempotent
- No graceful shutdown (jobs killed mid-execution)

## Observability

```typescript
// Add metrics
const jobsProcessed = new Counter({
  name: 'jobs_processed_total',
  help: 'Total jobs processed',
  labelNames: ['type', 'status'],
});

const jobDuration = new Histogram({
  name: 'job_duration_seconds',
  help: 'Job processing duration',
  labelNames: ['type'],
});

const dlqSize = new Gauge({
  name: 'dlq_size',
  help: 'Dead letter queue size',
});
```
