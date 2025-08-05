export function log(...args: any[]) {
  if (process.env.DEBUG === "true") console.log("[mcp-remote]", ...args);
}

export function calculateBackoffDelay(attempt: number, initialDelay: number = 1000): number {
  return Math.min(initialDelay * Math.pow(2, attempt), 30000);
}

export function extractPortFromArgs(args: string[]): number | null {
  const portIndex = args.indexOf("--port");
  if (portIndex === -1 || portIndex + 1 >= args.length) return null;
  
  const port = parseInt(args[portIndex + 1], 10);
  return isNaN(port) ? null : port;
}

export function extractHostFromArgs(args: string[]): string | undefined {
  const hostIndex = args.indexOf("--host");
  return hostIndex !== -1 && hostIndex + 1 < args.length ? args[hostIndex + 1] : undefined;
}

export function extractBooleanFlag(args: string[], flag: string): boolean {
  return args.indexOf(flag) !== -1;
}

export function extractCommaSeparatedRoles(args: string[], flag: string): string[] | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1].split(",");
}

export function extractCommandAndArgs(args: string[]): { command: string; args: string[] } | null {
  const sepIndex = args.indexOf("--");
  if (sepIndex === -1 || sepIndex + 1 >= args.length) return null;
  
  return {
    command: args[sepIndex + 1],
    args: args.slice(sepIndex + 2)
  };
}

export function validateProtocol(protocol: string): protocol is "tcp" | "ws" {
  return protocol === "tcp" || protocol === "ws";
}

export function validateMode(mode: string): mode is "server" | "client" {
  return mode === "server" || mode === "client";
}

export function validatePort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}