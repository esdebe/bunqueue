/**
 * TCP Client for SDK - Production Ready
 * Connects to bunqueue server via TCP with auto-reconnection
 */

import { EventEmitter } from 'events';

/** Connection options */
export interface ConnectionOptions {
  host: string;
  port: number;
  token?: string;
  /** Max reconnection attempts (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 100) */
  reconnectDelay?: number;
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Connection timeout in ms (default: 5000) */
  connectTimeout?: number;
  /** Command timeout in ms (default: 30000) */
  commandTimeout?: number;
  /** Enable auto-reconnect (default: true) */
  autoReconnect?: boolean;
  /** Health check ping interval in ms (default: 30000, 0 to disable) */
  pingInterval?: number;
}

/** Default connection */
export const DEFAULT_CONNECTION: Required<ConnectionOptions> = {
  host: 'localhost',
  port: 6789,
  token: '',
  maxReconnectAttempts: Infinity,
  reconnectDelay: 100,
  maxReconnectDelay: 30000,
  connectTimeout: 5000,
  commandTimeout: 30000,
  autoReconnect: true,
  pingInterval: 30000, // 30s health check
};

/** Pending command */
interface PendingCommand {
  id: number;
  command: Record<string, unknown>;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/** Line buffer for efficient parsing */
class LineBuffer {
  private partial = '';

  /** Add data and return complete lines */
  addData(data: string): string[] {
    const combined = this.partial + data;
    const lines: string[] = [];
    let start = 0;
    let idx: number;

    while ((idx = combined.indexOf('\n', start)) !== -1) {
      const line = combined.slice(start, idx);
      if (line.length > 0) {
        lines.push(line);
      }
      start = idx + 1;
    }

    this.partial = start < combined.length ? combined.slice(start) : '';
    return lines;
  }

  clear(): void {
    this.partial = '';
  }
}

/** Socket wrapper */
interface SocketWrapper {
  write: (data: string) => void;
  end: () => void;
  lineBuffer: LineBuffer;
}

/**
 * TCP Client - manages connection to bunqueue server
 * Production-ready with auto-reconnection and exponential backoff
 */
export class TcpClient extends EventEmitter {
  private socket: SocketWrapper | null = null;
  private connected = false;
  private connecting = false;
  private closed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly options: Required<ConnectionOptions>;
  private readonly pendingCommands: Map<number, PendingCommand> = new Map();
  private pendingQueue: number[] = []; // FIFO queue of command IDs
  private currentCommand: PendingCommand | null = null;
  private commandIdCounter = 0;

  constructor(options: Partial<ConnectionOptions> = {}) {
    super();
    this.options = { ...DEFAULT_CONNECTION, ...options };
  }

  /** Connect to server */
  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) {
      // Wait for current connection attempt
      return new Promise((resolve, reject) => {
        const onConnect = () => {
          this.off('error', onError);
          resolve();
        };
        const onError = (err: Error) => {
          this.off('connected', onConnect);
          reject(err);
        };
        this.once('connected', onConnect);
        this.once('error', onError);
      });
    }

    this.connecting = true;
    this.closed = false;

