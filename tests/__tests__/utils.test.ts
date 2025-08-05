import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('Utility Functions', () => {
  let originalDebug: string | undefined;

  beforeEach(() => {
    originalDebug = process.env.DEBUG;
  });

  afterEach(() => {
    if (originalDebug) {
      process.env.DEBUG = originalDebug;
    } else {
      delete process.env.DEBUG;
    }
  });

  describe('Debug Logging', () => {
    it('should log when DEBUG is enabled', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      process.env.DEBUG = 'true';

      const log = (...args: any[]) => {
        if (process.env.DEBUG === 'true') console.log('[mcp-remote]', ...args);
      };

      log('test message', 'with', 'multiple', 'args');
      
      expect(consoleSpy).toHaveBeenCalledWith('[mcp-remote]', 'test message', 'with', 'multiple', 'args');
      
      consoleSpy.mockRestore();
    });

    it('should not log when DEBUG is disabled', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      process.env.DEBUG = 'false';

      const log = (...args: any[]) => {
        if (process.env.DEBUG === 'true') console.log('[mcp-remote]', ...args);
      };

      log('test message');
      
      expect(consoleSpy).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Argument Parsing', () => {
    it('should extract port number from arguments', () => {
      const args = ['server', 'tcp', '--port', '8080', '--', 'node', 'server.js'];
      const portIndex = args.indexOf('--port');
      const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : undefined;
      
      expect(port).toBe(8080);
    });

    it('should extract host from arguments', () => {
      const args = ['client', 'ws', '--port', '8080', '--host', 'localhost'];
      const hostIndex = args.indexOf('--host');
      const host = hostIndex !== -1 ? args[hostIndex + 1] : undefined;
      
      expect(host).toBe('localhost');
    });

    it('should handle boolean flags', () => {
      const args = ['client', 'tcp', '--port', '8080', '--auto-reconnect'];
      const autoReconnect = args.indexOf('--auto-reconnect') !== -1;
      
      expect(autoReconnect).toBe(true);
    });

    it('should parse comma-separated roles', () => {
      const args = ['server', 'tcp', '--require-roles', 'admin,user,moderator'];
      const rolesIndex = args.indexOf('--require-roles');
      const roles = rolesIndex !== -1 ? args[rolesIndex + 1].split(',') : undefined;
      
      expect(roles).toEqual(['admin', 'user', 'moderator']);
    });

    it('should extract command and arguments after separator', () => {
      const args = ['server', 'tcp', '--port', '8080', '--', 'node', 'server.js', '--config', 'test.json'];
      const sepIndex = args.indexOf('--');
      const command = sepIndex !== -1 ? args[sepIndex + 1] : '';
      const cmdArgs = sepIndex !== -1 ? args.slice(sepIndex + 2) : [];
      
      expect(command).toBe('node');
      expect(cmdArgs).toEqual(['server.js', '--config', 'test.json']);
    });
  });

  describe('Reconnection Logic', () => {
    it('should calculate exponential backoff delay', () => {
      const calculateBackoffDelay = (attempt: number, initialDelay: number = 1000): number => {
        return Math.min(initialDelay * Math.pow(2, attempt), 30000);
      };

      expect(calculateBackoffDelay(0)).toBe(1000);
      expect(calculateBackoffDelay(1)).toBe(2000);
      expect(calculateBackoffDelay(2)).toBe(4000);
      expect(calculateBackoffDelay(3)).toBe(8000);
      expect(calculateBackoffDelay(10)).toBe(30000); // Max cap
    });

    it('should handle custom initial delay', () => {
      const calculateBackoffDelay = (attempt: number, initialDelay: number = 1000): number => {
        return Math.min(initialDelay * Math.pow(2, attempt), 30000);
      };

      expect(calculateBackoffDelay(0, 500)).toBe(500);
      expect(calculateBackoffDelay(1, 500)).toBe(1000);
      expect(calculateBackoffDelay(2, 500)).toBe(2000);
    });
  });

  describe('Protocol Validation', () => {
    it('should validate supported protocols', () => {
      const isValidProtocol = (protocol: string): protocol is 'tcp' | 'ws' => {
        return protocol === 'tcp' || protocol === 'ws';
      };

      expect(isValidProtocol('tcp')).toBe(true);
      expect(isValidProtocol('ws')).toBe(true);
      expect(isValidProtocol('http')).toBe(false);
      expect(isValidProtocol('https')).toBe(false);
      expect(isValidProtocol('')).toBe(false);
    });

    it('should validate mode', () => {
      const isValidMode = (mode: string): mode is 'server' | 'client' => {
        return mode === 'server' || mode === 'client';
      };

      expect(isValidMode('server')).toBe(true);
      expect(isValidMode('client')).toBe(true);
      expect(isValidMode('proxy')).toBe(false);
      expect(isValidMode('')).toBe(false);
    });
  });

  describe('Port Validation', () => {
    it('should validate port numbers', () => {
      const isValidPort = (port: number): boolean => {
        return Number.isInteger(port) && port > 0 && port <= 65535;
      };

      expect(isValidPort(8080)).toBe(true);
      expect(isValidPort(80)).toBe(true);
      expect(isValidPort(443)).toBe(true);
      expect(isValidPort(65535)).toBe(true);
      expect(isValidPort(0)).toBe(false);
      expect(isValidPort(-1)).toBe(false);
      expect(isValidPort(65536)).toBe(false);
      expect(isValidPort(3.14)).toBe(false);
    });
  });
});