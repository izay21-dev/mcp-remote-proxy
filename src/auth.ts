import jwt from "jsonwebtoken";
import crypto from "crypto";

export interface JWTConfig {
  secret: string;
  expiresIn?: string;
  user?: string;
  roles?: string[];
  customClaims?: Record<string, any>;
}

export interface JWTPayload {
  user?: string;
  roles?: string[];
  iat: number;
  exp: number;
  [key: string]: any;
}

export function generateJWTSecret(bits: number = 256): string {
  const bytes = bits / 8;
  return crypto.randomBytes(bytes).toString('base64url');
}

export function generateJWT(secret: string): string {
  return jwt.sign({ iat: Date.now() }, secret, { expiresIn: "1h" });
}

export function generateJWTWithConfig(config: JWTConfig): string {
  const payload: any = {
    ...(config.user && { user: config.user }),
    ...(config.roles && { roles: config.roles }),
    ...config.customClaims
  };

  const options: jwt.SignOptions = {
    expiresIn: config.expiresIn || "1h"
  } as jwt.SignOptions;

  return jwt.sign(payload, config.secret, options);
}

export function verifyJWT(token: string, secret: string): boolean {
  try {
    jwt.verify(token, secret);
    return true;
  } catch (error) {
    return false;
  }
}

export function verifyJWTWithPayload(token: string, secret: string): { valid: boolean; payload?: JWTPayload } {
  try {
    const decoded = jwt.verify(token, secret) as JWTPayload;
    return { valid: true, payload: decoded };
  } catch (error) {
    return { valid: false };
  }
}

export function hasRequiredRoles(userRoles: string[] | undefined, requiredRoles: string[]): boolean {
  if (requiredRoles.length === 0) return true;
  if (!userRoles || userRoles.length === 0) return false;
  
  return requiredRoles.some(role => userRoles.includes(role));
}