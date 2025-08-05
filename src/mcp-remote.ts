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

  if (options.protocol === "tcp") {
    const socket = net.connect(options.port, options.host || "localhost", () => {
      console.log(`Connected to TCP MCP server at ${options.host}:${options.port}`);
    });

    socket.pipe(process.stdout);
    rl.on("line", (line) => {
      socket.write(line + "\n");
    });
  } else if (options.protocol === "ws") {
    const ws = new WebSocket(`ws://${options.host || "localhost"}:${options.port}`);

    ws.on("open", () => {
      console.log(`Connected to WebSocket MCP server at ${options.host}:${options.port}`);
    });

    ws.on("message", (msg) => {
      process.stdout.write(msg.toString());
    });

    rl.on("line", (line) => {
      ws.send(line);
    });
  } else {
    throw new Error(`Unsupported protocol: ${options.protocol}`);
  }
}

function parseArgs(): Options {
  const args = process.argv.slice(2);

  if (args.length < 2 || (args[0] !== "server" && args[0] !== "client")) {
    console.error("Usage: mcp-remote <server|client> <tcp|ws> --port <port> [--host <host>] -- <command> [args...]");
    process.exit(1);
  }

  const mode = args[0] as "server" | "client";
  const protocol = args[1] as "tcp" | "ws";

  const portIndex = args.indexOf("--port");
  const hostIndex = args.indexOf("--host");
  const sepIndex = args.indexOf("--");

  if (portIndex === -1 || (mode === "server" && sepIndex === -1)) {
    console.error("Missing required arguments. Usage: mcp-remote <server|client> <tcp|ws> --port <port> [--host <host>] -- <command> [args...]");
    process.exit(1);
  }

  const port = parseInt(args[portIndex + 1], 10);
  const host = hostIndex !== -1 ? args[hostIndex + 1] : undefined;

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
  };
}

const options = parseArgs();
if (options.mode === "server") startServer(options);
else startClient(options);

