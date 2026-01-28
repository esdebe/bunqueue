/**
 * Logger Tests
 * Structured logging
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { Logger, createLogger } from '../src/shared/logger';

describe('Logger', () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleDebugSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleDebugSpy = spyOn(console, 'debug').mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    Logger.disableJsonMode();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleDebugSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('human-readable mode', () => {
    test('should log info messages', () => {
      const logger = new Logger('TestComponent');
      logger.info('Test message');

      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('[TestComponent]');
      expect(call).toContain('Test message');
    });

    test('should log debug messages', () => {
      const logger = new Logger('TestComponent');
      logger.debug('Debug message');

      expect(consoleDebugSpy).toHaveBeenCalled();
    });

    test('should log warn messages', () => {
      const logger = new Logger('TestComponent');
      logger.warn('Warning message');

      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    test('should log error messages', () => {
      const logger = new Logger('TestComponent');
      logger.error('Error message');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    test('should include data in log', () => {
      const logger = new Logger('TestComponent');
      logger.info('Test message', { key: 'value' });

      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('{"key":"value"}');
    });
  });

  describe('JSON mode', () => {
    beforeEach(() => {
      Logger.enableJsonMode();
    });

    test('should output valid JSON', () => {
      const logger = new Logger('TestComponent');
      logger.info('Test message');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.component).toBe('TestComponent');
      expect(parsed.message).toBe('Test message');
      expect(parsed.level).toBe('info');
      expect(parsed.timestamp).toBeDefined();
    });

    test('should include timestamp in ISO format', () => {
      const logger = new Logger('TestComponent');
      logger.info('Test');

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      // Should be valid ISO timestamp
      const date = new Date(parsed.timestamp);
      expect(date.toISOString()).toBe(parsed.timestamp);
    });

    test('should include data in JSON output', () => {
      const logger = new Logger('TestComponent');
      logger.info('Test', { userId: 123, action: 'login' });

      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.data.userId).toBe(123);
      expect(parsed.data.action).toBe('login');
    });

    test('should log all levels as JSON', () => {
      const logger = new Logger('Test');

      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      // All should go to console.log in JSON mode
      expect(consoleLogSpy).toHaveBeenCalledTimes(4);

      const levels = consoleLogSpy.mock.calls.map((call) => JSON.parse(call[0]).level);
      expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
    });
  });

  describe('createLogger', () => {
    test('should create logger with component name', () => {
      const logger = createLogger('MyModule');
      logger.info('Test');

      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('[MyModule]');
    });
  });

  describe('mode switching', () => {
    test('should switch between modes', () => {
      const logger = new Logger('Test');

      // Human mode
      Logger.disableJsonMode();
      logger.info('human');
      let call = consoleLogSpy.mock.calls[0][0];
      expect(call).toContain('[Test]');

      // JSON mode
      Logger.enableJsonMode();
      logger.info('json');
      call = consoleLogSpy.mock.calls[1][0];
      const parsed = JSON.parse(call);
      expect(parsed.component).toBe('Test');
    });
  });
});
