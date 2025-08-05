export interface Options {
  protocol: "tcp" | "ws";
  port: number;
  command: string;
  args: string[];
  debug?: boolean;
  mode: "server" | "client";
  host?: string; // for client mode
  autoReconnect?: boolean; // for client mode
  maxReconnectAttempts?: number; // for client mode
  reconnectDelay?: number; // initial delay in ms
  jwtSecret?: string; // JWT secret for authentication
  jwtToken?: string; // JWT token for client authentication
  requiredRoles?: string[]; // Required roles for server access
  permissionsConfig?: string; // Path to permissions configuration file
}