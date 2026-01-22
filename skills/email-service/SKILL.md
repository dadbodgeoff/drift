---
name: email-service
description: Production email service with templates, queuing, and delivery tracking. Supports transactional emails, marketing campaigns, and webhooks.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: integrations
  time: 4h
  source: drift-masterguide
---

# Email Service

Send transactional and marketing emails reliably.

## When to Use This Skill

- User signup confirmations
- Password reset emails
- Order notifications
- Marketing campaigns
- Digest/summary emails

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Application                         │
│                                                     │
│  emailService.send({                                │
│    to: "user@example.com",                          │
│    template: "welcome",                             │
│    data: { name: "John" }                           │
│  })                                                 │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                  Email Queue                         │
│                                                     │
│  - Deduplication                                    │
│  - Rate limiting                                    │
│  - Retry logic                                      │
│  - Priority handling                                │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Email Provider (SendGrid/SES)          │
│                                                     │
│  - Template rendering                               │
│  - Delivery                                         │
│  - Bounce/complaint handling                        │
└─────────────────────────────────────────────────────┘
```

## TypeScript Implementation

### Email Service

```typescript
// email-service.ts
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

interface EmailOptions {
  to: string | string[];
  subject?: string;
  template: string;
  data: Record<string, unknown>;
  priority?: 'high' | 'normal' | 'low';
  scheduledAt?: Date;
  tags?: string[];
}

interface EmailTemplate {
  subject: string;
  html: string;
  text?: string;
}

class EmailService {
  private queue: Queue;
  private templates: Map<string, EmailTemplate> = new Map();

  constructor(redis: Redis) {
    this.queue = new Queue('emails', { connection: redis });
    this.loadTemplates();
  }

