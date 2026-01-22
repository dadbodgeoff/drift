---
name: webhook-security
description: Implement secure webhook handling with signature verification, replay protection, and idempotency. Use when receiving webhooks from third-party services like Stripe, GitHub, Twilio, or building your own webhook system.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: integrations
  time: 4h
  source: drift-masterguide
---

# Webhook Security

Production-ready webhook handling with defense in depth.

## When to Use This Skill

- Receiving webhooks from payment providers (Stripe, PayPal)
- Integrating with GitHub, GitLab, or other dev tools
- Building your own webhook delivery system
- Any endpoint receiving external POST requests

## Security Layers

```
┌─────────────────────────────────────────────────────┐
│                    Incoming Webhook                  │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  1. Signature Verification (HMAC-SHA256)            │
│     - Reject if signature invalid                   │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  2. Timestamp Validation                            │
│     - Reject if older than 5 minutes                │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  3. Idempotency Check                               │
│     - Skip if already processed                     │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  4. Process Webhook                                 │
│     - Handle business logic                         │
└─────────────────────────────────────────────────────┘
```

## TypeScript Implementation

### Signature Verification

```typescript
// webhook-verifier.ts
import crypto from 'crypto';

interface WebhookConfig {
  secret: string;
  signatureHeader: string;
  timestampHeader?: string;
  tolerance?: number; // seconds
}

interface VerificationResult {
  valid: boolean;
  error?: string;
}

class WebhookVerifier {
  constructor(private config: WebhookConfig) {}

  verify(payload: string | Buffer, headers: Record<string, string>): VerificationResult {
    const signature = headers[this.config.signatureHeader.toLowerCase()];
    
    if (!signature) {
      return { valid: false, error: 'Missing signature header' };
    }

    // Check timestamp if configured
    if (this.config.timestampHeader) {
      const timestamp = headers[this.config.timestampHeader.toLowerCase()];
      if (!timestamp) {
        return { valid: false, error: 'Missing timestamp header' };
      }

      const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
      const tolerance = this.config.tolerance || 300; // 5 minutes default

      if (Math.abs(timestampAge) > tolerance) {
        return { valid: false, error: 'Timestamp outside tolerance window' };
      }
    }

    // Compute expected signature
    const expectedSignature = this.computeSignature(payload, headers);
    
    // Constant-time comparison to prevent timing attacks
    const valid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    return { valid, error: valid ? undefined : 'Invalid signature' };
  }

  private computeSignature(payload: string | Buffer, headers: Record<string, string>): string {
    const timestamp = this.config.timestampHeader 
      ? headers[this.config.timestampHeader.toLowerCase()] 
      : '';
    
    const signedPayload = timestamp ? `${timestamp}.${payload}` : payload.toString();
    
    return 'sha256=' + crypto
      .createHmac('sha256', this.config.secret)
      .update(signedPayload)
      .digest('hex');
  }
}

export { WebhookVerifier, WebhookConfig, VerificationResult };
```

### Provider-Specific Verifiers

```typescript
// providers/stripe.ts
import Stripe from 'stripe';

export function verifyStripeWebhook(
  payload: string | Buffer,
  signature: string,
  secret: string
): Stripe.Event {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  
  // Stripe's library handles verification
  return stripe.webhooks.constructEvent(payload, signature, secret);
}

// providers/github.ts
import crypto from 'crypto';

export function verifyGitHubWebhook(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// providers/twilio.ts
import crypto from 'crypto';

export function verifyTwilioWebhook(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string
): boolean {
  // Twilio uses URL + sorted params
  const data = url + Object.keys(params)
    .sort()
    .map(key => key + params[key])
    .join('');
  
  const expected = crypto
    .createHmac('sha1', authToken)
    .update(data)
    .digest('base64');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### Idempotency Handler

```typescript
// idempotency.ts
import { Redis } from 'ioredis';

interface IdempotencyConfig {
  redis: Redis;
  keyPrefix?: string;
  ttlSeconds?: number;
}

class IdempotencyHandler {
  private redis: Redis;
  private keyPrefix: string;
  private ttl: number;

  constructor(config: IdempotencyConfig) {
    this.redis = config.redis;
    this.keyPrefix = config.keyPrefix || 'webhook:processed:';
    this.ttl = config.ttlSeconds || 86400; // 24 hours
  }

