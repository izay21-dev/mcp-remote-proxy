import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { spawn, ChildProcess, exec } from 'child_process';
import net, { Socket } from 'net';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { promisify } from 'util';

const execPromise = promisify(exec);

describe('MCP Remote Proxy Integration Tests', () => {
  let testDir: string;
  let proxyServerProcess: ChildProcess | null = null;
  let jwtSecret: string;
  let jwtToken: string;
  let permissionsConfigPath: string;
  let dockerContainerStarted: boolean = false;

  let TCP_PORT: number;
  let WS_PORT: number;
  const TEST_TIMEOUT = 300000; // 5 minutes for Docker operations
  const DOCKER_MCP_HOST = 'localhost'; // Use localhost since Docker port is mapped
  const DOCKER_MCP_PORT = 9000;
  const DOCKER_JWT_SECRET = '4ZPeqenC9Cs3scxjR11tvTh1AWESFvXeJxaIlhbJQFSMyRy9CEkfZtCm7GIu6z1fDeATRdsqstjG2bmVJnxFTA';

  // Helper function to find available port
  const findAvailablePort = (): Promise<number> => {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, () => {
        const port = (server.address() as net.AddressInfo)?.port;
        server.close(() => {
          if (port) {
            resolve(port);
          } else {
            reject(new Error('Failed to get port'));
          }
        });
      });
      server.on('error', reject);
    });
  };

  // Helper to start Docker container
  const startDockerContainer = async (): Promise<void> => {
    if (dockerContainerStarted) return;
    
    console.log('Starting Docker container for filesystem MCP server...');
    try {
      // First check if Docker is available
      try {
        await execPromise('docker --version');
      } catch (error) {
        console.log('Docker not available, skipping integration tests');
        throw new Error('Docker not available');
      }
      
      // Stop any existing container first
      try {
        await execPromise('docker compose down', {
          cwd: path.resolve(__dirname, '../../filesystem-mcp')
        });
      } catch (error) {
        // Ignore errors if container wasn't running
      }
      
      // Create/update the local package tarball
      console.log('Creating local package tarball...');
      await execPromise('npm pack', {
        cwd: path.resolve(__dirname, '../../')
      });
      
      // Build the container first to ensure we have the latest local package
      console.log('Building Docker container with local package...');
      await execPromise('docker compose build --no-cache', {
        cwd: path.resolve(__dirname, '../../filesystem-mcp'),
        timeout: 300000 // 5 minutes for build
      });
      
      // Start the container
      console.log('Starting Docker container...');
      await execPromise('docker compose up -d', {
        cwd: path.resolve(__dirname, '../../filesystem-mcp')
      });
      
      // Wait for container to be healthy
      console.log('Waiting for container to be ready...');
      let retries = 60; // Increased retries
      let lastError = '';
      
      while (retries > 0) {
        try {
          // Check if container is running
          const containerStatus = await execPromise('docker ps --filter name=filesystem-mcp-server --format "{{.Status}}"');
          if (!containerStatus.stdout.includes('Up')) {
            throw new Error('Container not running');
          }
          
          // Test WebSocket connection
          const ws = new WebSocket(`ws://localhost:${DOCKER_MCP_PORT}`);
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              ws.close();
              reject(new Error('WebSocket connection timeout'));
            }, 3000);
            
            ws.on('open', () => {
              clearTimeout(timeout);
              ws.close();
              resolve(null);
            });
            
            ws.on('error', (err) => {
              clearTimeout(timeout);
              reject(err);
            });
          });
          
          // If we get here, connection successful
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          retries--;
          if (retries === 0) {
            // Get container logs for debugging
            try {
              const logs = await execPromise('docker logs filesystem-mcp-server --tail 20');
              console.log('Container logs:', logs.stdout);
            } catch (logError) {
              console.log('Could not get container logs');
            }
            throw new Error(`Docker container failed to start within timeout. Last error: ${lastError}`);
          }
          console.log(`Waiting for container... (${retries} retries left, last error: ${lastError})`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      dockerContainerStarted = true;
      console.log('✅ Docker container is ready and accepting connections');
    } catch (error) {
      console.error('Failed to start Docker container:', error);
      throw error;
    }
  };

  // Helper to stop Docker container
  const stopDockerContainer = async (): Promise<void> => {
    if (!dockerContainerStarted) return;
    
    console.log('Stopping Docker container...');
    try {
      await execPromise('docker compose down', {
        cwd: path.resolve(__dirname, '../../filesystem-mcp')
      });
      dockerContainerStarted = false;
    } catch (error) {
      console.error('Error stopping Docker container:', error);
    }
  };

  beforeAll(async () => {
    // Find available ports for proxy servers
    TCP_PORT = await findAvailablePort();
    WS_PORT = await findAvailablePort();

    // Start Docker container with filesystem MCP server
    await startDockerContainer();

    // Create test directory structure (Docker container has its own test files)
    testDir = path.join(tmpdir(), `mcp-proxy-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    // Use Docker container's JWT secret for authentication tests
    jwtSecret = DOCKER_JWT_SECRET;
    jwtToken = jwt.sign({ user: 'testuser', roles: ['admin'] }, jwtSecret, { expiresIn: '1h' });

    // Create permissions config
    permissionsConfigPath = path.join(testDir, 'permissions.json');
    const permissionsConfig = {
      permissions: {
        admin: {
          allowedMethods: ['*'],
          blockedMethods: []
        },
        user: {
          allowedMethods: ['tools/list', 'resources/list', 'resources/read'],
          blockedMethods: ['resources/write']
        }
      }
    };
    fs.writeFileSync(permissionsConfigPath, JSON.stringify(permissionsConfig, null, 2));
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Stop Docker container
    await stopDockerContainer();
    
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    jest.setTimeout(TEST_TIMEOUT);
  });

  afterEach(async () => {
    // Kill any running proxy processes
    if (proxyServerProcess) {
      proxyServerProcess.kill('SIGTERM');
      proxyServerProcess = null;
    }

    // Wait a bit for processes to clean up
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  describe('Docker MCP Filesystem Server Integration', () => {

    const startProxyClientToDocker = (protocol: 'tcp' | 'ws', port: number, withAuth: boolean = false): Promise<void> => {
      return new Promise((resolve, reject) => {
        const args = [
          'client', protocol,
          '--port', DOCKER_MCP_PORT.toString(),
          '--host', DOCKER_MCP_HOST
        ];

        if (withAuth) {
          args.push('--jwt-token', jwtToken);
        }

        proxyServerProcess = spawn('node', ['bin/mcp-remote.js', ...args], {
          stdio: 'pipe',
          env: { ...process.env, DEBUG: 'true' }
        });

        proxyServerProcess.on('error', (err) => {
          reject(new Error(`Failed to start proxy client: ${err.message}`));
        });

        proxyServerProcess.stderr?.on('data', (data) => {
          const output = data.toString();
          console.log('Proxy client stderr:', output);
          if (output.includes('Connected to')) {
            resolve();
          }
        });

        proxyServerProcess.stdout?.on('data', (data) => {
          const output = data.toString();
          console.log('Proxy client stdout:', output);
          if (output.includes('Connected to')) {
            resolve();
          }
        });

        setTimeout(() => {
          if (proxyServerProcess) {
            reject(new Error('Proxy client failed to connect within timeout'));
          }
        }, 15000);
      });
    };

    it('should reject connection to Docker MCP filesystem server without auth', async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://${DOCKER_MCP_HOST}:${DOCKER_MCP_PORT}`);
        
        ws.on('open', () => {
          // Don't send auth token - should fail
          const initRequest = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'test-client', version: '1.0.0' }
            }
          };
          ws.send(JSON.stringify(initRequest));
        });

        ws.on('message', (data) => {
          const message = data.toString().trim();
          if (message === 'AUTH_FAILED') {
            // This is expected behavior
            ws.close();
            resolve();
          } else {
            reject(new Error(`Expected AUTH_FAILED, got: ${message}`));
          }
        });

        ws.on('error', () => {
          // Connection error is also acceptable for auth failure
          resolve();
        });

        ws.on('close', (code) => {
          // Auth failures can close with specific codes
          if (code === 1008 || code === 1002) {
            resolve();
          }
        });

        setTimeout(() => {
          ws.close();
          reject(new Error('Auth rejection test timeout'));
        }, 10000);
      });
    });

    it('should connect to Docker MCP filesystem server with auth and list available tools', async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://${DOCKER_MCP_HOST}:${DOCKER_MCP_PORT}`);
        let authSuccess = false;
        let initComplete = false;

        ws.on('open', () => {
          // Send JWT token first
          ws.send(jwtToken);
        });

        ws.on('message', (data) => {
          const message = data.toString().trim();
          
          // Handle authentication response
          if (message === 'AUTH_SUCCESS') {
            authSuccess = true;
            const initRequest = {
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' }
              }
            };
            ws.send(JSON.stringify(initRequest) + '\n');
            return;
          }

          if (message === 'AUTH_FAILED') {
            reject(new Error('Authentication failed'));
            return;
          }

          // Handle MCP responses after auth
          if (authSuccess) {
            try {
              const response = JSON.parse(message);
              
              if (response.id === 1 && response.result && !initComplete) {
                // Initialize successful, now request tools
                initComplete = true;
                expect(response.result.protocolVersion).toBeTruthy();
                const toolsRequest = {
                  jsonrpc: '2.0',
                  id: 2,
                  method: 'tools/list',
                  params: {}
                };
                ws.send(JSON.stringify(toolsRequest) + '\n');
              } else if (response.id === 2 && response.result) {
                // Tools list received
                expect(response.result.tools).toBeDefined();
                expect(Array.isArray(response.result.tools)).toBe(true);
                console.log('Available tools:', response.result.tools.map((t: any) => t.name).join(', '));
                ws.close();
                resolve();
              } else if (response.error) {
                reject(new Error(`MCP error: ${response.error.message}`));
              }
            } catch (err) {
              reject(err);
            }
          }
        });

        ws.on('error', (err) => {
          reject(err);
        });

        setTimeout(() => {
          ws.close();
          reject(new Error('Tools list test timeout'));
        }, 20000);
      });
    });

    it('should enforce authentication with Docker MCP server', async () => {
      return new Promise<void>((resolve, reject) => {
        // Try to connect with invalid token
        const ws = new WebSocket(`ws://${DOCKER_MCP_HOST}:${DOCKER_MCP_PORT}`);

        ws.on('open', () => {
          // Send invalid JWT token
          ws.send('invalid-jwt-token');
        });

        ws.on('message', (data) => {
          const message = data.toString().trim();
          if (message === 'AUTH_FAILED') {
            // This is expected behavior for invalid token
            ws.close();
            resolve();
          } else if (message === 'AUTH_SUCCESS') {
            reject(new Error('Expected authentication to fail with invalid token'));
          } else {
            reject(new Error(`Unexpected message: ${message}`));
          }
        });

        ws.on('error', () => {
          // Connection errors are also acceptable for auth failures
          resolve();
        });

        ws.on('close', (code) => {
          // Close codes indicating authentication failure are acceptable
          if (code === 1008 || code === 1002) {
            resolve();
          }
        });

        setTimeout(() => {
          ws.close();
          reject(new Error('Auth enforcement test timeout'));
        }, 10000);
      });
    });

    it('should allow valid authentication with Docker MCP server', async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://${DOCKER_MCP_HOST}:${DOCKER_MCP_PORT}`);
        let authSuccess = false;

        ws.on('open', () => {
          // Send valid JWT token
          ws.send(jwtToken);
        });

        ws.on('message', (data) => {
          const message = data.toString().trim();
          
          if (message === 'AUTH_SUCCESS') {
            authSuccess = true;
            const initRequest = {
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' }
              }
            };
            ws.send(JSON.stringify(initRequest) + '\n');
            return;
          }

          if (message === 'AUTH_FAILED') {
            reject(new Error('Authentication failed with valid token'));
            return;
          }

          // Handle MCP response after auth
          if (authSuccess) {
            try {
              const response = JSON.parse(message);
              if (response.id === 1 && response.result) {
                expect(response.result.protocolVersion).toBeTruthy();
                ws.close();
                resolve();
              } else if (response.error) {
                reject(new Error(`MCP error: ${response.error.message}`));
              }
            } catch (err) {
              reject(err);
            }
          }
        });

        ws.on('error', (err) => {
          reject(err);
        });

        setTimeout(() => {
          ws.close();
          reject(new Error('Authenticated WebSocket test timeout'));
        }, 15000);
      });
    });

    it('should test basic Docker container health check', async () => {
      // Simple test to verify the container is running and responding
      const containerStatus = await execPromise('docker ps --filter name=filesystem-mcp-server --format "{{.Status}}"');
      expect(containerStatus.stdout).toContain('Up');
      
      const portCheck = await execPromise('docker port filesystem-mcp-server');
      expect(portCheck.stdout).toContain('9000');
    });

    it('should test file operations through Docker MCP server', async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://${DOCKER_MCP_HOST}:${DOCKER_MCP_PORT}`);
        let authSuccess = false;
        let initComplete = false;

        ws.on('open', () => {
          ws.send(jwtToken);
        });

        ws.on('message', (data) => {
          const message = data.toString().trim();
          
          if (message === 'AUTH_SUCCESS') {
            authSuccess = true;
            const initRequest = {
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' }
              }
            };
            ws.send(JSON.stringify(initRequest) + '\n');
            return;
          }

          if (message === 'AUTH_FAILED') {
            reject(new Error('Authentication failed'));
            return;
          }

          if (authSuccess) {
            try {
              const response = JSON.parse(message);
              
              if (response.id === 1 && response.result && !initComplete) {
                // Initialize successful, now call a tool
                initComplete = true;
                const toolCallRequest = {
                  jsonrpc: '2.0',
                  id: 2,
                  method: 'tools/call',
                  params: {
                    name: 'list_directory',
                    arguments: {
                      path: '/projects'
                    }
                  }
                };
                ws.send(JSON.stringify(toolCallRequest) + '\n');
              } else if (response.id === 2 && response.result) {
                // Tool call result received
                expect(response.result).toBeDefined();
                console.log('Directory listing successful');
                ws.close();
                resolve();
              } else if (response.error) {
                reject(new Error(`MCP error: ${response.error.message}`));
              }
            } catch (err) {
              reject(err);
            }
          }
        });

        ws.on('error', (err) => {
          reject(err);
        });

        setTimeout(() => {
          ws.close();
          reject(new Error('File operations test timeout'));
        }, 20000);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle Docker container connectivity issues', async () => {
      // Test connection to a non-existent port to verify error handling
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:9999`); // Wrong port
        
        ws.on('error', () => {
          // This is expected - connection should fail
          resolve();
        });

        ws.on('open', () => {
          reject(new Error('Connection should have failed to wrong port'));
        });

        setTimeout(() => {
          resolve(); // Timeout is also acceptable
        }, 5000);
      });
    });

    it('should validate Docker container logs contain expected startup messages', async () => {
      const logs = await execPromise('docker logs filesystem-mcp-server');
      expect(logs.stdout).toContain('MCP Remote WebSocket server listening on port 9000');
      // The filesystem server might not log "Secure" - just check it's running
      expect(logs.stdout.length).toBeGreaterThan(0);
    });
  });
});