  async send(options: EmailOptions): Promise<string> {
    const template = this.templates.get(options.template);
    if (!template) {
      throw new Error(`Template not found: ${options.template}`);
    }

    const jobId = `email-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const priority = { high: 1, normal: 5, low: 10 }[options.priority || 'normal'];

    await this.queue.add(
      'send',
      {
        to: options.to,
        subject: options.subject || this.renderString(template.subject, options.data),
        html: this.renderString(template.html, options.data),
        text: template.text ? this.renderString(template.text, options.data) : undefined,
        tags: options.tags,
      },
      {
        jobId,
        priority,
        delay: options.scheduledAt ? options.scheduledAt.getTime() - Date.now() : 0,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
      }
    );

    return jobId;
  }

  async sendBulk(recipients: Array<{ email: string; data: Record<string, unknown> }>, template: string): Promise<string[]> {
    const jobIds: string[] = [];

    for (const recipient of recipients) {
      const jobId = await this.send({
        to: recipient.email,
        template,
        data: recipient.data,
        priority: 'low',
      });
      jobIds.push(jobId);
    }

    return jobIds;
  }

  private renderString(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] || ''));
  }

  private loadTemplates(): void {
    this.templates.set('welcome', {
      subject: 'Welcome to {{appName}}!',
      html: `
        <h1>Welcome, {{name}}!</h1>
        <p>Thanks for signing up. Get started by exploring your dashboard.</p>
        <a href="{{dashboardUrl}}">Go to Dashboard</a>
      `,
    });

    this.templates.set('password-reset', {
      subject: 'Reset your password',
      html: `
        <h1>Password Reset</h1>
        <p>Click the link below to reset your password. This link expires in 1 hour.</p>
        <a href="{{resetUrl}}">Reset Password</a>
        <p>If you didn't request this, ignore this email.</p>
      `,
    });

    this.templates.set('order-confirmation', {
      subject: 'Order #{{orderId}} confirmed',
      html: `
        <h1>Order Confirmed</h1>
        <p>Thanks for your order, {{name}}!</p>
        <p>Order ID: {{orderId}}</p>
        <p>Total: {{total}}</p>
        <a href="{{orderUrl}}">View Order</a>
      `,
    });
  }
}

export { EmailService, EmailOptions };
```

### Email Worker

```typescript
// email-worker.ts
import { Worker, Job } from 'bullmq';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

interface EmailJob {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  tags?: string[];
}

const ses = new SESClient({ region: process.env.AWS_REGION });

const worker = new Worker<EmailJob>(
  'emails',
  async (job: Job<EmailJob>) => {
    const { to, subject, html, text } = job.data;
    const recipients = Array.isArray(to) ? to : [to];

    const command = new SendEmailCommand({
      Source: process.env.EMAIL_FROM!,
      Destination: { ToAddresses: recipients },
      Message: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: html },
          Text: text ? { Data: text } : undefined,
        },
      },
    });

    const result = await ses.send(command);

    // Log for tracking
    await logEmailSent({
      jobId: job.id,
      messageId: result.MessageId,
      to: recipients,
      subject,
      tags: job.data.tags,
    });

    return { messageId: result.MessageId };
  },
  {
    connection: redis,
    concurrency: 10,
    limiter: { max: 100, duration: 1000 }, // 100 emails/second
  }
);

worker.on('failed', (job, err) => {
  console.error(`Email job ${job?.id} failed:`, err);
});

export { worker };
```

## Python Implementation

```python
# email_service.py
from dataclasses import dataclass
from typing import Optional
import boto3
from redis import Redis
from rq import Queue

@dataclass
class EmailOptions:
    to: str | list[str]
    template: str
    data: dict
    subject: Optional[str] = None
    priority: str = "normal"
    tags: Optional[list[str]] = None

class EmailService:
    def __init__(self, redis: Redis):
        self.queue = Queue("emails", connection=redis)
        self.templates = self._load_templates()

    def send(self, options: EmailOptions) -> str:
        template = self.templates.get(options.template)
        if not template:
            raise ValueError(f"Template not found: {options.template}")

        subject = options.subject or self._render(template["subject"], options.data)
        html = self._render(template["html"], options.data)

        job = self.queue.enqueue(
            send_email_task,
            options.to,
            subject,
            html,
            options.tags,
        )
        return job.id

    def _render(self, template: str, data: dict) -> str:
        for key, value in data.items():
            template = template.replace(f"{{{{{key}}}}}", str(value))
        return template

    def _load_templates(self) -> dict:
        return {
            "welcome": {
                "subject": "Welcome to {{app_name}}!",
                "html": "<h1>Welcome, {{name}}!</h1>",
            },
            "password-reset": {
                "subject": "Reset your password",
                "html": "<a href='{{reset_url}}'>Reset Password</a>",
            },
        }

def send_email_task(to: str | list[str], subject: str, html: str, tags: list[str] = None):
    ses = boto3.client("ses")
    recipients = [to] if isinstance(to, str) else to

    ses.send_email(
        Source=os.environ["EMAIL_FROM"],
        Destination={"ToAddresses": recipients},
        Message={
            "Subject": {"Data": subject},
            "Body": {"Html": {"Data": html}},
        },
    )
```

## Webhook Handling (Bounces/Complaints)

```typescript
// email-webhooks.ts
import { Router } from 'express';

const router = Router();

// SES webhook (via SNS)
router.post('/webhooks/ses', async (req, res) => {
  const message = JSON.parse(req.body.Message);

  switch (message.notificationType) {
    case 'Bounce':
      await handleBounce(message.bounce);
      break;
    case 'Complaint':
      await handleComplaint(message.complaint);
      break;
    case 'Delivery':
      await handleDelivery(message.delivery);
      break;
  }

  res.sendStatus(200);
});

async function handleBounce(bounce: any) {
  for (const recipient of bounce.bouncedRecipients) {
    await db.emailSuppressions.upsert({
      where: { email: recipient.emailAddress },
      create: {
        email: recipient.emailAddress,
        reason: 'bounce',
        bounceType: bounce.bounceType,
      },
      update: { reason: 'bounce', bounceType: bounce.bounceType },
    });
  }
}

async function handleComplaint(complaint: any) {
  for (const recipient of complaint.complainedRecipients) {
    await db.emailSuppressions.upsert({
      where: { email: recipient.emailAddress },
      create: { email: recipient.emailAddress, reason: 'complaint' },
      update: { reason: 'complaint' },
    });
  }
}
```

## Best Practices

1. **Always queue emails** - Never send synchronously
2. **Handle bounces/complaints** - Maintain suppression list
3. **Use templates** - Consistent branding, easier updates
4. **Include unsubscribe links** - Legal requirement (CAN-SPAM)
5. **Track delivery metrics** - Monitor bounce rates

## Common Mistakes

- Sending emails synchronously (blocks requests)
- Ignoring bounces (damages sender reputation)
- No rate limiting (provider throttling)
- Missing unsubscribe mechanism
- Not validating email addresses before sending
