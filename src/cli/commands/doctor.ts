/**
 * bunqueue doctor - Diagnostic command
 * Checks client/server version, connectivity, health, and queue state
 */

import { VERSION } from '../../shared/version';

const green = '\x1b[32m';
const red = '\x1b[31m';
const yellow = '\x1b[33m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

function pass(msg: string): void {
  console.log(`  ${green}✓${reset} ${msg}`);
}

function fail(msg: string): void {
  console.log(`  ${red}✗${reset} ${msg}`);
}

function warn(msg: string): void {
  console.log(`  ${yellow}!${reset} ${msg}`);
}

function info(msg: string): void {
  console.log(`  ${dim}${msg}${reset}`);
}

interface HealthData {
  version?: string;
  status?: string;
  uptime?: number;
  queues?: {
    waiting?: number;
    active?: number;
    delayed?: number;
    completed?: number;
    dlq?: number;
  };
  connections?: { tcp?: number; ws?: number; sse?: number };
  memory?: { heapUsed?: number; heapTotal?: number; rss?: number };
}

export async function runDoctor(host: string, httpPort: number): Promise<void> {
  console.log(`\n${bold}bunqueue doctor${reset}\n`);
  let issues = 0;

  // 1. Client version
  console.log(`${bold}Client${reset}`);
  pass(`Version: ${VERSION}`);

  // 2. Server connectivity + version
  console.log(`\n${bold}Server${reset}`);
  const url = `http://${host}:${httpPort}/health`;
  let health: HealthData | null = null;

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      health = (await resp.json()) as HealthData;
      pass(`Reachable at ${host}:${httpPort}`);
    } else {
      fail(`HTTP ${resp.status} from ${host}:${httpPort}`);
      issues++;
    }
  } catch (err) {
    fail(`Not reachable at ${host}:${httpPort}`);
    info(err instanceof Error ? err.message : String(err));
    issues++;
  }

  if (!health) {
    console.log(`\n${red}${bold}Cannot continue without server connection.${reset}`);
    console.log(`${dim}Start the server or use --port to specify the TCP port.${reset}\n`);
    process.exit(1);
  }

  // 3. Server version + mismatch check
  if (health.version) {
    pass(`Version: ${health.version}`);
    if (health.version !== VERSION) {
      warn(`Version mismatch! Client=${VERSION}, Server=${health.version}`);
      info('Update both client and server to the same version');
      issues++;
    }
  }

  // 4. Server status
  if (health.status === 'healthy') {
    pass(`Status: healthy`);
  } else {
    fail(`Status: ${health.status ?? 'unknown'}`);
    issues++;
  }

  // 5. Uptime
  if (health.uptime !== undefined) {
    const hrs = Math.floor(health.uptime / 3600);
    const mins = Math.floor((health.uptime % 3600) / 60);
    const secs = health.uptime % 60;
    const parts: string[] = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    pass(`Uptime: ${parts.join(' ')}`);
  }

  // 6. Connections
  if (health.connections) {
    const c = health.connections;
    pass(`Connections: TCP=${c.tcp ?? 0}, WS=${c.ws ?? 0}, SSE=${c.sse ?? 0}`);
  }

  // 7. Queue state
  console.log(`\n${bold}Queues${reset}`);
  const q = health.queues;
  if (q) {
    pass(`Waiting: ${q.waiting ?? 0}`);
    pass(`Active: ${q.active ?? 0}`);
    pass(`Delayed: ${q.delayed ?? 0}`);
    pass(`Completed: ${q.completed ?? 0}`);

    if ((q.dlq ?? 0) > 0) {
      warn(`DLQ: ${q.dlq} (dead-letter jobs need attention)`);
      issues++;
    } else {
      pass(`DLQ: 0`);
    }
  }

  // 8. Memory
  console.log(`\n${bold}Memory${reset}`);
  if (health.memory) {
    const m = health.memory;
    const heapUsed = typeof m.heapUsed === 'number' ? m.heapUsed : 0;
    const rss = typeof m.rss === 'number' ? m.rss : 0;
    pass(`Heap: ${heapUsed}MB`);
    pass(`RSS: ${rss}MB`);

    if (rss > 512) {
      warn(`High memory usage (${rss}MB RSS)`);
      issues++;
    }
  }

  // Summary
  console.log('');
  if (issues === 0) {
    console.log(`${green}${bold}All checks passed.${reset}\n`);
  } else {
    console.log(`${yellow}${bold}${issues} issue${issues > 1 ? 's' : ''} found.${reset}\n`);
  }

  process.exit(issues > 0 ? 1 : 0);
}