    try {
      await this.doConnect();
      this.reconnectAttempts = 0;
      this.emit('connected');
      // Start health check ping
      this.startPing();
      // Process any pending commands
      this.processNextCommand();
    } catch (err) {
      this.connecting = false;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- user can set to false
      if (this.options.autoReconnect && !this.closed) {
        this.scheduleReconnect();
      }
      throw err;
    }
  }

  private async doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socketData: SocketWrapper = {
        write: () => {},
        end: () => {},
        lineBuffer: new LineBuffer(),
      };

      let connectionResolved = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      void Bun.connect({
        hostname: this.options.host,
        port: this.options.port,
        socket: {
          data: (_sock, data) => {
            const lines = socketData.lineBuffer.addData(data.toString());

            for (const line of lines) {
              if (this.currentCommand) {
                try {
                  const response = JSON.parse(line) as Record<string, unknown>;
                  clearTimeout(this.currentCommand.timeout);
                  this.currentCommand.resolve(response);
                  this.currentCommand = null;
                  this.processNextCommand();
                } catch {
                  if (this.currentCommand) {
                    clearTimeout(this.currentCommand.timeout);
                    this.currentCommand.reject(new Error('Invalid response from server'));
                    this.currentCommand = null;
                    this.processNextCommand();
                  }
                }
              }
            }
          },
          open: async (sock) => {
            cleanup();
            socketData.write = (data: string) => sock.write(data);
            socketData.end = () => sock.end();
            this.socket = socketData;
            this.connected = true;
            this.connecting = false;

            // Authenticate if token provided
            if (this.options.token) {
              try {
                const authResponse = await this.sendInternal({
                  cmd: 'Auth',
                  token: this.options.token,
                });
                if (!authResponse.ok) {
                  connectionResolved = true;
                  reject(new Error('Authentication failed'));
                  return;
                }
              } catch (err) {
                connectionResolved = true;
                reject(err instanceof Error ? err : new Error(String(err)));
                return;
              }
            }

            connectionResolved = true;
            resolve();
          },
          close: () => {
            const wasConnected = this.connected;
            this.connected = false;
            this.connecting = false;
            this.socket = null;
            this.stopPing();

            // Reject current command
            if (this.currentCommand) {
              clearTimeout(this.currentCommand.timeout);
              this.currentCommand.reject(new Error('Connection closed'));
              this.currentCommand = null;
            }

            if (wasConnected) {
              this.emit('disconnected');
              if (this.options.autoReconnect && !this.closed) {
                this.scheduleReconnect();
              }
            }

            if (!connectionResolved) {
              connectionResolved = true;
              cleanup();
              reject(new Error('Connection closed'));
            }
          },
          error: (_sock, error) => {
            if (!connectionResolved) {
              connectionResolved = true;
              cleanup();
              reject(new Error(`Connection error: ${error.message}`));
            }
            this.emit('error', error);
          },
          connectError: (_sock, error) => {
            if (!connectionResolved) {
              connectionResolved = true;
              cleanup();
              reject(
                new Error(
                  `Failed to connect to ${this.options.host}:${this.options.port}: ${error.message}`
                )
              );
            }
          },
        },
      });

      // Connection timeout
      timeoutId = setTimeout(() => {
        if (!connectionResolved) {
          connectionResolved = true;
          reject(new Error(`Connection timeout to ${this.options.host}:${this.options.port}`));
        }
      }, this.options.connectTimeout);
    });
  }

  /** Start periodic health check ping */
  private startPing(): void {
    if (this.options.pingInterval <= 0) return;
    this.stopPing();
    this.pingTimer = setInterval(() => {
      void this.ping();
    }, this.options.pingInterval);
  }

  /** Stop health check ping */
  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** Send ping to check connection health */
  async ping(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      const response = await this.send({ cmd: 'Ping' });
      return response.pong === true;
    } catch {
      return false;
    }
  }

  /** Schedule reconnection with exponential backoff */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return;

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.options.maxReconnectAttempts) {
      this.emit('maxReconnectAttemptsReached');
      // Reject all pending commands
      for (const cmd of this.pendingCommands.values()) {
        clearTimeout(cmd.timeout);
        cmd.reject(new Error('Max reconnection attempts reached'));
      }
      this.pendingCommands.clear();
      this.pendingQueue = [];
      return;
    }

    // Exponential backoff with jitter
    const baseDelay = Math.min(
      this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.options.maxReconnectDelay
    );
    const jitter = Math.random() * 0.3 * baseDelay; // 0-30% jitter
    const delay = baseDelay + jitter;

    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect()
        .then(() => {
          // Process queued commands after reconnection
          this.processNextCommand();
        })
        .catch(() => {
          // connect() will schedule another reconnect if needed
        });
    }, delay);
  }

  /** Internal send without auto-connect */
  private async sendInternal(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.currentCommand?.command === command) {
          this.currentCommand = null;
          reject(new Error('Command timeout'));
          this.processNextCommand();
        }
      }, this.options.commandTimeout);

      this.currentCommand = { id: 0, command, resolve, reject, timeout };
      if (this.socket) {
        this.socket.write(JSON.stringify(command) + '\n');
      }
    });
  }

  /** Process next pending command */
  private processNextCommand(): void {
    if (this.currentCommand || !this.connected || this.pendingQueue.length === 0) {
      return;
    }

    const nextId = this.pendingQueue.shift();
    if (nextId === undefined) return;
    const next = this.pendingCommands.get(nextId);
    if (!next || !this.socket) {
      this.pendingCommands.delete(nextId);
      return;
    }
    this.pendingCommands.delete(nextId);
    this.currentCommand = next;
    this.socket.write(JSON.stringify(next.command) + '\n');
  }

  /** Send command and wait for response */
  async send(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    // If connected and no pending commands, send immediately
    if (this.connected && this.pendingCommands.size === 0 && !this.currentCommand) {
      return this.sendInternal(command);
    }

    // Otherwise queue the command
    return new Promise((resolve, reject) => {
      const id = ++this.commandIdCounter;

      const timeout = setTimeout(() => {
        // O(1) lookup and delete with Map
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          // Remove from queue (still O(n) but timeout is rare)
          const queueIdx = this.pendingQueue.indexOf(id);
          if (queueIdx !== -1) {
            this.pendingQueue.splice(queueIdx, 1);
          }
          reject(new Error('Command timeout'));
        }
      }, this.options.commandTimeout);

      this.pendingCommands.set(id, { id, command, resolve, reject, timeout });
      this.pendingQueue.push(id);

      // Try to connect if not connected
      if (!this.connected && !this.connecting) {
        this.connect().catch(() => {
          // Error handled by reconnect logic
        });
      } else if (this.connected) {
        this.processNextCommand();
      }
    });
  }

  /** Close connection */
  close(): void {
    this.closed = true;
    this.stopPing();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending commands
    for (const cmd of this.pendingCommands.values()) {
      clearTimeout(cmd.timeout);
      cmd.reject(new Error('Client closed'));
    }
    this.pendingCommands.clear();
    this.pendingQueue = [];

    if (this.currentCommand) {
      clearTimeout(this.currentCommand.timeout);
      this.currentCommand.reject(new Error('Client closed'));
      this.currentCommand = null;
    }

    if (this.socket) {
      this.socket.end();
      this.socket = null;
      this.connected = false;
    }
  }

  /** Check if connected */
  isConnected(): boolean {
    return this.connected;
  }

  /** Get connection state */
  getState(): 'connected' | 'connecting' | 'disconnected' | 'closed' {
    if (this.closed) return 'closed';
    if (this.connected) return 'connected';
    if (this.connecting) return 'connecting';
    return 'disconnected';
  }
}

/** Shared client instance */
let sharedClient: TcpClient | null = null;

/** Get shared TCP client */
export function getSharedTcpClient(options?: Partial<ConnectionOptions>): TcpClient {
  sharedClient ??= new TcpClient(options);
  return sharedClient;
}

/** Close shared client */
export function closeSharedTcpClient(): void {
  if (sharedClient) {
    sharedClient.close();
    sharedClient = null;
  }
}
