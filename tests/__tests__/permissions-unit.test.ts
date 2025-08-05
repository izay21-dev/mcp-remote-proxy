import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'fs';
import {
  loadPermissionsConfig,
  parseMCPMessage,
  isMethodAllowed,
  createErrorResponse,
  createMessageFilter,
  PermissionsConfig,
  MCPMessage
} from '../../src/permissions';

// Mock fs module
jest.mock('fs');

describe('Permissions Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadPermissionsConfig', () => {
    it('should load valid permissions configuration', () => {
      const mockConfig: PermissionsConfig = {
        permissions: {
          admin: {
            allowedMethods: ['*'],
            blockedMethods: []
          }
        }
      };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));

      const result = loadPermissionsConfig('test-config.json');
      
      expect(result).toEqual(mockConfig);
      expect(fs.readFileSync).toHaveBeenCalledWith('test-config.json', 'utf-8');
    });

    it('should return null for invalid JSON', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

      const result = loadPermissionsConfig('test-config.json');
      
      expect(result).toBeNull();
    });

    it('should return null when file cannot be read', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File not found');
      });

      const result = loadPermissionsConfig('nonexistent.json');
      
      expect(result).toBeNull();
    });
  });

  describe('parseMCPMessage', () => {
    it('should parse valid MCP messages', () => {
      const mcpMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'test/method',
        params: { key: 'value' }
      };
      
      const data = JSON.stringify(mcpMessage);
      const result = parseMCPMessage(data);
      
      expect(result).toEqual(mcpMessage);
    });

    it('should handle multiple messages in data', () => {
      const message1 = { jsonrpc: '2.0', id: 1, method: 'method1' };
      const message2 = { jsonrpc: '2.0', id: 2, method: 'method2' };
      
      const data = JSON.stringify(message1) + '\n' + JSON.stringify(message2);
      const result = parseMCPMessage(data);
      
      expect(result).toEqual(message1); // Should return first valid message
    });

    it('should ignore non-MCP messages', () => {
      const nonMcpMessage = { version: '1.0', data: 'test' };
      const mcpMessage = { jsonrpc: '2.0', id: 1, method: 'test' };
      
      const data = JSON.stringify(nonMcpMessage) + '\n' + JSON.stringify(mcpMessage);
      const result = parseMCPMessage(data);
      
      expect(result).toEqual(mcpMessage);
    });

    it('should return null for malformed JSON', () => {
      const data = 'not valid json';
      const result = parseMCPMessage(data);
      
      expect(result).toBeNull();
    });

    it('should return null for empty data', () => {
      const result = parseMCPMessage('');
      
      expect(result).toBeNull();
    });
  });

  describe('isMethodAllowed', () => {
    const permissionsConfig: PermissionsConfig = {
      permissions: {
        admin: {
          allowedMethods: ['*'],
          blockedMethods: []
        },
        user: {
          allowedMethods: ['tools/list', 'resources/read'],
          blockedMethods: ['tools/call']
        },
        readonly: {
          allowedMethods: ['*'],
          blockedMethods: ['tools/call', 'resources/write']
        }
      }
    };

    it('should allow admin access to all methods', () => {
      expect(isMethodAllowed('any/method', ['admin'], permissionsConfig)).toBe(true);
      expect(isMethodAllowed('restricted/method', ['admin'], permissionsConfig)).toBe(true);
    });

    it('should restrict user access to allowed methods only', () => {
      expect(isMethodAllowed('tools/list', ['user'], permissionsConfig)).toBe(true);
      expect(isMethodAllowed('resources/read', ['user'], permissionsConfig)).toBe(true);
      expect(isMethodAllowed('tools/call', ['user'], permissionsConfig)).toBe(false);
      expect(isMethodAllowed('unknown/method', ['user'], permissionsConfig)).toBe(false);
    });

    it('should respect blocked methods even if wildcard allowed', () => {
      expect(isMethodAllowed('tools/call', ['readonly'], permissionsConfig)).toBe(false);
      expect(isMethodAllowed('resources/write', ['readonly'], permissionsConfig)).toBe(false);
      expect(isMethodAllowed('resources/read', ['readonly'], permissionsConfig)).toBe(true);
    });

    it('should handle multiple roles correctly', () => {
      // When user has 'user' role (blocks tools/call) AND 'admin' role (allows all), 
      // the blocked method takes precedence for security
      expect(isMethodAllowed('tools/call', ['user', 'admin'], permissionsConfig)).toBe(false);
      expect(isMethodAllowed('resources/write', ['readonly', 'admin'], permissionsConfig)).toBe(false);
      // But methods not blocked by any role should work
      expect(isMethodAllowed('tools/list', ['user', 'admin'], permissionsConfig)).toBe(true);
    });

    it('should deny access for users with no roles', () => {
      expect(isMethodAllowed('any/method', [], permissionsConfig)).toBe(false);
    });

    it('should deny access for unknown roles', () => {
      expect(isMethodAllowed('any/method', ['unknown'], permissionsConfig)).toBe(false);
    });
  });

  describe('createErrorResponse', () => {
    it('should create proper error response with ID', () => {
      const response = createErrorResponse(123, 'Access denied');
      const parsed = JSON.parse(response.trim());
      
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(123);
      expect(parsed.error.code).toBe(-32601);
      expect(parsed.error.message).toBe('Method not allowed: Access denied');
    });

    it('should handle null ID', () => {
      const response = createErrorResponse(undefined, 'Access denied');
      const parsed = JSON.parse(response.trim());
      
      expect(parsed.id).toBeNull();
    });

    it('should handle string ID', () => {
      const response = createErrorResponse('test-id', 'Access denied');
      const parsed = JSON.parse(response.trim());
      
      expect(parsed.id).toBe('test-id');
    });
  });

  describe('createMessageFilter', () => {
    const permissionsConfig: PermissionsConfig = {
      permissions: {
        user: {
          allowedMethods: ['tools/list'],
          blockedMethods: ['tools/call']
        }
      }
    };

    it('should allow messages when no permissions config', () => {
      const filter = createMessageFilter(['user'], null);
      const data = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'any/method' }));
      
      const result = filter(data);
      
      expect(result.allowed).toBe(true);
      expect(result.filteredData).toBe(data);
    });

    it('should allow permitted methods', () => {
      const filter = createMessageFilter(['user'], permissionsConfig);
      const message = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
      const data = Buffer.from(JSON.stringify(message));
      
      const result = filter(data);
      
      expect(result.allowed).toBe(true);
      expect(result.filteredData).toBe(data);
    });

    it('should block forbidden methods', () => {
      const filter = createMessageFilter(['user'], permissionsConfig);
      const message = { jsonrpc: '2.0', id: 1, method: 'tools/call' };
      const data = Buffer.from(JSON.stringify(message));
      
      const result = filter(data);
      
      expect(result.allowed).toBe(false);
      expect(result.response).toContain('Method not allowed');
    });

    it('should allow non-MCP messages', () => {
      const filter = createMessageFilter(['user'], permissionsConfig);
      const data = Buffer.from('not a json message');
      
      const result = filter(data);
      
      expect(result.allowed).toBe(true);
      expect(result.filteredData).toBe(data);
    });

    it('should allow messages without method', () => {
      const filter = createMessageFilter(['user'], permissionsConfig);
      const message = { jsonrpc: '2.0', id: 1, result: 'success' };
      const data = Buffer.from(JSON.stringify(message));
      
      const result = filter(data);
      
      expect(result.allowed).toBe(true);
      expect(result.filteredData).toBe(data);
    });
  });
});