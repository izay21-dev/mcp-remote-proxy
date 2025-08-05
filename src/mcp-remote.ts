// mcp-remote.ts
import { spawn } from "child_process";
import net from "net";
import WebSocket, { WebSocketServer } from "ws";
import { createServer as createHttpServer } from "http";
import { Socket } from "net";
import readline from "readline";

interface Options {
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
}

function log(...args: any[]) {
  if (process.env.DEBUG === "true") console.log("[mcp-remote]", ...args);
}

function startServer(options: Options) {
  const proc = spawn(options.command, options.args, { stdio: "pipe" });

  proc.on("error", (err) => {
    console.error("Failed to start MCP server:", err);
    process.exit(1);
  });

  proc.stderr?.on("data", (data) => {
    process.stderr.write(data);
  });

  if (options.protocol === "tcp") {
    const server = net.createServer((socket) => {
      log("TCP client connected");
      proc.stdout?.pipe(socket);
      socket.pipe(proc.stdin!);

      socket.on("close", () => {
        log("TCP client disconnected");
      });
    });

    server.listen(options.port, () => {
      console.log(`MCP Remote TCP server listening on port ${options.port}`);
    });
  } else if (options.protocol === "ws") {
    const httpServer = createHttpServer();
    const wss = new WebSocketServer({ server: httpServer });

    wss.on("connection", (ws) => {
      log("WebSocket client connected");

      const stdoutListener = (data: Buffer) => ws.send(data);
      const messageListener = (msg: WebSocket.RawData) => proc.stdin?.write(msg);

      proc.stdout?.on("data", stdoutListener);
      ws.on("message", messageListener);

      ws.on("close", () => {
        log("WebSocket client disconnected");
        proc.stdout?.off("data", stdoutListener);
        ws.off("message", messageListener);
      });
    });

    httpServer.listen(options.port, () => {
      console.log(`MCP Remote WebSocket server listening on port ${options.port}`);
    });
  } else {
    throw new Error(`Unsupported protocol: ${options.protocol}`);
  }
}

function startClient(options: Options) {
  const rl = readline.createInterface({ input: process.stdin });
  let reconnectAttempts = 0;
  let currentDelay = options.reconnectDelay || 1000;
  let isConnected = false;
  let shouldReconnect = true;

  function calculateBackoffDelay(attempt: number): number {
    return Math.min(currentDelay * Math.pow(2, attempt), 30000);
  }

  function connectTcp(): net.Socket {
    const socket = net.connect(options.port, options.host || "localhost");
    
    socket.on("connect", () => {
      console.log(`Connected to TCP MCP server at ${options.host || "localhost"}:${options.port}`);
      isConnected = true;
      reconnectAttempts = 0;
      currentDelay = options.reconnectDelay || 1000;
    });

    socket.on("data", (data) => {
      process.stdout.write(data);
    });

    socket.on("error", (err) => {
      if (isConnected) {
        console.error(`TCP connection error: ${err.message}`);
      }
      isConnected = false;
    });

    socket.on("close", () => {
      if (isConnected) {
        console.log("TCP connection closed");
      }
      isConnected = false;
      
      if (shouldReconnect && options.autoReconnect && reconnectAttempts < (options.maxReconnectAttempts || 5)) {
        const delay = calculateBackoffDelay(reconnectAttempts);
        console.log(`Reconnecting in ${delay}ms... (attempt ${reconnectAttempts + 1}/${options.maxReconnectAttempts || 5})`);
        
        setTimeout(() => {
          reconnectAttempts++;
          connectTcp();
        }, delay);
      } else if (shouldReconnect && options.autoReconnect) {
        console.error("Max reconnection attempts reached. Giving up.");
      }
    });

    rl.on("line", (line) => {
      if (isConnected) {
        socket.write(line + "\n");
      } else {
        console.error("Not connected. Message not sent.");
      }
    });

    return socket;
  }

  function connectWs() {
    const ws = new WebSocket(`ws://${options.host || "localhost"}:${options.port}`);

    ws.on("open", () => {
      console.log(`Connected to WebSocket MCP server at ${options.host || "localhost"}:${options.port}`);
      isConnected = true;
      reconnectAttempts = 0;
      currentDelay = options.reconnectDelay || 1000;
    });

    ws.on("message", (msg) => {
      process.stdout.write(msg.toString());
    });

    ws.on("error", (err) => {
      if (isConnected) {
        console.error(`WebSocket connection error: ${err.message}`);
      }
      isConnected = false;
    });

    ws.on("close", () => {
      if (isConnected) {
        console.log("WebSocket connection closed");
      }
      isConnected = false;
      
      if (shouldReconnect && options.autoReconnect && reconnectAttempts < (options.maxReconnectAttempts || 5)) {
        const delay = calculateBackoffDelay(reconnectAttempts);
        console.log(`Reconnecting in ${delay}ms... (attempt ${reconnectAttempts + 1}/${options.maxReconnectAttempts || 5})`);
        
        setTimeout(() => {
          reconnectAttempts++;
          connectWs();
        }, delay);
      } else if (shouldReconnect && options.autoReconnect) {
        console.error("Max reconnection attempts reached. Giving up.");
      }
    });

    rl.on("line", (line) => {
      if (isConnected && ws.readyState === WebSocket.OPEN) {
        ws.send(line);
      } else {
        console.error("Not connected. Message not sent.");
      }
    });
  }

  if (options.protocol === "tcp") {
    connectTcp();
  } else if (options.protocol === "ws") {
    connectWs();
  } else {
    throw new Error(`Unsupported protocol: ${options.protocol}`);
  }

  process.on("SIGINT", () => {
    shouldReconnect = false;
    console.log("\nShutting down...");
    rl.close();
    process.exit(0);
  });
}

