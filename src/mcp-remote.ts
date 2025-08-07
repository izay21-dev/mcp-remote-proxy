#!/usr/bin/env node
// mcp-remote.ts
import { spawn } from "child_process";
import net from "net";
import WebSocket, { WebSocketServer } from "ws";
import { createServer as createHttpServer } from "http";
import { Socket } from "net";
import fs from "fs";
import { generateJWTSecret, generateJWT, generateJWTWithConfig, verifyJWTWithPayload, hasRequiredRoles, JWTConfig, JWTPayload } from "./auth.js";
import { loadPermissionsConfig, parseMCPMessage, isMethodAllowed, createErrorResponse, createMessageFilter, PermissionsConfig, MCPMessage } from "./permissions.js";
import { log, calculateBackoffDelay } from "./utils.js";
import { Options } from "./types.js";





function startServer(options: Options) {
  const proc = spawn(options.command, options.args, { stdio: "pipe" });
  let permissionsConfig: PermissionsConfig | null = null;

  if (options.permissionsConfig) {
    permissionsConfig = loadPermissionsConfig(options.permissionsConfig);
    if (!permissionsConfig) {
      console.error("Failed to load permissions configuration. Exiting.");
      process.exit(1);
    }
    log("Loaded permissions configuration");
  }

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
      
      if (options.jwtSecret) {
        // Wait for JWT token from client
        socket.once("data", (data) => {
          const token = data.toString().trim();
          const { valid, payload } = verifyJWTWithPayload(token, options.jwtSecret!);
          if (valid && payload) {
            if (options.requiredRoles && !hasRequiredRoles(payload.roles, options.requiredRoles)) {
              log(`TCP client authorization failed - User: ${payload.user || "anonymous"} lacks required roles: ${options.requiredRoles.join(",")}`);
              socket.write(JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32001,
                  message: "Insufficient roles",
                  data: { required: options.requiredRoles, provided: payload.roles || [] }
                }
              }) + "\n");
              socket.end();
              return;
            }
            log(`TCP client authenticated - User: ${payload.user || "anonymous"}, Roles: ${payload.roles?.join(",") || "none"}`);
            socket.write(JSON.stringify({
              jsonrpc: "2.0",
              result: {
                authenticated: true,
                user: payload.user,
                roles: payload.roles || []
              }
            }) + "\n");
            
            const messageFilter = createMessageFilter(payload.roles || [], permissionsConfig);
            
            proc.stdout?.pipe(socket);
            
            // Filter client messages to server
            socket.on("data", (data) => {
              const result = messageFilter(data);
              if (result.allowed && result.filteredData) {
                proc.stdin?.write(result.filteredData);
              } else if (result.response) {
                socket.write(result.response);
              }
            });
          } else {
            log("TCP client authentication failed");
            socket.write(JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32002,
                message: "Authentication failed",
                data: { reason: "Invalid token" }
              }
            }) + "\n");
            socket.end();
          }
        });
      } else {
        proc.stdout?.pipe(socket);
        socket.pipe(proc.stdin!);
      }

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
      let authTimeout: NodeJS.Timeout;
      let isAuthenticated = false;
      let messageFilter: any;
      let stdoutListener: any;

      if (options.jwtSecret) {
        // Set authentication timeout
        authTimeout = setTimeout(() => {
          log("WebSocket client authentication timeout");
          ws.send(JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32003,
              message: "Authentication timeout",
              data: { timeout: "10 seconds" }
            }
          }));
          ws.close();
        }, 10000); // 10 second auth timeout

        // Handle all messages with a state machine
        ws.on("message", (msg) => {
          if (!isAuthenticated) {
            // Handle authentication
            clearTimeout(authTimeout);
            const token = msg.toString().trim();
            const { valid, payload } = verifyJWTWithPayload(token, options.jwtSecret!);
            if (valid && payload) {
              if (options.requiredRoles && !hasRequiredRoles(payload.roles, options.requiredRoles)) {
                log(`WebSocket client authorization failed - User: ${payload.user || "anonymous"} lacks required roles: ${options.requiredRoles.join(",")}`);
                ws.send(JSON.stringify({
                  jsonrpc: "2.0",
                  error: {
                    code: -32001,
                    message: "Insufficient roles",
                    data: { required: options.requiredRoles, provided: payload.roles || [] }
                  }
                }));
                ws.close();
                return;
              }
              log(`WebSocket client authenticated - User: ${payload.user || "anonymous"}, Roles: ${payload.roles?.join(",") || "none"}`);
              isAuthenticated = true;
              
              // Send auth success response first
              ws.send(JSON.stringify({
                jsonrpc: "2.0",
                result: {
                  authenticated: true,
                  user: payload.user,
                  roles: payload.roles || []
                }
              }));
              
              // Set up MCP forwarding with a small delay to ensure auth response is sent
              messageFilter = createMessageFilter(payload.roles || [], permissionsConfig);
              
              // Use setImmediate to ensure the auth response is sent before we start forwarding
              setImmediate(() => {
                stdoutListener = (data: Buffer) => {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(data);
                  }
                };
                
                proc.stdout?.on("data", stdoutListener);
              });
            } else {
              log("WebSocket client authentication failed");
              ws.send(JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32002,
                  message: "Authentication failed",
                  data: { reason: "Invalid token" }
                }
              }));
              ws.close();
            }
          } else {
            // Handle MCP messages after authentication
            try {
              const data = Buffer.from(msg.toString());
              const result = messageFilter(data);
              if (result.allowed && result.filteredData) {
                if (proc.stdin && !proc.stdin.destroyed) {
                  proc.stdin.write(result.filteredData);
                }
              } else if (result.response) {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(result.response);
                }
              }
            } catch (err) {
              log(`Error processing WebSocket message: ${err}`);
            }
          }
        });

        ws.on("close", () => {
          clearTimeout(authTimeout);
          log("WebSocket client disconnected");
          if (stdoutListener) {
            proc.stdout?.off("data", stdoutListener);
          }
        });

        ws.on("error", (err) => {
          clearTimeout(authTimeout);
          log(`WebSocket client error: ${err.message}`);
          if (stdoutListener) {
            proc.stdout?.off("data", stdoutListener);
          }
        });
      } else {
        const stdoutListener = (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        };
        const messageListener = (msg: WebSocket.RawData) => {
          try {
            const data = Buffer.isBuffer(msg) ? msg : Buffer.from(msg.toString());
            if (proc.stdin && !proc.stdin.destroyed) {
              proc.stdin.write(data);
            }
          } catch (err) {
            log(`Error processing WebSocket message: ${err}`);
          }
        };

        proc.stdout?.on("data", stdoutListener);
        ws.on("message", messageListener);

        ws.on("close", () => {
          log("WebSocket client disconnected");
          proc.stdout?.off("data", stdoutListener);
          ws.off("message", messageListener);
        });

        ws.on("error", (err) => {
          log(`WebSocket client error: ${err.message}`);
          proc.stdout?.off("data", stdoutListener);
          ws.off("message", messageListener);
        });
      }
    });

    httpServer.listen(options.port, () => {
      console.log(`MCP Remote WebSocket server listening on port ${options.port}`);
    });
  } else {
    throw new Error(`Unsupported protocol: ${options.protocol}`);
  }
}