  async isProcessed(eventId: string): Promise<boolean> {
    const key = this.keyPrefix + eventId;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  async markProcessed(eventId: string, result?: unknown): Promise<void> {
    const key = this.keyPrefix + eventId;
    const value = JSON.stringify({
      processedAt: new Date().toISOString(),
      result,
    });
    await this.redis.setex(key, this.ttl, value);
  }

  async getProcessedResult(eventId: string): Promise<unknown | null> {
    const key = this.keyPrefix + eventId;
    const value = await this.redis.get(key);
    if (!value) return null;
    return JSON.parse(value);
  }
}

export { IdempotencyHandler, IdempotencyConfig };
```

### Complete Webhook Handler

```typescript
// webhook-handler.ts
import { Request, Response, NextFunction } from 'express';
import { WebhookVerifier } from './webhook-verifier';
import { IdempotencyHandler } from './idempotency';

interface WebhookHandlerConfig {
  verifier: WebhookVerifier;
  idempotency: IdempotencyHandler;
  eventIdExtractor: (payload: unknown) => string;
}

function createWebhookHandler(config: WebhookHandlerConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Get raw body (must use raw body parser)
    const rawBody = req.body;
    
    // 1. Verify signature
    const verification = config.verifier.verify(
      rawBody,
      req.headers as Record<string, string>
    );
    
    if (!verification.valid) {
      console.error('Webhook verification failed:', verification.error);
      return res.status(401).json({ error: verification.error });
    }

    // Parse payload
    const payload = JSON.parse(rawBody.toString());
    
    // 2. Check idempotency
    const eventId = config.eventIdExtractor(payload);
    
    if (await config.idempotency.isProcessed(eventId)) {
      console.log(`Webhook ${eventId} already processed, skipping`);
      return res.status(200).json({ status: 'already_processed' });
    }

    // 3. Attach parsed payload and continue
    req.body = payload;
    (req as any).webhookEventId = eventId;
    
    // 4. After processing, mark as processed
    res.on('finish', async () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        await config.idempotency.markProcessed(eventId);
      }
    });

    next();
  };
}

export { createWebhookHandler };
```

## Python Implementation

```python
# webhook_security.py
import hmac
import hashlib
import time
from typing import Optional, Dict, Any
from dataclasses import dataclass
import redis

@dataclass
class VerificationResult:
    valid: bool
    error: Optional[str] = None

class WebhookVerifier:
    def __init__(
        self,
        secret: str,
        signature_header: str,
        timestamp_header: Optional[str] = None,
        tolerance: int = 300,
    ):
        self.secret = secret
        self.signature_header = signature_header.lower()
        self.timestamp_header = timestamp_header.lower() if timestamp_header else None
        self.tolerance = tolerance

    def verify(self, payload: bytes, headers: Dict[str, str]) -> VerificationResult:
        # Normalize headers to lowercase
        headers = {k.lower(): v for k, v in headers.items()}
        
        signature = headers.get(self.signature_header)
        if not signature:
            return VerificationResult(False, "Missing signature header")

        # Check timestamp
        if self.timestamp_header:
            timestamp = headers.get(self.timestamp_header)
            if not timestamp:
                return VerificationResult(False, "Missing timestamp header")
            
            timestamp_age = abs(int(time.time()) - int(timestamp))
            if timestamp_age > self.tolerance:
                return VerificationResult(False, "Timestamp outside tolerance")

        # Compute expected signature
        expected = self._compute_signature(payload, headers)
        
        # Constant-time comparison
        valid = hmac.compare_digest(signature, expected)
        
        return VerificationResult(valid, None if valid else "Invalid signature")

    def _compute_signature(self, payload: bytes, headers: Dict[str, str]) -> str:
        timestamp = headers.get(self.timestamp_header, "") if self.timestamp_header else ""
        signed_payload = f"{timestamp}.{payload.decode()}" if timestamp else payload
        
        if isinstance(signed_payload, str):
            signed_payload = signed_payload.encode()
        
        signature = hmac.new(
            self.secret.encode(),
            signed_payload,
            hashlib.sha256
        ).hexdigest()
        
        return f"sha256={signature}"


