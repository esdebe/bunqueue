<p align="center">
  <img src=".github/logo.svg" alt="bunqueue" width="300" />
</p>

---

## Why bunqueue?

| Library | Requires |
|---------|----------|
| BullMQ | Redis |
| Agenda | MongoDB |
| pg-boss | PostgreSQL |
| **bunqueue** | **Nothing** |

- **BullMQ-compatible API** — Same `Queue`, `Worker`, `QueueEvents`
- **Zero dependencies** — No Redis, no MongoDB
- **SQLite persistence** — Survives restarts
- **100K+ jobs/sec** — Built on Bun

## Install

```bash
bun add bunqueue
```

> Requires [Bun](https://bun.sh) runtime. Node.js is not supported.

## Quick Example

```typescript
import { Queue, Worker } from 'bunqueue/client';

const queue = new Queue('emails', { embedded: true });

const worker = new Worker('emails', async (job) => {
  console.log('Processing:', job.data);
  return { sent: true };
}, { embedded: true });

await queue.add('welcome', { to: 'user@example.com' });
```

## Documentation

**[Read the full documentation →](https://egeominotti.github.io/bunqueue/)**

- [Quick Start](https://egeominotti.github.io/bunqueue/guide/quickstart/)
- [Queue API](https://egeominotti.github.io/bunqueue/guide/queue/)
- [Worker API](https://egeominotti.github.io/bunqueue/guide/worker/)
- [Server Mode](https://egeominotti.github.io/bunqueue/guide/server/)
- [CLI Reference](https://egeominotti.github.io/bunqueue/guide/cli/)
- [Environment Variables](https://egeominotti.github.io/bunqueue/guide/env-vars/)

## License

MIT
