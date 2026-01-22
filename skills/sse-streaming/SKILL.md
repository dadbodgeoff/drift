---
name: sse-streaming
description: Implement Server-Sent Events (SSE) for real-time updates with automatic reconnection and heartbeats. Use when building live dashboards, notifications, progress indicators, or any feature needing server-to-client push.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: realtime
  time: 3h
  source: drift-masterguide
---

# Server-Sent Events (SSE)

Real-time server-to-client streaming with automatic reconnection.

## When to Use This Skill

- Live dashboards and monitoring
- Real-time notifications
- Progress indicators for long operations
- Live feeds (activity, chat, updates)
- AI streaming responses

## SSE vs WebSockets

| Feature | SSE | WebSocket |
|---------|-----|-----------|
| Direction | Server → Client | Bidirectional |
| Protocol | HTTP | WS |
| Reconnection | Automatic | Manual |
| Complexity | Simple | Complex |
| Browser Support | Native | Native |
| Through Proxies | Easy | Can be tricky |

**Use SSE when**: You only need server-to-client push
**Use WebSocket when**: You need bidirectional communication

## TypeScript Implementation

### SSE Server

```typescript
// sse-server.ts
import { Request, Response } from 'express';
import { EventEmitter } from 'events';

interface SSEClient {
  id: string;
  userId?: string;
  res: Response;
  lastEventId: number;
}

class SSEServer {
  private clients = new Map<string, SSEClient>();
  private eventId = 0;
  private emitter = new EventEmitter();
  private heartbeatInterval: NodeJS.Timeout;

  constructor(heartbeatMs = 30000) {
    // Send heartbeats to keep connections alive
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: 'heartbeat', data: { timestamp: Date.now() } });
    }, heartbeatMs);
  }

  connect(req: Request, res: Response, userId?: string): string {
    const clientId = crypto.randomUUID();

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Get last event ID for replay
    const lastEventId = parseInt(req.headers['last-event-id'] as string) || 0;

    const client: SSEClient = {
      id: clientId,
      userId,
      res,
      lastEventId,
    };

    this.clients.set(clientId, client);

    // Send connection confirmation
    this.sendToClient(client, {
      type: 'connected',
      data: { clientId },
    });

    // Handle disconnect
    req.on('close', () => {
      this.clients.delete(clientId);
      this.emitter.emit('disconnect', clientId);
    });

    this.emitter.emit('connect', clientId, userId);

    return clientId;
  }

  send(clientId: string, event: SSEEvent): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;
    return this.sendToClient(client, event);
  }

  sendToUser(userId: string, event: SSEEvent): number {
    let sent = 0;
    for (const client of this.clients.values()) {
      if (client.userId === userId) {
        if (this.sendToClient(client, event)) sent++;
      }
    }
    return sent;
  }

  broadcast(event: SSEEvent): number {
    let sent = 0;
    for (const client of this.clients.values()) {
      if (this.sendToClient(client, event)) sent++;
    }
    return sent;
  }

  private sendToClient(client: SSEClient, event: SSEEvent): boolean {
    try {
      const id = ++this.eventId;
      const data = JSON.stringify(event.data);

      let message = '';
      if (event.type) message += `event: ${event.type}\n`;
      message += `id: ${id}\n`;
      message += `data: ${data}\n\n`;

      client.res.write(message);
      return true;
    } catch {
      // Client disconnected
      this.clients.delete(client.id);
      return false;
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getUserClients(userId: string): string[] {
    return Array.from(this.clients.values())
      .filter(c => c.userId === userId)
      .map(c => c.id);
  }

  onConnect(handler: (clientId: string, userId?: string) => void): void {
    this.emitter.on('connect', handler);
  }

  onDisconnect(handler: (clientId: string) => void): void {
    this.emitter.on('disconnect', handler);
  }

  close(): void {
    clearInterval(this.heartbeatInterval);
    for (const client of this.clients.values()) {
      client.res.end();
    }
    this.clients.clear();
  }
}

interface SSEEvent {
  type?: string;
  data: unknown;
}

export { SSEServer, SSEEvent, SSEClient };
```

### Express Routes

