/**
 * Server Command Handler
 * Starts the bunQ server
 */

import { parseArgs } from 'node:util';
import { printServerHelp } from '../help';
import { VERSION } from '../../shared/version';

/** Server start options */
interface ServerOptions {
  tcpPort: number;
  httpPort: number;
  host: string;
  tcpSocketPath?: string;
  httpSocketPath?: string;
  dataPath?: string;
  authTokens: string[];
}

/** Parse server arguments */
function parseServerArgs(args: string[]): ServerOptions {
  const { values } = parseArgs({
    args,
    options: {
      'tcp-port': { type: 'string' },
      'http-port': { type: 'string' },
      'tcp-socket': { type: 'string' },
      'http-socket': { type: 'string' },
      host: { type: 'string' },
      'data-path': { type: 'string' },
      'auth-tokens': { type: 'string' },
    },
    allowPositionals: false,
    strict: false,
  });

  return {
    tcpPort: parseInt((values['tcp-port'] as string) ?? process.env.TCP_PORT ?? '6789', 10),
    httpPort: parseInt((values['http-port'] as string) ?? process.env.HTTP_PORT ?? '6790', 10),
    tcpSocketPath: (values['tcp-socket'] as string) ?? process.env.TCP_SOCKET_PATH,
    httpSocketPath: (values['http-socket'] as string) ?? process.env.HTTP_SOCKET_PATH,
    host: (values.host as string) ?? process.env.HOST ?? '0.0.0.0',
    dataPath: (values['data-path'] as string) ?? process.env.DATA_PATH,
    authTokens:
      (values['auth-tokens'] as string)?.split(',').filter(Boolean) ??
      process.env.AUTH_TOKENS?.split(',').filter(Boolean) ??
      [],
  };
}

/** Run the server */
export async function runServer(args: string[], showHelp: boolean): Promise<void> {
  if (showHelp) {
    printServerHelp();
    process.exit(0);
  }

  const options = parseServerArgs(args);

  // Set environment variables for the server
  process.env.TCP_PORT = String(options.tcpPort);
  process.env.HTTP_PORT = String(options.httpPort);
  process.env.HOST = options.host;
  if (options.tcpSocketPath) {
    process.env.TCP_SOCKET_PATH = options.tcpSocketPath;
  }
  if (options.httpSocketPath) {
    process.env.HTTP_SOCKET_PATH = options.httpSocketPath;
  }
  if (options.dataPath) {
    process.env.DATA_PATH = options.dataPath;
  }
  if (options.authTokens.length > 0) {
    process.env.AUTH_TOKENS = options.authTokens.join(',');
  }

  // Import and start the server components
  const { QueueManager } = await import('../../application/queueManager');
  const { createTcpServer } = await import('../../infrastructure/server/tcp');
  const { createHttpServer } = await import('../../infrastructure/server/http');
  const { serverLog } = await import('../../shared/logger');

  // Initialize
  const qm = new QueueManager({
    dataPath: options.dataPath,
  });

  const authTokens = options.authTokens.length > 0 ? options.authTokens : undefined;

  // Start servers (Unix socket or TCP)
  const tcpServer = createTcpServer(qm, {
    socketPath: options.tcpSocketPath,
    port: options.tcpPort,
    hostname: options.host,
    authTokens,
  });

  const httpServer = createHttpServer(qm, {
    socketPath: options.httpSocketPath,
    port: options.httpPort,
    hostname: options.host,
    authTokens,
  });

  serverLog.info('bunqueue server started', {
    tcpSocket: options.tcpSocketPath,
    tcpPort: options.tcpSocketPath ? undefined : options.tcpPort,
    httpSocket: options.httpSocketPath,
    httpPort: options.httpSocketPath ? undefined : options.httpPort,
    host: options.host,
    dataPath: options.dataPath ?? 'in-memory',
    auth: authTokens ? 'enabled' : 'disabled',
  });

  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';
  const magenta = '\x1b[35m';
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';

  // Format endpoint display
  const tcpDisplay = options.tcpSocketPath
    ? `${bold}${options.tcpSocketPath}${reset} ${dim}(unix)${reset}`
    : `${bold}${options.host}:${options.tcpPort}${reset}`;
  const httpDisplay = options.httpSocketPath
    ? `${bold}${options.httpSocketPath}${reset} ${dim}(unix)${reset}`
    : `${bold}${options.host}:${options.httpPort}${reset}`;

  // Socket mode display
  const hasUnixSockets =
    options.tcpSocketPath !== undefined || options.httpSocketPath !== undefined;
  const socketDisplay = hasUnixSockets
    ? `${green}enabled${reset} ${dim}(${options.tcpSocketPath ? 'TCP' : ''}${options.tcpSocketPath && options.httpSocketPath ? '+' : ''}${options.httpSocketPath ? 'HTTP' : ''})${reset}`
    : `${dim}disabled${reset}`;

  console.log(`
${magenta}        (\\(\\        ${reset}
${magenta}        ( -.-)      ${bold}bunqueue${reset} ${dim}v${VERSION}${reset}
${magenta}        o_(")(")    ${reset}${dim}High-performance job queue for Bun${reset}

${dim}─────────────────────────────────────────────────${reset}

  ${green}●${reset} TCP    ${tcpDisplay}
  ${green}●${reset} HTTP   ${httpDisplay}
  ${yellow}●${reset} Socket ${socketDisplay}
  ${yellow}●${reset} Data   ${options.dataPath ?? 'in-memory'}
  ${yellow}●${reset} Auth   ${authTokens ? `${green}enabled${reset}` : `${dim}disabled${reset}`}

${dim}─────────────────────────────────────────────────${reset}

  ${dim}Press ${bold}Ctrl+C${reset}${dim} to stop${reset}
`);

  // Handle shutdown
  const shutdown = () => {
    serverLog.info('Shutting down...');
    tcpServer.stop();
    httpServer.stop();
    qm.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
