---
name: stripe-integration
description: Complete Stripe payments integration with subscriptions, webhooks, and customer portal. Use when adding billing to a SaaS application with subscription tiers, usage-based pricing, or one-time payments.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: integrations
  time: 6h
  source: drift-masterguide
---

# Stripe Integration

Production-ready Stripe integration for SaaS billing.

## When to Use This Skill

- Adding subscription billing to your SaaS
- Implementing usage-based pricing
- Setting up customer self-service portal
- Handling payment webhooks securely

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend   │────▶│   Stripe    │
│  Checkout   │     │   Webhooks  │◀────│   Events    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Database   │
                    │  (sync'd)   │
                    └─────────────┘
```

## Environment Setup

```bash
# .env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_FREE=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ENTERPRISE=price_...
```

## TypeScript Implementation

### Stripe Client Setup

```typescript
// lib/stripe.ts
import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
  typescript: true,
});

export const PRICES = {
  free: process.env.STRIPE_PRICE_FREE!,
  pro: process.env.STRIPE_PRICE_PRO!,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE!,
} as const;

export type PriceTier = keyof typeof PRICES;
```

### Create Checkout Session

```typescript
// api/create-checkout.ts
import { stripe, PRICES, PriceTier } from '@/lib/stripe';

interface CreateCheckoutParams {
  userId: string;
  email: string;
  tier: PriceTier;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutSession({
  userId,
  email,
  tier,
  successUrl,
  cancelUrl,
}: CreateCheckoutParams): Promise<string> {
  // Get or create Stripe customer
  let customer = await getStripeCustomer(userId);
  
  if (!customer) {
    customer = await stripe.customers.create({
      email,
      metadata: { userId },
    });
    await saveStripeCustomerId(userId, customer.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customer.id,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: PRICES[tier],
        quantity: 1,
      },
    ],
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: { userId },
    },
    allow_promotion_codes: true,
  });

  return session.url!;
}
```

### Webhook Handler

```typescript
// api/webhooks/stripe.ts
import { stripe } from '@/lib/stripe';
import { headers } from 'next/headers';

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get('stripe-signature')!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data.object);
        break;
        
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object);
        break;
        
      case 'customer.subscription.deleted':
        await handleSubscriptionCanceled(event.data.object);
        break;
        
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
        
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return new Response('Webhook handler failed', { status: 500 });
  }
}

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const subscriptionId = session.subscription as string;
  
  if (!userId || !subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items.data[0]?.price.id;
  const tier = Object.entries(PRICES).find(([, id]) => id === priceId)?.[0] || 'free';

  await updateUserSubscription(userId, {
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: session.customer as string,
    tier,
    status: subscription.status,
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
  });
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;
  if (!userId) return;

  const priceId = subscription.items.data[0]?.price.id;
  const tier = Object.entries(PRICES).find(([, id]) => id === priceId)?.[0] || 'free';

  await updateUserSubscription(userId, {
    tier,
    status: subscription.status,
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });
}

async function handleSubscriptionCanceled(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;
  if (!userId) return;

  await updateUserSubscription(userId, {
    tier: 'free',
    status: 'canceled',
    stripeSubscriptionId: null,
  });
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  const user = await getUserByStripeCustomerId(customerId);
  
  if (user) {
    await sendPaymentFailedEmail(user.email, {
      amount: invoice.amount_due / 100,
      nextRetry: invoice.next_payment_attempt 
        ? new Date(invoice.next_payment_attempt * 1000)
        : null,
    });
  }
}
```

### Customer Portal

```typescript
// api/create-portal.ts
export async function createPortalSession(userId: string): Promise<string> {
  const user = await getUser(userId);
  
  if (!user?.stripeCustomerId) {
    throw new Error('No Stripe customer found');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${process.env.NEXT_PUBLIC_URL}/settings/billing`,
  });

  return session.url;
}
```

## Python Implementation

### FastAPI Webhook Handler

```python
# webhooks/stripe.py
import stripe
from fastapi import APIRouter, Request, HTTPException, Header

router = APIRouter()
stripe.api_key = settings.STRIPE_SECRET_KEY

@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None),
):
    payload = await request.body()
    
    try:
        event = stripe.Webhook.construct_event(
            payload,
            stripe_signature,
            settings.STRIPE_WEBHOOK_SECRET,
        )
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    handlers = {
        "checkout.session.completed": handle_checkout_complete,
        "customer.subscription.updated": handle_subscription_update,
        "customer.subscription.deleted": handle_subscription_canceled,
        "invoice.payment_failed": handle_payment_failed,
    }

    handler = handlers.get(event["type"])
    if handler:
        await handler(event["data"]["object"])

    return {"status": "ok"}


async def handle_checkout_complete(session: dict):
    user_id = session.get("metadata", {}).get("userId")
    subscription_id = session.get("subscription")
    
    if not user_id or not subscription_id:
        return

    subscription = stripe.Subscription.retrieve(subscription_id)
    price_id = subscription["items"]["data"][0]["price"]["id"]
    tier = PRICE_TO_TIER.get(price_id, "free")

    await update_user_subscription(
        user_id=user_id,
        stripe_subscription_id=subscription_id,
        stripe_customer_id=session["customer"],
        tier=tier,
        status=subscription["status"],
        current_period_end=datetime.fromtimestamp(
            subscription["current_period_end"]
        ),
    )
```

## Frontend Checkout Button

```tsx
// components/CheckoutButton.tsx
'use client';

import { useState } from 'react';

interface CheckoutButtonProps {
  tier: 'pro' | 'enterprise';
  children: React.ReactNode;
}

export function CheckoutButton({ tier, children }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      
      const { url } = await response.json();
      window.location.href = url;
    } catch (error) {
      console.error('Checkout error:', error);
      setLoading(false);
    }
  };

  return (
    <button onClick={handleCheckout} disabled={loading}>
      {loading ? 'Loading...' : children}
    </button>
  );
}
```

## Database Schema

```sql
-- users table additions
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN subscription_tier TEXT DEFAULT 'free';
ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'active';
ALTER TABLE users ADD COLUMN current_period_end TIMESTAMP;
ALTER TABLE users ADD COLUMN cancel_at_period_end BOOLEAN DEFAULT FALSE;

CREATE INDEX idx_users_stripe_customer ON users(stripe_customer_id);
```

## Testing Webhooks Locally

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Trigger test events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
```

## Best Practices

1. **Always verify webhook signatures**: Never trust unverified payloads
2. **Make webhooks idempotent**: Same event may be delivered multiple times
3. **Store Stripe IDs**: Keep customer/subscription IDs in your database
4. **Use metadata**: Pass your user IDs in metadata for easy lookup
5. **Handle all subscription states**: active, past_due, canceled, etc.

## Common Mistakes

- Not handling `invoice.payment_failed` (users don't know payment failed)
- Trusting client-side tier selection (always verify server-side)
- Not setting up customer portal (users can't self-manage)
- Forgetting to sync subscription status on webhook
- Not testing with Stripe CLI locally

## Security Checklist

- [ ] Webhook signature verification
- [ ] HTTPS only for webhook endpoints
- [ ] Stripe keys in environment variables
- [ ] Customer portal configured
- [ ] Test mode vs live mode separation
- [ ] PCI compliance (use Stripe Elements/Checkout)