```typescript
// sse-routes.ts
import { Router } from 'express';
import { SSEServer } from './sse-server';

const router = Router();
const sse = new SSEServer();

// SSE endpoint
router.get('/events', (req, res) => {
  const userId = req.user?.id; // From auth middleware
  sse.connect(req, res, userId);
});

// Send notification to specific user
router.post('/notify/:userId', (req, res) => {
  const { userId } = req.params;
  const { type, message } = req.body;

  const sent = sse.sendToUser(userId, {
    type: 'notification',
    data: { type, message, timestamp: Date.now() },
  });

  res.json({ sent });
});

// Broadcast to all connected clients
router.post('/broadcast', (req, res) => {
  const { type, data } = req.body;

  const sent = sse.broadcast({ type, data });
  res.json({ sent, total: sse.getClientCount() });
});

export { router as sseRouter, sse };
```

### Progress Streaming

```typescript
// progress-stream.ts
import { SSEServer } from './sse-server';

interface ProgressUpdate {
  taskId: string;
  progress: number; // 0-100
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
}

class ProgressTracker {
  constructor(private sse: SSEServer) {}

  async trackTask<T>(
    taskId: string,
    userId: string,
    task: (update: (progress: number, message?: string) => void) => Promise<T>
  ): Promise<T> {
    const sendUpdate = (update: ProgressUpdate) => {
      this.sse.sendToUser(userId, {
        type: 'progress',
        data: update,
      });
    };

    sendUpdate({ taskId, progress: 0, status: 'running' });

    try {
      const result = await task((progress, message) => {
        sendUpdate({ taskId, progress, status: 'running', message });
      });

      sendUpdate({ taskId, progress: 100, status: 'completed' });
      return result;
    } catch (error) {
      sendUpdate({
        taskId,
        progress: 0,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}

// Usage
const tracker = new ProgressTracker(sse);

app.post('/process', async (req, res) => {
  const taskId = crypto.randomUUID();
  const userId = req.user.id;

  // Return immediately with task ID
  res.json({ taskId });

  // Process in background with progress updates
  tracker.trackTask(taskId, userId, async (update) => {
    for (let i = 0; i <= 100; i += 10) {
      await doSomeWork();
      update(i, `Processing step ${i / 10}`);
    }
  });
});
```

## Python Implementation

```python
# sse_server.py
import asyncio
import json
import uuid
from typing import Dict, Optional, AsyncGenerator, Callable
from dataclasses import dataclass
from fastapi import Request
from fastapi.responses import StreamingResponse

@dataclass
class SSEClient:
    id: str
    user_id: Optional[str]
    queue: asyncio.Queue

class SSEServer:
    def __init__(self, heartbeat_seconds: int = 30):
        self.clients: Dict[str, SSEClient] = {}
        self.event_id = 0
        self.heartbeat_seconds = heartbeat_seconds
        self._heartbeat_task: Optional[asyncio.Task] = None

    async def start(self):
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def stop(self):
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        for client in self.clients.values():
            await client.queue.put(None)  # Signal disconnect
        self.clients.clear()

    async def _heartbeat_loop(self):
        while True:
            await asyncio.sleep(self.heartbeat_seconds)
            await self.broadcast("heartbeat", {"timestamp": asyncio.get_event_loop().time()})

    async def connect(self, request: Request, user_id: Optional[str] = None) -> StreamingResponse:
        client_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue()
        
        client = SSEClient(id=client_id, user_id=user_id, queue=queue)
        self.clients[client_id] = client

        async def event_generator() -> AsyncGenerator[str, None]:
            # Send connection event
            yield self._format_event("connected", {"clientId": client_id})
            
            try:
                while True:
                    event = await queue.get()
                    if event is None:  # Disconnect signal
                        break
                    yield event
            finally:
                self.clients.pop(client_id, None)

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    def _format_event(self, event_type: str, data: dict) -> str:
        self.event_id += 1
        return f"event: {event_type}\nid: {self.event_id}\ndata: {json.dumps(data)}\n\n"

    async def send(self, client_id: str, event_type: str, data: dict) -> bool:
        client = self.clients.get(client_id)
        if not client:
            return False
        await client.queue.put(self._format_event(event_type, data))
        return True

    async def send_to_user(self, user_id: str, event_type: str, data: dict) -> int:
        sent = 0
        for client in self.clients.values():
            if client.user_id == user_id:
                await client.queue.put(self._format_event(event_type, data))
                sent += 1
        return sent

    async def broadcast(self, event_type: str, data: dict) -> int:
        event = self._format_event(event_type, data)
        for client in self.clients.values():
            await client.queue.put(event)
        return len(self.clients)
```

### FastAPI Routes