function startClient(options: Options) {
  let reconnectAttempts = 0;
  let currentDelay = options.reconnectDelay || 1000;
  let isConnected = false;
  let shouldReconnect = true;

  function calculateCurrentBackoffDelay(attempt: number): number {
    return calculateBackoffDelay(attempt, currentDelay);
  }

  function connectTcp(): net.Socket {
    const socket = net.connect(options.port, options.host || "localhost");
    
    console.error(`[CLIENT] Initiating TCP connection to ${options.host || "localhost"}:${options.port}`);
    
    socket.on("connect", () => {
      console.error(`[CLIENT] Connected to TCP MCP server at ${options.host || "localhost"}:${options.port}`);
      
      if (options.jwtToken) {
        console.error("[CLIENT] Sending JWT token for TCP authentication");
        socket.write(options.jwtToken + "\n");
        socket.once("data", (data) => {
          const response = data.toString().trim();
          console.error(`[CLIENT] TCP authentication response: ${response}`);
          try {
            const authResult = JSON.parse(response);
            if (authResult.result && authResult.result.authenticated) {
              console.error("[CLIENT] TCP authentication successful");
              isConnected = true;
              reconnectAttempts = 0;
              currentDelay = options.reconnectDelay || 1000;
            } else {
              console.error(`[CLIENT] TCP authentication failed: ${authResult.error?.message || 'Unknown error'}`);
              socket.end();
              return;
            }
          } catch (err) {
            console.error(`[CLIENT] TCP authentication response parse error: ${err}`);
            socket.end();
            return;
          }
        });
      } else {
        console.error("[CLIENT] No JWT authentication required for TCP, connection ready");
        isConnected = true;
        reconnectAttempts = 0;
        currentDelay = options.reconnectDelay || 1000;
      }
    });

    socket.on("data", (data) => {
      const message = data.toString();
      console.error(`[CLIENT] TCP received message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
      process.stdout.write(data);
    });

    socket.on("error", (err) => {
      console.error(`[CLIENT] TCP connection error (connected: ${isConnected}): ${err.message}`);
      isConnected = false;
    });

    socket.on("close", () => {
      console.error(`[CLIENT] TCP connection closed (was connected: ${isConnected})`);
      isConnected = false;
      
      if (shouldReconnect && options.autoReconnect && reconnectAttempts < (options.maxReconnectAttempts || 5)) {
        const delay = calculateCurrentBackoffDelay(reconnectAttempts);
        console.error(`[CLIENT] TCP reconnecting in ${delay}ms... (attempt ${reconnectAttempts + 1}/${options.maxReconnectAttempts || 5})`);
        
        setTimeout(() => {
          reconnectAttempts++;
          console.error(`[CLIENT] Starting TCP reconnection attempt ${reconnectAttempts}`);
          connectTcp();
        }, delay);
      } else if (shouldReconnect && options.autoReconnect) {
        console.error("[CLIENT] TCP max reconnection attempts reached. Giving up.");
      }
    });

    // Read from stdin and send to TCP server
    process.stdin.on('data', (data) => {
      const message = data.toString();
      console.error(`[CLIENT] TCP stdin data received: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
      console.error(`[CLIENT] TCP connection state - isConnected: ${isConnected}`);
      
      if (isConnected) {
        console.error("[CLIENT] TCP sending message directly");
        socket.write(data);
      } else {
        console.error("[CLIENT] TCP not connected. Message not sent.");
        console.error("Not connected. Message not sent.");
      }
    });


    return socket;
  }

  function connectWs() {
    const ws = new WebSocket(`ws://${options.host || "localhost"}:${options.port}`, {
      handshakeTimeout: 10000, // 10 second handshake timeout
    });
    let messageQueue: string[] = [];
    let connectionTimeout: NodeJS.Timeout;

    console.error(`[CLIENT] Initiating WebSocket connection to ${options.host || "localhost"}:${options.port}`);

    // Set a connection timeout
    connectionTimeout = setTimeout(() => {
      console.error("[CLIENT] WebSocket connection timeout after 15 seconds");
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }, 15000);

    ws.on("open", () => {
      console.error(`[CLIENT] Connected to WebSocket MCP server at ${options.host || "localhost"}:${options.port}`);
      clearTimeout(connectionTimeout);
      
      if (options.jwtToken) {
        console.error("[CLIENT] Sending JWT token for authentication");
        ws.send(options.jwtToken);
        ws.once("message", (msg) => {
          const response = msg.toString().trim();
          console.error(`[CLIENT] Authentication response: ${response}`);
          try {
            const authResult = JSON.parse(response);
            if (authResult.result && authResult.result.authenticated) {
              console.error("[CLIENT] WebSocket authentication successful");
              isConnected = true;
              reconnectAttempts = 0;
              currentDelay = options.reconnectDelay || 1000;
              
              // Set up periodic ping to keep connection alive
              const pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  console.error("[CLIENT] Sending ping to keep connection alive");
                  ws.ping();
                } else {
                  clearInterval(pingInterval);
                }
              }, 30000); // Ping every 30 seconds
              
              // Send any queued messages
              if (messageQueue.length > 0) {
                console.error(`[CLIENT] Sending ${messageQueue.length} queued messages`);
                while (messageQueue.length > 0) {
                  const queuedMessage = messageQueue.shift();
                  if (queuedMessage && ws.readyState === WebSocket.OPEN) {
                    console.error(`[CLIENT] Sending queued message: ${queuedMessage.substring(0, 100)}${queuedMessage.length > 100 ? '...' : ''}`);
                    ws.send(queuedMessage);
                  }
                }
              }
            } else {
              console.error(`[CLIENT] WebSocket authentication failed: ${authResult.error?.message || 'Unknown error'}`);
              ws.close();
              return;
            }
          } catch (err) {
            console.error(`[CLIENT] WebSocket authentication response parse error: ${err}`);
            ws.close();
            return;
          }
        });
      } else {
        console.error("[CLIENT] No JWT authentication required, connection ready");
        isConnected = true;
        reconnectAttempts = 0;
        currentDelay = options.reconnectDelay || 1000;
        
        // Set up periodic ping to keep connection alive
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            console.error("[CLIENT] Sending ping to keep connection alive");
            ws.ping();
          } else {
            clearInterval(pingInterval);
          }
        }, 30000); // Ping every 30 seconds
        
        // Send any queued messages when no auth is required
        if (messageQueue.length > 0) {
          console.error(`[CLIENT] Sending ${messageQueue.length} queued messages`);
          while (messageQueue.length > 0) {
            const queuedMessage = messageQueue.shift();
            if (queuedMessage && ws.readyState === WebSocket.OPEN) {
              console.error(`[CLIENT] Sending queued message: ${queuedMessage.substring(0, 100)}${queuedMessage.length > 100 ? '...' : ''}`);
              ws.send(queuedMessage);
            }
          }
        }
      }
    });

    ws.on("message", (msg) => {
      try {
        const message = msg.toString();
        console.error(`[CLIENT] Received message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
        process.stdout.write(message);
      } catch (err) {
        console.error(`[CLIENT] Error writing to stdout: ${err}`);
      }
    });

    ws.on("pong", () => {
      console.error("[CLIENT] Received pong response");
    });

    ws.on("error", (err) => {
      console.error(`[CLIENT] WebSocket error (connected: ${isConnected}): ${err.message}`);
      console.error(`[CLIENT] WebSocket state: ${ws.readyState} (CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3)`);
      clearTimeout(connectionTimeout);
      isConnected = false;
    });

    ws.on("close", (code, reason) => {
      console.error(`[CLIENT] WebSocket connection closed (code: ${code}, reason: ${reason || 'none'}, was connected: ${isConnected})`);
      console.error(`[CLIENT] WebSocket state: ${ws.readyState}, queued messages: ${messageQueue.length}`);
      clearTimeout(connectionTimeout);
      isConnected = false;
      
      if (shouldReconnect && options.autoReconnect && reconnectAttempts < (options.maxReconnectAttempts || 5)) {
        const delay = calculateCurrentBackoffDelay(reconnectAttempts);
        console.error(`[CLIENT] Reconnecting in ${delay}ms... (attempt ${reconnectAttempts + 1}/${options.maxReconnectAttempts || 5})`);
        
        setTimeout(() => {
          reconnectAttempts++;
          console.error(`[CLIENT] Starting reconnection attempt ${reconnectAttempts}`);
          connectWs();
        }, delay);
      } else if (shouldReconnect && options.autoReconnect) {
        console.error("[CLIENT] Max reconnection attempts reached. Giving up.");
      }
    });

    // Read from stdin and send to WebSocket server
    process.stdin.on('data', (data) => {
      const message = data.toString();
      console.error(`[CLIENT] Stdin data received: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
      console.error(`[CLIENT] Connection state - isConnected: ${isConnected}, ws.readyState: ${ws.readyState}`);
      
      if (isConnected && ws.readyState === WebSocket.OPEN) {
        console.error("[CLIENT] Sending message directly");
        ws.send(message);
      } else if (ws.readyState === WebSocket.OPEN && !isConnected) {
        // Queue message during authentication or connection setup
        console.error("[CLIENT] WebSocket open but not authenticated, queueing message");
        messageQueue.push(message);
      } else {
        // Queue message when not connected - will be sent when connection is ready
        console.error(`[CLIENT] Not connected (readyState: ${ws.readyState}), queueing message`);
        messageQueue.push(message);
        console.error("Not connected. Message queued.");
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
    console.error("\nShutting down...");
    process.exit(0);
  });
}

function handleGenerateSecret(args: string[]) {
  const bitsIndex = args.indexOf("--bits");
  const bits = bitsIndex !== -1 ? parseInt(args[bitsIndex + 1], 10) : 256;
  
  if (![128, 256, 512].includes(bits)) {
    console.error("Invalid bits value. Use 128, 256, or 512.");
    process.exit(1);
  }
  
  const secret = generateJWTSecret(bits);
  console.log(`Generated JWT secret (${bits}-bit):`);
  console.log(secret);
  process.exit(0);
}

function handleGenerateToken(args: string[]) {
  const secretIndex = args.indexOf("--jwt-secret");
  const autoSecretIndex = args.indexOf("--auto-secret");
  const userIndex = args.indexOf("--user");
  const rolesIndex = args.indexOf("--roles");
  const expiresIndex = args.indexOf("--expires-in");
  
  if (secretIndex === -1 && autoSecretIndex === -1) {
    console.error("Must provide either --jwt-secret <secret> or --auto-secret");
    process.exit(1);
  }
  
  let secret: string;
  if (autoSecretIndex !== -1) {
    secret = generateJWTSecret(256);
    console.log("Generated secret:", secret);
  } else {
    secret = args[secretIndex + 1];
  }
  
  const config: JWTConfig = {
    secret,
    user: userIndex !== -1 ? args[userIndex + 1] : undefined,
    roles: rolesIndex !== -1 ? args[rolesIndex + 1].split(",") : undefined,
    expiresIn: expiresIndex !== -1 ? args[expiresIndex + 1] : "1h"
  };
  
  const token = generateJWTWithConfig(config);
  console.log(`Generated JWT token:`);
  console.log(token);
  
  // Display token info
  const { payload } = verifyJWTWithPayload(token, secret);
  if (payload) {
    console.log(`\nToken details:`);
    console.log(`- User: ${payload.user || "none"}`);
    console.log(`- Roles: ${payload.roles ? payload.roles.join(", ") : "none"}`);
    console.log(`- Expires: ${new Date(payload.exp * 1000).toISOString()}`);
  }
  
  process.exit(0);
}

async function handleGeneratePermissions(args: string[]) {
  const outputIndex = args.indexOf("--output");
  const sepIndex = args.indexOf("--");
  
  if (sepIndex === -1) {
    console.error("Must provide MCP server command after --. Usage: mcp-remote generate-permissions [--output <file>] -- <command> [args...]");
    process.exit(1);
  }
  
  const outputFile = outputIndex !== -1 ? args[outputIndex + 1] : "permissions.json";
  const command = args[sepIndex + 1];
  const cmdArgs = args.slice(sepIndex + 2);
  
  if (!command) {
    console.error("Must provide MCP server command after --");
    process.exit(1);
  }
  
  console.log(`Discovering methods from MCP server: ${command} ${cmdArgs.join(" ")}`);
  console.log(`Output file: ${outputFile}`);
  
  const discoveredMethods = new Set<string>();
  let serverReady = false;
  
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(command, cmdArgs, { stdio: "pipe" });
    let initializationSent = false;
    
    proc.on("error", (err) => {
      console.error("Failed to start MCP server:", err);
      reject(err);
    });
    
    proc.stderr?.on("data", (data) => {
      log("Server stderr:", data.toString());
    });
    
    proc.stdout?.on("data", (data) => {
      const dataStr = data.toString();
      log("Server response:", dataStr);
      
      try {
        const lines = dataStr.split('\n').filter((line: string) => line.trim());
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const message = JSON.parse(line) as MCPMessage;
            
            // Handle initialization response
            if (message.id === "init" && message.result) {
              console.log("✓ Server initialization successful");
              serverReady = true;
              
              // Send tools/list request
              const toolsListRequest = {
                jsonrpc: "2.0",
                id: "tools-list",
                method: "tools/list",
                params: {}
              };
              proc.stdin?.write(JSON.stringify(toolsListRequest) + '\n');
              discoveredMethods.add("tools/list");
              
              // Send resources/list request
              const resourcesListRequest = {
                jsonrpc: "2.0",
                id: "resources-list", 
                method: "resources/list",
                params: {}
              };
              proc.stdin?.write(JSON.stringify(resourcesListRequest) + '\n');
              discoveredMethods.add("resources/list");
              
              // Send prompts/list request
              const promptsListRequest = {
                jsonrpc: "2.0",
                id: "prompts-list",
                method: "prompts/list", 
                params: {}
              };
              proc.stdin?.write(JSON.stringify(promptsListRequest) + '\n');
              discoveredMethods.add("prompts/list");
            }
            
            // Handle tools/list response
            if (message.id === "tools-list" && message.result) {
              console.log("✓ Discovered tools/list capability");
              discoveredMethods.add("tools/call");
              if (message.result.tools && message.result.tools.length > 0) {
                console.log(`  Found ${message.result.tools.length} tools`);
              }
            }
            
            // Handle resources/list response
            if (message.id === "resources-list" && message.result) {
              console.log("✓ Discovered resources/list capability");
              discoveredMethods.add("resources/read");
              discoveredMethods.add("resources/subscribe");
              discoveredMethods.add("resources/unsubscribe");
              if (message.result.resources && message.result.resources.length > 0) {
                console.log(`  Found ${message.result.resources.length} resources`);
              }
            }
            
            // Handle prompts/list response  
            if (message.id === "prompts-list" && message.result) {
              console.log("✓ Discovered prompts/list capability");
              discoveredMethods.add("prompts/get");
              if (message.result.prompts && message.result.prompts.length > 0) {
                console.log(`  Found ${message.result.prompts.length} prompts`);
              }
            }
            
            // Check if we've collected enough information
            if (serverReady && discoveredMethods.size > 0) {
              // Add standard MCP methods
              discoveredMethods.add("ping");
              discoveredMethods.add("initialize");
              discoveredMethods.add("notifications/initialized");
              discoveredMethods.add("notifications/cancelled");
              discoveredMethods.add("notifications/progress");
              discoveredMethods.add("notifications/message");
              discoveredMethods.add("notifications/resources/updated");
              discoveredMethods.add("notifications/resources/list_changed");
              discoveredMethods.add("notifications/tools/list_changed");
              discoveredMethods.add("notifications/prompts/list_changed");
              
              // Generate permissions config
              const permissionsConfig: PermissionsConfig = {
                permissions: {
                  admin: {
                    allowedMethods: ["*"],
                    blockedMethods: []
                  }
                }
              };
              
              // Write to file
              try {
                fs.writeFileSync(outputFile, JSON.stringify(permissionsConfig, null, 2));
                console.log(`\n✓ Generated permissions file: ${outputFile}`);
                console.log(`✓ Discovered ${discoveredMethods.size} methods:`);
                const sortedMethods = Array.from(discoveredMethods).sort();
                sortedMethods.forEach(method => console.log(`  - ${method}`));
                console.log(`\n✓ Created admin role with access to all methods`);
                
                proc.kill();
                resolve();
              } catch (error) {
                console.error("Failed to write permissions file:", error);
                proc.kill();
                reject(error);
              }
            }
          } catch (parseError) {
            log("Failed to parse JSON line:", line);
          }
        }
      } catch (error) {
        log("Error processing server output:", error);
      }
      
      // Send initialization request once the server is ready
      if (!initializationSent && dataStr.includes("jsonrpc")) {
        const initRequest = {
          jsonrpc: "2.0",
          id: "init",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
              resources: {},
              prompts: {}
            },
            clientInfo: {
              name: "mcp-remote-permissions-generator",
              version: "1.0.0"
            }
          }
        };
        
        proc.stdin?.write(JSON.stringify(initRequest) + '\n');
        initializationSent = true;
        console.log("✓ Sent initialization request");
      }
    });
    
    proc.on("close", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Server process exited with code ${code}`);
        reject(new Error(`Server process exited with code ${code}`));
      }
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!serverReady || discoveredMethods.size === 0) {
        console.error("Timeout: Failed to discover methods from server");
        proc.kill();
        reject(new Error("Timeout discovering methods"));
      }
    }, 10000);
  });
}

function parseArgs(): Options {
  const args = process.argv.slice(2);

  // Handle special commands first
  if (args[0] === "generate-secret") {
    handleGenerateSecret(args);
  }
  
  if (args[0] === "generate-token") {
    handleGenerateToken(args);
  }
  
  if (args[0] === "generate-permissions") {
    // This will be handled asynchronously after parseArgs returns
    return { mode: "generate-permissions" } as any;
  }

  if (args.length < 2 || (args[0] !== "server" && args[0] !== "client")) {
    console.error("Usage: mcp-remote <server|client|generate-secret|generate-token|generate-permissions> <tcp|ws> --port <port> [--host <host>] [--auto-reconnect] [--max-attempts <n>] [--reconnect-delay <ms>] [--jwt-secret <secret>] [--jwt-token <token>] [--require-roles <role1,role2>] [--permissions-config <file>] -- <command> [args...]");
    console.error("\nSpecial commands:");
    console.error("  generate-secret [--bits <128|256|512>]");
    console.error("  generate-token --jwt-secret <secret> [--user <user>] [--roles <role1,role2>] [--expires-in <time>]");
    console.error("  generate-token --auto-secret [--user <user>] [--roles <role1,role2>] [--expires-in <time>]");
    console.error("  generate-permissions [--output <file>] -- <command> [args...]");
    process.exit(1);
  }

  const mode = args[0] as "server" | "client";
  const protocol = args[1] as "tcp" | "ws";

  const portIndex = args.indexOf("--port");
  const hostIndex = args.indexOf("--host");
  const autoReconnectIndex = args.indexOf("--auto-reconnect");
  const maxAttemptsIndex = args.indexOf("--max-attempts");
  const reconnectDelayIndex = args.indexOf("--reconnect-delay");
  const jwtSecretIndex = args.indexOf("--jwt-secret");
  const jwtTokenIndex = args.indexOf("--jwt-token");
  const requiredRolesIndex = args.indexOf("--require-roles");
  const permissionsConfigIndex = args.indexOf("--permissions-config");
  const sepIndex = args.indexOf("--");

  if (portIndex === -1 || (mode === "server" && sepIndex === -1)) {
    console.error("Missing required arguments. Usage: mcp-remote <server|client> <tcp|ws> --port <port> [--host <host>] [--auto-reconnect] [--max-attempts <n>] [--reconnect-delay <ms>] [--jwt-secret <secret>] [--jwt-token <token>] [--require-roles <role1,role2>] [--permissions-config <file>] -- <command> [args...]");
    process.exit(1);
  }

  const port = parseInt(args[portIndex + 1], 10);
  const host = hostIndex !== -1 ? args[hostIndex + 1] : undefined;
  const autoReconnect = autoReconnectIndex !== -1;
  const maxReconnectAttempts = maxAttemptsIndex !== -1 ? parseInt(args[maxAttemptsIndex + 1], 10) : 5;
  const reconnectDelay = reconnectDelayIndex !== -1 ? parseInt(args[reconnectDelayIndex + 1], 10) : 1000;
  const jwtSecret = jwtSecretIndex !== -1 ? args[jwtSecretIndex + 1] : undefined;
  const jwtToken = jwtTokenIndex !== -1 ? args[jwtTokenIndex + 1] : undefined;
  const requiredRoles = requiredRolesIndex !== -1 ? args[requiredRolesIndex + 1].split(",") : undefined;
  const permissionsConfig = permissionsConfigIndex !== -1 ? args[permissionsConfigIndex + 1] : undefined;

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
    jwtSecret,
    jwtToken,
    requiredRoles,
    permissionsConfig,
  };
}

const options = parseArgs();
if (options.mode === "server") startServer(options);
else if (options.mode === "client") startClient(options);
else if (options.mode === "generate-permissions") {
  handleGeneratePermissions(process.argv.slice(2)).then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error("Error generating permissions:", error.message);
    process.exit(1);
  });
}

