import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { 
  generateJWTSecret, 
  generateJWT, 
  generateJWTWithConfig, 
  verifyJWT, 
  verifyJWTWithPayload,
  hasRequiredRoles,
  JWTConfig
} from '../../src/auth';

describe('Auth Module', () => {
  describe('generateJWTSecret', () => {
    it('should generate a 256-bit secret by default', () => {
      const secret = generateJWTSecret();
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(0);
    });

    it('should generate secrets of different bit sizes', () => {
      const secret128 = generateJWTSecret(128);
      const secret256 = generateJWTSecret(256);
      const secret512 = generateJWTSecret(512);
      
      expect(secret128).not.toBe(secret256);
      expect(secret256).not.toBe(secret512);
    });
  });

  describe('generateJWT', () => {
    it('should generate a valid JWT token', () => {
      const secret = 'test-secret';
      const token = generateJWT(secret);
      
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });
  });

  describe('generateJWTWithConfig', () => {
    it('should generate JWT with user and roles', () => {
      const config: JWTConfig = {
        secret: 'test-secret',
        user: 'testuser',
        roles: ['admin', 'user'],
        expiresIn: '1h'
      };
      
      const token = generateJWTWithConfig(config);
      const decoded = jwt.decode(token) as any;
      
      expect(decoded.user).toBe('testuser');
      expect(decoded.roles).toEqual(['admin', 'user']);
    });

    it('should include custom claims', () => {
      const config: JWTConfig = {
        secret: 'test-secret',
        customClaims: { department: 'engineering', level: 'senior' }
      };
      
      const token = generateJWTWithConfig(config);
      const decoded = jwt.decode(token) as any;
      
      expect(decoded.department).toBe('engineering');
      expect(decoded.level).toBe('senior');
    });
  });

  describe('verifyJWT', () => {
    it('should verify valid tokens', () => {
      const secret = 'test-secret';
      const token = generateJWT(secret);
      
      expect(verifyJWT(token, secret)).toBe(true);
    });

    it('should reject invalid tokens', () => {
      const secret = 'test-secret';
      const wrongSecret = 'wrong-secret';
      const token = generateJWT(secret);
      
      expect(verifyJWT(token, wrongSecret)).toBe(false);
    });

    it('should reject malformed tokens', () => {
      const secret = 'test-secret';
      const malformedToken = 'not.a.valid.jwt';
      
      expect(verifyJWT(malformedToken, secret)).toBe(false);
    });
  });

  describe('verifyJWTWithPayload', () => {
    it('should return payload for valid tokens', () => {
      const secret = 'test-secret';
      const config: JWTConfig = {
        secret,
        user: 'testuser',
        roles: ['admin']
      };
      const token = generateJWTWithConfig(config);
      
      const result = verifyJWTWithPayload(token, secret);
      
      expect(result.valid).toBe(true);
      expect(result.payload?.user).toBe('testuser');
      expect(result.payload?.roles).toEqual(['admin']);
    });

    it('should return invalid for bad tokens', () => {
      const secret = 'test-secret';
      const badToken = 'invalid-token';
      
      const result = verifyJWTWithPayload(badToken, secret);
      
      expect(result.valid).toBe(false);
      expect(result.payload).toBeUndefined();
    });
  });

  describe('hasRequiredRoles', () => {
    it('should return true when user has required roles', () => {
      const userRoles = ['admin', 'user'];
      const requiredRoles = ['admin'];
      
      expect(hasRequiredRoles(userRoles, requiredRoles)).toBe(true);
    });

    it('should return false when user lacks required roles', () => {
      const userRoles = ['user'];
      const requiredRoles = ['admin'];
      
      expect(hasRequiredRoles(userRoles, requiredRoles)).toBe(false);
    });

    it('should return true when no roles are required', () => {
      const userRoles = ['user'];
      const requiredRoles: string[] = [];
      
      expect(hasRequiredRoles(userRoles, requiredRoles)).toBe(true);
    });

    it('should return false when user has no roles but roles are required', () => {
      const userRoles: string[] = [];
      const requiredRoles = ['admin'];
      
      expect(hasRequiredRoles(userRoles, requiredRoles)).toBe(false);
    });

    it('should return false when user roles is undefined', () => {
      const userRoles = undefined;
      const requiredRoles = ['admin'];
      
      expect(hasRequiredRoles(userRoles, requiredRoles)).toBe(false);
    });
  });
});