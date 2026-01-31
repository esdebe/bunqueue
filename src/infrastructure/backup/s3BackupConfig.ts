/**
 * S3 Backup Configuration
 * Types and configuration factory
 */

/** S3 Backup configuration */
export interface S3BackupConfig {
  /** Enable S3 backup */
  enabled: boolean;
  /** S3 access key ID */
  accessKeyId: string;
  /** S3 secret access key */
  secretAccessKey: string;
  /** S3 bucket name */
  bucket: string;
  /** S3 endpoint (optional, for non-AWS S3-compatible services) */
  endpoint?: string;
  /** S3 region (optional, default: us-east-1) */
  region?: string;
  /** Backup interval in milliseconds (default: 6 hours) */
  intervalMs: number;
  /** Number of backups to retain (default: 7) */
  retention: number;
  /** Prefix for backup files (default: 'backups/') */
  prefix: string;
  /** Path to the SQLite database file */
  databasePath: string;
}

/** Backup result */
export interface BackupResult {
  success: boolean;
  key?: string;
  size?: number;
  duration?: number;
  error?: string;
}

/** Backup metadata stored in S3 */
export interface BackupMetadata {
  timestamp: string;
  version: string;
  size: number;
  checksum: string;
}

/** Backup list item */
export interface BackupItem {
  key: string;
  size: number;
  lastModified: Date;
}

/** Default configuration values */
export const DEFAULTS = {
  intervalMs: 6 * 60 * 60 * 1000, // 6 hours
  retention: 7,
  prefix: 'backups/',
  region: 'us-east-1',
} as const;

/**
 * Create configuration from environment variables
 */
export function configFromEnv(databasePath: string): S3BackupConfig {
  return {
    enabled: process.env.S3_BACKUP_ENABLED === '1' || process.env.S3_BACKUP_ENABLED === 'true',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? '',
    bucket: process.env.S3_BUCKET ?? process.env.AWS_BUCKET ?? '',
    endpoint: process.env.S3_ENDPOINT ?? process.env.AWS_ENDPOINT,
    region: process.env.S3_REGION ?? process.env.AWS_REGION ?? DEFAULTS.region,
    intervalMs: parseInt(process.env.S3_BACKUP_INTERVAL ?? '', 10) || DEFAULTS.intervalMs,
    retention: parseInt(process.env.S3_BACKUP_RETENTION ?? '', 10) || DEFAULTS.retention,
    prefix: process.env.S3_BACKUP_PREFIX ?? DEFAULTS.prefix,
    databasePath,
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: S3BackupConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.accessKeyId) {
    errors.push('S3_ACCESS_KEY_ID is required');
  }
  if (!config.secretAccessKey) {
    errors.push('S3_SECRET_ACCESS_KEY is required');
  }
  if (!config.bucket) {
    errors.push('S3_BUCKET is required');
  }
  if (!config.databasePath) {
    errors.push('Database path is required');
  }

  return { valid: errors.length === 0, errors };
}