```python
# sse_routes.py
from fastapi import APIRouter, Request, Depends
from .sse_server import SSEServer

router = APIRouter()
sse = SSEServer()

@router.on_event("startup")
async def startup():
    await sse.start()

@router.on_event("shutdown")
async def shutdown():
    await sse.stop()

@router.get("/events")
async def events(request: Request, user_id: str = Depends(get_current_user_id)):
    return await sse.connect(request, user_id)

@router.post("/notify/{user_id}")
async def notify(user_id: str, event_type: str, message: str):
    sent = await sse.send_to_user(user_id, "notification", {
        "type": event_type,
        "message": message,
    })
    return {"sent": sent}
```

## Frontend Client

```typescript
// sse-client.ts
interface SSEClientOptions {
  url: string;
  onMessage?: (event: MessageEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  reconnectDelay?: number;
  maxRetries?: number;
}

class SSEClient {
  private eventSource: EventSource | null = null;
  private retries = 0;
  private handlers = new Map<string, Set<(data: unknown) => void>>();

  constructor(private options: SSEClientOptions) {}

  connect(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource(this.options.url);

    this.eventSource.onopen = () => {
      this.retries = 0;
      this.options.onOpen?.();
    };

    this.eventSource.onerror = (error) => {
      this.options.onError?.(error);
      this.handleReconnect();
    };

    this.eventSource.onmessage = (event) => {
      this.options.onMessage?.(event);
    };

    // Register typed event handlers
    for (const [type, handlers] of this.handlers) {
      this.eventSource.addEventListener(type, (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        handlers.forEach(handler => handler(data));
      });
    }
  }

  on<T>(eventType: string, handler: (data: T) => void): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
      
      // Add listener if already connected
      if (this.eventSource) {
        this.eventSource.addEventListener(eventType, (event: MessageEvent) => {
          const data = JSON.parse(event.data);
          this.handlers.get(eventType)?.forEach(h => h(data));
        });
      }
    }

    this.handlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  private handleReconnect(): void {
    const maxRetries = this.options.maxRetries ?? 10;
    const delay = this.options.reconnectDelay ?? 1000;

    if (this.retries >= maxRetries) {
      console.error('SSE: Max retries reached');
      return;
    }

    this.retries++;
    const backoff = delay * Math.pow(2, this.retries - 1);
    
    console.log(`SSE: Reconnecting in ${backoff}ms (attempt ${this.retries})`);
    setTimeout(() => this.connect(), backoff);
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

// Usage
const sse = new SSEClient({ url: '/api/events' });

sse.on<{ type: string; message: string }>('notification', (data) => {
  showNotification(data.type, data.message);
});

sse.on<{ taskId: string; progress: number }>('progress', (data) => {
  updateProgressBar(data.taskId, data.progress);
});

sse.connect();
```

## React Hook

```typescript
// useSSE.ts
import { useEffect, useRef, useCallback } from 'react';

function useSSE(url: string) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef<Map<string, (data: unknown) => void>>(new Map());

  useEffect(() => {
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onerror = () => {
      // Browser handles reconnection automatically
      console.log('SSE connection error, reconnecting...');
    };

    return () => {
      eventSource.close();
    };
  }, [url]);

  const subscribe = useCallback(<T>(
    eventType: string,
    handler: (data: T) => void
  ) => {
    const eventSource = eventSourceRef.current;
    if (!eventSource) return () => {};

    const wrappedHandler = (event: MessageEvent) => {
      handler(JSON.parse(event.data));
    };

    eventSource.addEventListener(eventType, wrappedHandler);

    return () => {
      eventSource.removeEventListener(eventType, wrappedHandler);
    };
  }, []);

  return { subscribe };
}

// Usage in component
function Dashboard() {
  const { subscribe } = useSSE('/api/events');
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    return subscribe('notification', (data) => {
      setNotifications(prev => [...prev, data]);
    });
  }, [subscribe]);

  return <NotificationList items={notifications} />;
}
```

## Best Practices

1. **Send heartbeats**: Keep connections alive through proxies
2. **Use event IDs**: Enable automatic replay on reconnect
3. **Disable buffering**: Set `X-Accel-Buffering: no` for nginx
4. **Handle reconnection**: Browser does it automatically, but add backoff
5. **Clean up on disconnect**: Remove clients from memory

## Common Mistakes

- Not disabling proxy buffering (events arrive in batches)
- Not sending heartbeats (connections timeout)
- Not handling client disconnects (memory leak)
- Using SSE for bidirectional communication (use WebSocket)
- Not using event IDs (lose events on reconnect)
