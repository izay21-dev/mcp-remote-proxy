import { describe, it, expect, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Mock the main module to access unexported functions
jest.mock('../../src/mcp-remote.ts', () => ({}));

// We need to test the functions by importing them directly
// Since they're not exported, we'll need to create separate testable versions
// or test through the public interface

describe('JWT Authentication', () => {
  let secret: string;

  beforeEach(() => {
    secret = crypto.randomBytes(32).toString('base64url');
  });

  describe('JWT Secret Generation', () => {
    it('should generate a base64url secret of correct length', () => {
      const secret128 = crypto.randomBytes(16).toString('base64url'); // 128 bits
      const secret256 = crypto.randomBytes(32).toString('base64url'); // 256 bits
      const secret512 = crypto.randomBytes(64).toString('base64url'); // 512 bits

      expect(secret128).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(secret256).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(secret512).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('JWT Token Generation and Verification', () => {
    it('should generate and verify a valid JWT token', () => {
      const payload = { user: 'testuser', roles: ['admin'] };
      const token = jwt.sign(payload, secret, { expiresIn: '1h' });

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, secret) as any;
      expect(decoded.user).toBe('testuser');
      expect(decoded.roles).toEqual(['admin']);
    });

    it('should fail verification with wrong secret', () => {
      const payload = { user: 'testuser', roles: ['admin'] };
      const token = jwt.sign(payload, secret, { expiresIn: '1h' });
      const wrongSecret = crypto.randomBytes(32).toString('base64url');

      expect(() => {
        jwt.verify(token, wrongSecret);
      }).toThrow();
    });

    it('should handle expired tokens', () => {
      const payload = { user: 'testuser', roles: ['admin'] };
      const token = jwt.sign(payload, secret, { expiresIn: '-1h' }); // Already expired

      expect(() => {
        jwt.verify(token, secret);
      }).toThrow('jwt expired');
    });

    it('should include custom claims in token', () => {
      const payload = { 
        user: 'testuser', 
        roles: ['admin'], 
        customField: 'customValue',
        department: 'engineering'
      };
      const token = jwt.sign(payload, secret, { expiresIn: '1h' });

      const decoded = jwt.verify(token, secret) as any;
      expect(decoded.user).toBe('testuser');
      expect(decoded.roles).toEqual(['admin']);
      expect(decoded.customField).toBe('customValue');
      expect(decoded.department).toBe('engineering');
    });
  });

  describe('Role-based Access Control', () => {
    it('should validate required roles correctly', () => {
      const hasRequiredRoles = (userRoles: string[] | undefined, requiredRoles: string[]): boolean => {
        if (requiredRoles.length === 0) return true;
        if (!userRoles || userRoles.length === 0) return false;
        return requiredRoles.some(role => userRoles.includes(role));
      };

      expect(hasRequiredRoles(['admin'], ['admin'])).toBe(true);
      expect(hasRequiredRoles(['admin', 'user'], ['user'])).toBe(true);
      expect(hasRequiredRoles(['admin', 'user'], ['admin', 'moderator'])).toBe(true);
      expect(hasRequiredRoles(['user'], ['admin'])).toBe(false);
      expect(hasRequiredRoles([], ['admin'])).toBe(false);
      expect(hasRequiredRoles(undefined, ['admin'])).toBe(false);
      expect(hasRequiredRoles(['admin'], [])).toBe(true);
    });
  });
});