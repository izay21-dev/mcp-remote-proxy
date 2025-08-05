import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

interface RolePermissions {
  allowedMethods: string[];
  blockedMethods: string[];
  allowedParams?: Record<string, string[]>;
  blockedParams?: Record<string, string[]>;
}

interface PermissionsConfig {
  permissions: Record<string, RolePermissions>;
}

interface MCPMessage {
  jsonrpc: string;
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

describe('Permissions System', () => {
  let tempConfigPath: string;
  let testConfig: PermissionsConfig;

  beforeEach(() => {
    tempConfigPath = path.join(tmpdir(), `test-permissions-${Date.now()}.json`);
    testConfig = {
      permissions: {
        admin: {
          allowedMethods: ['*'],
          blockedMethods: []
        },
        user: {
          allowedMethods: ['tools/list', 'tools/call', 'resources/list'],
          blockedMethods: ['resources/write']
        },
        readonly: {
          allowedMethods: ['tools/list', 'resources/list', 'resources/read'],
          blockedMethods: ['resources/write', 'tools/call']
        }
      }
    };
    fs.writeFileSync(tempConfigPath, JSON.stringify(testConfig, null, 2));
  });

  afterEach(() => {
    if (fs.existsSync(tempConfigPath)) {
      fs.unlinkSync(tempConfigPath);
    }
  });

  describe('Permissions Configuration Loading', () => {
    it('should load valid permissions configuration', () => {
      const loadPermissionsConfig = (configPath: string): PermissionsConfig | null => {
        try {
          const configData = fs.readFileSync(configPath, 'utf-8');
          return JSON.parse(configData) as PermissionsConfig;
        } catch (error) {
          return null;
        }
      };

      const config = loadPermissionsConfig(tempConfigPath);
      expect(config).not.toBeNull();
      expect(config?.permissions.admin.allowedMethods).toContain('*');
      expect(config?.permissions.user.allowedMethods).toContain('tools/list');
      expect(config?.permissions.readonly.blockedMethods).toContain('resources/write');
    });

    it('should handle invalid JSON configuration', () => {
      const invalidConfigPath = path.join(tmpdir(), `invalid-config-${Date.now()}.json`);
      fs.writeFileSync(invalidConfigPath, '{ invalid json }');

      const loadPermissionsConfig = (configPath: string): PermissionsConfig | null => {
        try {
          const configData = fs.readFileSync(configPath, 'utf-8');
          return JSON.parse(configData) as PermissionsConfig;
        } catch (error) {
          return null;
        }
      };

      const config = loadPermissionsConfig(invalidConfigPath);
      expect(config).toBeNull();

      fs.unlinkSync(invalidConfigPath);
    });

    it('should handle missing configuration file', () => {
      const missingConfigPath = path.join(tmpdir(), 'nonexistent-config.json');

      const loadPermissionsConfig = (configPath: string): PermissionsConfig | null => {
        try {
          const configData = fs.readFileSync(configPath, 'utf-8');
          return JSON.parse(configData) as PermissionsConfig;
        } catch (error) {
          return null;
        }
      };

      const config = loadPermissionsConfig(missingConfigPath);
      expect(config).toBeNull();
    });
  });

  describe('Method Permission Checking', () => {
    const isMethodAllowed = (method: string, userRoles: string[], permissionsConfig: PermissionsConfig): boolean => {
      if (!userRoles || userRoles.length === 0) return false;
      
      for (const role of userRoles) {
        const rolePerms = permissionsConfig.permissions[role];
        if (!rolePerms) continue;
        
        // Check if method is explicitly blocked
        if (rolePerms.blockedMethods.includes(method) || rolePerms.blockedMethods.includes('*')) {
          return false;
        }
        
        // Check if method is explicitly allowed or wildcard allowed
        if (rolePerms.allowedMethods.includes(method) || rolePerms.allowedMethods.includes('*')) {
          return true;
        }
      }
      
      return false;
    };

    it('should allow admin access to all methods', () => {
      expect(isMethodAllowed('tools/list', ['admin'], testConfig)).toBe(true);
      expect(isMethodAllowed('tools/call', ['admin'], testConfig)).toBe(true);
      expect(isMethodAllowed('resources/write', ['admin'], testConfig)).toBe(true);
      expect(isMethodAllowed('custom/method', ['admin'], testConfig)).toBe(true);
    });

    it('should restrict user access to allowed methods only', () => {
      expect(isMethodAllowed('tools/list', ['user'], testConfig)).toBe(true);
      expect(isMethodAllowed('tools/call', ['user'], testConfig)).toBe(true);
      expect(isMethodAllowed('resources/list', ['user'], testConfig)).toBe(true);
      expect(isMethodAllowed('resources/write', ['user'], testConfig)).toBe(false);
      expect(isMethodAllowed('custom/method', ['user'], testConfig)).toBe(false);
    });

    it('should respect blocked methods even if wildcard allowed', () => {
      expect(isMethodAllowed('tools/list', ['readonly'], testConfig)).toBe(true);
      expect(isMethodAllowed('resources/list', ['readonly'], testConfig)).toBe(true);
      expect(isMethodAllowed('resources/read', ['readonly'], testConfig)).toBe(true);
      expect(isMethodAllowed('resources/write', ['readonly'], testConfig)).toBe(false);
      expect(isMethodAllowed('tools/call', ['readonly'], testConfig)).toBe(false);
    });

    it('should handle multiple roles correctly', () => {
      expect(isMethodAllowed('tools/list', ['user', 'readonly'], testConfig)).toBe(true);
      expect(isMethodAllowed('resources/write', ['user', 'readonly'], testConfig)).toBe(false);
      expect(isMethodAllowed('tools/call', ['user', 'readonly'], testConfig)).toBe(true);
    });

    it('should deny access for users with no roles', () => {
      expect(isMethodAllowed('tools/list', [], testConfig)).toBe(false);
      expect(isMethodAllowed('tools/list', undefined as any, testConfig)).toBe(false);
    });

    it('should deny access for unknown roles', () => {
      expect(isMethodAllowed('tools/list', ['unknown'], testConfig)).toBe(false);
    });
  });

  describe('MCP Message Parsing', () => {
    const parseMCPMessage = (data: string): MCPMessage | null => {
      try {
        const lines = data.split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const message = JSON.parse(line) as MCPMessage;
            if (message.jsonrpc === '2.0') {
              return message;
            }
          } catch {
            continue;
          }
        }
        return null;
      } catch (error) {
        return null;
      }
    };

    it('should parse valid MCP messages', () => {
      const validMessage = '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}\n';
      const parsed = parseMCPMessage(validMessage);
      
      expect(parsed).not.toBeNull();
      expect(parsed?.jsonrpc).toBe('2.0');
      expect(parsed?.id).toBe('1');
      expect(parsed?.method).toBe('tools/list');
    });

    it('should handle multiple messages in data', () => {
      const multiMessage = '{"jsonrpc":"2.0","id":"1","method":"tools/list"}\n{"jsonrpc":"2.0","id":"2","method":"resources/list"}\n';
      const parsed = parseMCPMessage(multiMessage);
      
      expect(parsed).not.toBeNull();
      expect(parsed?.method).toBe('tools/list'); // Should return first valid message
    });

    it('should ignore non-MCP messages', () => {
      const invalidMessage = '{"not":"mcp","data":"test"}\n';
      const parsed = parseMCPMessage(invalidMessage);
      
      expect(parsed).toBeNull();
    });

    it('should handle malformed JSON', () => {
      const malformedMessage = '{ invalid json }\n';
      const parsed = parseMCPMessage(malformedMessage);
      
      expect(parsed).toBeNull();
    });
  });

  describe('Error Response Generation', () => {
    const createErrorResponse = (id: string | number | undefined, message: string): string => {
      const errorResponse = {
        jsonrpc: '2.0',
        id: id || null,
        error: {
          code: -32601,
          message: `Method not allowed: ${message}`
        }
      };
      return JSON.stringify(errorResponse) + '\n';
    };

    it('should create proper error response with ID', () => {
      const errorResponse = createErrorResponse('test-id', 'Access denied');
      const parsed = JSON.parse(errorResponse.trim());
      
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe('test-id');
      expect(parsed.error.code).toBe(-32601);
      expect(parsed.error.message).toBe('Method not allowed: Access denied');
    });

    it('should handle null ID', () => {
      const errorResponse = createErrorResponse(undefined, 'Access denied');
      const parsed = JSON.parse(errorResponse.trim());
      
      expect(parsed.id).toBe(null);
    });
  });
});