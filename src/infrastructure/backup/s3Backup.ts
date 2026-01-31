/**
 * S3 Backup Module
 * Automated database backup to S3-compatible storage
 *
 * Supports: AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, etc.
 */

import { S3Client } from 'bun';
import { backupLog } from '../../shared/logger';
import {
  type S3BackupConfig,
  type BackupResult,
  type BackupItem,
  DEFAULTS,
  configFromEnv,
  validateConfig,
} from './s3BackupConfig';
import { performBackup, listBackups, restoreBackup, cleanupOldBackups } from './s3BackupOperations';

// Re-export types
export type { S3BackupConfig, BackupResult } from './s3BackupConfig';

/**
 * S3 Backup Manager
 * Handles automated and manual backups to S3-compatible storage
 */
export class S3BackupManager {
  private readonly config: S3BackupConfig;
  private readonly client: S3Client;
  private backupInterval: ReturnType<typeof setInterval> | null = null;
  private initialBackupTimeout: ReturnType<typeof setTimeout> | null = null;
  private isBackupInProgress = false;

  constructor(config: Partial<S3BackupConfig> & { databasePath: string }) {
    this.config = {
      enabled: config.enabled ?? false,
      accessKeyId: config.accessKeyId ?? '',
      secretAccessKey: config.secretAccessKey ?? '',
      bucket: config.bucket ?? '',
      endpoint: config.endpoint,
      region: config.region ?? DEFAULTS.region,
      intervalMs: config.intervalMs ?? DEFAULTS.intervalMs,
      retention: config.retention ?? DEFAULTS.retention,
      prefix: config.prefix ?? DEFAULTS.prefix,
      databasePath: config.databasePath,
    };

    // Initialize S3 client
    this.client = new S3Client({
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint,
      region: this.config.region,
    });
  }

  /**
   * Create configuration from environment variables
   */
  static fromEnv(databasePath: string): S3BackupConfig {
    return configFromEnv(databasePath);
  }

  /**
   * Validate configuration
   */
  validate(): { valid: boolean; errors: string[] } {
    return validateConfig(this.config);
  }

  /**
   * Start automated backup scheduler
   */
  start(): void {
    if (!this.config.enabled) {
      backupLog.info('S3 backup disabled');
      return;
    }

    const validation = this.validate();
    if (!validation.valid) {
      backupLog.error('S3 backup configuration invalid', { errors: validation.errors });
      return;
    }

    backupLog.info('S3 backup scheduler started', {
      bucket: this.config.bucket,
      endpoint: this.config.endpoint ?? 'AWS S3',
      interval: `${Math.round(this.config.intervalMs / 1000 / 60)} minutes`,
      retention: this.config.retention,
    });

    // Run initial backup after 1 minute
    this.initialBackupTimeout = setTimeout(() => {
      this.initialBackupTimeout = null;
      this.backup().catch((err: unknown) => {
        backupLog.error('Initial backup failed', { error: String(err) });
      });
    }, 60 * 1000);

    // Schedule periodic backups
    this.backupInterval = setInterval(() => {
      this.backup().catch((err: unknown) => {
        backupLog.error('Scheduled backup failed', { error: String(err) });
      });
    }, this.config.intervalMs);
  }

  /**
   * Stop automated backup scheduler
   */
  stop(): void {
    if (this.initialBackupTimeout) {
      clearTimeout(this.initialBackupTimeout);
      this.initialBackupTimeout = null;
    }
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
    }
    backupLog.info('S3 backup scheduler stopped');
  }

  /**
   * Perform a backup
   */
  async backup(): Promise<BackupResult> {
    if (this.isBackupInProgress) {
      backupLog.warn('Backup already in progress, skipping');
      return { success: false, error: 'Backup already in progress' };
    }

    this.isBackupInProgress = true;

    try {
      const result = await performBackup(this.config, this.client);

      if (result.success) {
        await cleanupOldBackups(this.config, this.client);
      }

      return result;
    } finally {
      this.isBackupInProgress = false;
    }
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<BackupItem[]> {
    return listBackups(this.config, this.client);
  }

  /**
   * Restore from a backup
   */
  async restore(key: string): Promise<BackupResult> {
    return restoreBackup(key, this.config, this.client);
  }

  /**
   * Get backup status
   */
  getStatus(): {
    enabled: boolean;
    bucket: string;
    endpoint: string;
    intervalMs: number;
    retention: number;
    isRunning: boolean;
  } {
    return {
      enabled: this.config.enabled,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint ?? 'AWS S3',
      intervalMs: this.config.intervalMs,
      retention: this.config.retention,
      isRunning: this.backupInterval !== null,
    };
  }
}
