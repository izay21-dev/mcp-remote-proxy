import fs from "fs";

export interface RolePermissions {
  allowedMethods: string[];
  blockedMethods: string[];
  allowedParams?: Record<string, string[]>;
  blockedParams?: Record<string, string[]>;
}

export interface PermissionsConfig {
  permissions: Record<string, RolePermissions>;
}

export interface MCPMessage {
  jsonrpc: string;
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

export function loadPermissionsConfig(configPath: string): PermissionsConfig | null {
  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configData) as PermissionsConfig;
  } catch (error) {
    return null;
  }
}

export function parseMCPMessage(data: string): MCPMessage | null {
  try {
    const lines = data.split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const message = JSON.parse(line) as MCPMessage;
        if (message.jsonrpc === "2.0") {
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
}

export function isMethodAllowed(method: string, userRoles: string[], permissionsConfig: PermissionsConfig): boolean {
  if (!userRoles || userRoles.length === 0) return false;
  
  for (const role of userRoles) {
    const rolePerms = permissionsConfig.permissions[role];
    if (!rolePerms) continue;
    
    // Check if method is explicitly blocked
    if (rolePerms.blockedMethods.includes(method) || rolePerms.blockedMethods.includes("*")) {
      return false;
    }
    
    // Check if method is explicitly allowed or wildcard allowed
    if (rolePerms.allowedMethods.includes(method) || rolePerms.allowedMethods.includes("*")) {
      return true;
    }
  }
  
  return false;
}

export function createErrorResponse(id: string | number | undefined, message: string): string {
  const errorResponse = {
    jsonrpc: "2.0",
    id: id || null,
    error: {
      code: -32601,
      message: `Method not allowed: ${message}`
    }
  };
  return JSON.stringify(errorResponse) + '\n';
}

export function createMessageFilter(userRoles: string[], permissionsConfig: PermissionsConfig | null) {
  return (data: Buffer): { allowed: boolean; response?: string; filteredData?: Buffer } => {
    if (!permissionsConfig) {
      return { allowed: true, filteredData: data };
    }

    const message = parseMCPMessage(data.toString());
    if (!message || !message.method) {
      return { allowed: true, filteredData: data };
    }

    if (!isMethodAllowed(message.method, userRoles, permissionsConfig)) {
      const errorResponse = createErrorResponse(message.id, `Access denied for method '${message.method}'`);
      return { allowed: false, response: errorResponse };
    }

    return { allowed: true, filteredData: data };
  };
}