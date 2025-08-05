import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  log,
  calculateBackoffDelay,
  extractPortFromArgs,
  extractHostFromArgs,
  extractBooleanFlag,
  extractCommaSeparatedRoles,
  extractCommandAndArgs,
  validateProtocol,
  validateMode,
  validatePort
} from '../../src/utils';

describe('Utils Module', () => {
  beforeEach(() => {
    delete process.env.DEBUG;
    jest.clearAllMocks();
  });

  describe('log', () => {
    let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it('should log when DEBUG is enabled', () => {
      process.env.DEBUG = 'true';
      log('test message', 'with args');

      expect(consoleLogSpy).toHaveBeenCalledWith('[mcp-remote]', 'test message', 'with args');
    });

    it('should not log when DEBUG is disabled', () => {
      process.env.DEBUG = 'false';
      log('test message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not log when DEBUG is undefined', () => {
      log('test message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff delay', () => {
      expect(calculateBackoffDelay(0, 1000)).toBe(1000);
      expect(calculateBackoffDelay(1, 1000)).toBe(2000);
      expect(calculateBackoffDelay(2, 1000)).toBe(4000);
      expect(calculateBackoffDelay(3, 1000)).toBe(8000);
    });

    it('should cap delay at 30 seconds', () => {
      expect(calculateBackoffDelay(10, 1000)).toBe(30000);
      expect(calculateBackoffDelay(20, 1000)).toBe(30000);
    });

    it('should handle custom initial delay', () => {
      expect(calculateBackoffDelay(1, 500)).toBe(1000);
      expect(calculateBackoffDelay(2, 2000)).toBe(8000);
    });
  });

  describe('extractPortFromArgs', () => {
    it('should extract port number from arguments', () => {
      const args = ['server', 'tcp', '--port', '8080', '--host', 'localhost'];
      expect(extractPortFromArgs(args)).toBe(8080);
    });

    it('should return null when port flag is missing', () => {
      const args = ['server', 'tcp', '--host', 'localhost'];
      expect(extractPortFromArgs(args)).toBeNull();
    });

    it('should return null when port value is missing', () => {
      const args = ['server', 'tcp', '--port'];
      expect(extractPortFromArgs(args)).toBeNull();
    });

    it('should return null when port value is not a number', () => {
      const args = ['server', 'tcp', '--port', 'not-a-number'];
      expect(extractPortFromArgs(args)).toBeNull();
    });
  });

  describe('extractHostFromArgs', () => {
    it('should extract host from arguments', () => {
      const args = ['client', 'ws', '--port', '8080', '--host', 'example.com'];
      expect(extractHostFromArgs(args)).toBe('example.com');
    });

    it('should return undefined when host flag is missing', () => {
      const args = ['client', 'ws', '--port', '8080'];
      expect(extractHostFromArgs(args)).toBeUndefined();
    });
  });

  describe('extractBooleanFlag', () => {
    it('should detect boolean flags', () => {
      const args = ['client', '--auto-reconnect', '--port', '8080'];
      expect(extractBooleanFlag(args, '--auto-reconnect')).toBe(true);
      expect(extractBooleanFlag(args, '--verbose')).toBe(false);
    });
  });

  describe('extractCommaSeparatedRoles', () => {
    it('should parse comma-separated roles', () => {
      const args = ['server', '--require-roles', 'admin,user,guest', '--port', '8080'];
      expect(extractCommaSeparatedRoles(args, '--require-roles')).toEqual(['admin', 'user', 'guest']);
    });

    it('should handle single role', () => {
      const args = ['server', '--require-roles', 'admin', '--port', '8080'];
      expect(extractCommaSeparatedRoles(args, '--require-roles')).toEqual(['admin']);
    });

    it('should return undefined when flag is missing', () => {
      const args = ['server', '--port', '8080'];
      expect(extractCommaSeparatedRoles(args, '--require-roles')).toBeUndefined();
    });
  });

  describe('extractCommandAndArgs', () => {
    it('should extract command and arguments after separator', () => {
      const args = ['server', 'tcp', '--port', '8080', '--', 'node', 'server.js', '--config', 'test.json'];
      const result = extractCommandAndArgs(args);
      
      expect(result).toEqual({
        command: 'node',
        args: ['server.js', '--config', 'test.json']
      });
    });

    it('should return null when separator is missing', () => {
      const args = ['server', 'tcp', '--port', '8080'];
      expect(extractCommandAndArgs(args)).toBeNull();
    });

    it('should return null when command is missing after separator', () => {
      const args = ['server', 'tcp', '--port', '8080', '--'];
      expect(extractCommandAndArgs(args)).toBeNull();
    });

    it('should handle command without additional args', () => {
      const args = ['server', 'tcp', '--port', '8080', '--', 'node'];
      const result = extractCommandAndArgs(args);
      
      expect(result).toEqual({
        command: 'node',
        args: []
      });
    });
  });

  describe('validateProtocol', () => {
    it('should validate supported protocols', () => {
      expect(validateProtocol('tcp')).toBe(true);
      expect(validateProtocol('ws')).toBe(true);
      expect(validateProtocol('http')).toBe(false);
      expect(validateProtocol('invalid')).toBe(false);
    });
  });

  describe('validateMode', () => {
    it('should validate supported modes', () => {
      expect(validateMode('server')).toBe(true);
      expect(validateMode('client')).toBe(true);
      expect(validateMode('proxy')).toBe(false);
      expect(validateMode('invalid')).toBe(false);
    });
  });

  describe('validatePort', () => {
    it('should validate port numbers', () => {
      expect(validatePort(8080)).toBe(true);
      expect(validatePort(1)).toBe(true);
      expect(validatePort(65535)).toBe(true);
      expect(validatePort(0)).toBe(false);
      expect(validatePort(-1)).toBe(false);
      expect(validatePort(65536)).toBe(false);
      expect(validatePort(1.5)).toBe(false);
    });
  });
});