class IdempotencyHandler:
    def __init__(
        self,
        redis_client: redis.Redis,
        key_prefix: str = "webhook:processed:",
        ttl_seconds: int = 86400,
    ):
        self.redis = redis_client
        self.key_prefix = key_prefix
        self.ttl = ttl_seconds

    def is_processed(self, event_id: str) -> bool:
        key = f"{self.key_prefix}{event_id}"
        return self.redis.exists(key) == 1

    def mark_processed(self, event_id: str, result: Any = None) -> None:
        import json
        key = f"{self.key_prefix}{event_id}"
        value = json.dumps({
            "processed_at": time.time(),
            "result": result,
        })
        self.redis.setex(key, self.ttl, value)
```

### FastAPI Middleware

```python
# fastapi_webhook.py
from fastapi import Request, HTTPException, Depends
from functools import wraps

def webhook_protected(
    verifier: WebhookVerifier,
    idempotency: IdempotencyHandler,
    event_id_extractor: callable,
):
    async def dependency(request: Request):
        # Get raw body
        body = await request.body()
        
        # Verify signature
        result = verifier.verify(body, dict(request.headers))
        if not result.valid:
            raise HTTPException(status_code=401, detail=result.error)
        
        # Parse and check idempotency
        import json
        payload = json.loads(body)
        event_id = event_id_extractor(payload)
        
        if idempotency.is_processed(event_id):
            raise HTTPException(status_code=200, detail="Already processed")
        
        # Store for later marking
        request.state.webhook_event_id = event_id
        request.state.webhook_payload = payload
        
        return payload
    
    return Depends(dependency)


# Usage
@app.post("/webhooks/stripe")
async def stripe_webhook(
    payload: dict = webhook_protected(
        verifier=stripe_verifier,
        idempotency=idempotency_handler,
        event_id_extractor=lambda p: p["id"],
    )
):
    # Process webhook
    event_type = payload["type"]
    # ...
    
    # Mark as processed
    idempotency_handler.mark_processed(payload["id"])
    return {"status": "ok"}
```

## Express Setup

```typescript
// Important: Use raw body parser for webhooks
import express from 'express';

const app = express();

// Regular JSON parser for most routes
app.use(express.json());

// Raw body parser for webhook routes
app.use('/webhooks', express.raw({ type: 'application/json' }));

// Webhook route with verification
app.post('/webhooks/stripe', 
  createWebhookHandler({
    verifier: stripeVerifier,
    idempotency: idempotencyHandler,
    eventIdExtractor: (p: any) => p.id,
  }),
  async (req, res) => {
    const event = req.body;
    
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckout(event.data.object);
        break;
      // ... other handlers
    }
    
    res.json({ received: true });
  }
);
```

## Building Your Own Webhook Sender

```typescript
// webhook-sender.ts
import crypto from 'crypto';

interface WebhookDelivery {
  url: string;
  event: string;
  payload: unknown;
  secret: string;
}

async function sendWebhook(delivery: WebhookDelivery): Promise<boolean> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(delivery.payload);
  
  // Create signature
  const signedPayload = `${timestamp}.${body}`;
  const signature = 'sha256=' + crypto
    .createHmac('sha256', delivery.secret)
    .update(signedPayload)
    .digest('hex');

  try {
    const response = await fetch(delivery.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': timestamp,
        'X-Webhook-Event': delivery.event,
        'X-Webhook-ID': crypto.randomUUID(),
      },
      body,
    });

    return response.ok;
  } catch (error) {
    console.error('Webhook delivery failed:', error);
    return false;
  }
}
```

## Best Practices

1. **Always verify signatures**: Never trust unverified payloads
2. **Use constant-time comparison**: Prevents timing attacks
3. **Check timestamps**: Prevents replay attacks
4. **Implement idempotency**: Same webhook may be delivered multiple times
5. **Use raw body parser**: JSON parsing before verification breaks signatures
6. **Return 200 quickly**: Process async to avoid timeouts

## Common Mistakes

- Parsing JSON before signature verification
- Using regular string comparison for signatures
- Not handling duplicate deliveries
- Blocking on webhook processing (causes retries)
- Exposing webhook secrets in logs

## Security Checklist

- [ ] Signature verification with HMAC-SHA256
- [ ] Constant-time signature comparison
- [ ] Timestamp validation (5 min tolerance)
- [ ] Idempotency handling
- [ ] Raw body parser for webhook routes
- [ ] Secrets in environment variables
- [ ] HTTPS only
- [ ] Logging without exposing secrets