function parseArgs(): Options {
  const args = process.argv.slice(2);

  if (args.length < 2 || (args[0] !== "server" && args[0] !== "client")) {
    console.error("Usage: mcp-remote <server|client> <tcp|ws> --port <port> [--host <host>] [--auto-reconnect] [--max-attempts <n>] [--reconnect-delay <ms>] -- <command> [args...]");
    process.exit(1);
  }

  const mode = args[0] as "server" | "client";
  const protocol = args[1] as "tcp" | "ws";

  const portIndex = args.indexOf("--port");
  const hostIndex = args.indexOf("--host");
  const autoReconnectIndex = args.indexOf("--auto-reconnect");
  const maxAttemptsIndex = args.indexOf("--max-attempts");
  const reconnectDelayIndex = args.indexOf("--reconnect-delay");
  const sepIndex = args.indexOf("--");

  if (portIndex === -1 || (mode === "server" && sepIndex === -1)) {
    console.error("Missing required arguments. Usage: mcp-remote <server|client> <tcp|ws> --port <port> [--host <host>] [--auto-reconnect] [--max-attempts <n>] [--reconnect-delay <ms>] -- <command> [args...]");
    process.exit(1);
  }

  const port = parseInt(args[portIndex + 1], 10);
  const host = hostIndex !== -1 ? args[hostIndex + 1] : undefined;
  const autoReconnect = autoReconnectIndex !== -1;
  const maxReconnectAttempts = maxAttemptsIndex !== -1 ? parseInt(args[maxAttemptsIndex + 1], 10) : 5;
  const reconnectDelay = reconnectDelayIndex !== -1 ? parseInt(args[reconnectDelayIndex + 1], 10) : 1000;

  let command = "";
  let cmdArgs: string[] = [];
  if (mode === "server") {
    command = args[sepIndex + 1];
    cmdArgs = args.slice(sepIndex + 2);
  }

  return {
    mode,
    protocol,
    port,
    host,
    command,
    args: cmdArgs,
    debug: process.env.DEBUG === "true",
    autoReconnect,
    maxReconnectAttempts,
    reconnectDelay,
  };
}

const options = parseArgs();
if (options.mode === "server") startServer(options);
else startClient(options);

