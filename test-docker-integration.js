#!/usr/bin/env node

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import WebSocket from 'ws';

const execPromise = promisify(exec);

const DOCKER_MCP_HOST = '192.168.22.52';
const DOCKER_MCP_PORT = 9000;
const DOCKER_JWT_SECRET = '4ZPeqenC9Cs3scxjR11tvTh1AWESFvXeJxaIlhbJQFSMyRy9CEkfZtCm7GIu6z1fDeATRdsqstjG2bmVJnxFTA';

async function startDockerContainer() {
  console.log('Starting Docker container...');
  try {
    await execPromise('docker compose -f filesystem-mcp/docker-compose.yml up -d');
    
    // Wait for container to be ready
    let retries = 30;
    while (retries > 0) {
      try {
        const ws = new WebSocket(`ws://${DOCKER_MCP_HOST}:${DOCKER_MCP_PORT}`);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Timeout'));
          }, 2000);
          
          ws.on('open', () => {
            clearTimeout(timeout);
            ws.close();
            resolve();
          });
          
          ws.on('error', () => {
            clearTimeout(timeout);
            reject(new Error('Connection failed'));
          });
        });
        break;
      } catch (err) {
        retries--;
        if (retries === 0) {
          throw new Error('Docker container failed to start within timeout');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('Docker container is ready');
    return true;
  } catch (error) {
    console.error('Failed to start Docker container:', error.message);
    return false;
  }
}

async function testBasicConnection() {
  console.log('Testing basic WebSocket connection...');
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${DOCKER_MCP_HOST}:${DOCKER_MCP_PORT}`);
    
    ws.on('open', () => {
      console.log('✅ WebSocket connection established');
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
      try {
        const response = JSON.parse(data.toString());
        if (response.id === 1) {
          if (response.result) {
            console.log('✅ MCP initialization successful');
            console.log('Protocol version:', response.result.protocolVersion);
            ws.close();
            resolve();
          } else if (response.error) {
            console.log('❌ MCP initialization failed:', response.error.message);
            ws.close();
            reject(new Error(response.error.message));
          }
        }
      } catch (err) {
        console.log('❌ Failed to parse response:', err.message);
        reject(err);
      }
    });
    
    ws.on('error', (err) => {
      console.log('❌ WebSocket error:', err.message);
      reject(err);
    });
    
    setTimeout(() => {
      ws.close();
      reject(new Error('Connection test timeout'));
    }, 10000);
  });
}

async function stopDockerContainer() {
  console.log('Stopping Docker container...');
  try {
    await execPromise('docker compose -f filesystem-mcp/docker-compose.yml down');
    console.log('Docker container stopped');
  } catch (error) {
    console.error('Failed to stop Docker container:', error.message);
  }
}

async function main() {
  try {
    const started = await startDockerContainer();
    if (!started) {
      console.log('❌ Docker container setup failed');
      return;
    }
    
    await testBasicConnection();
    console.log('✅ Integration test passed!');
    
  } catch (error) {
    console.log('❌ Integration test failed:', error.message);
  } finally {
    await stopDockerContainer();
  }
}

main().catch(console.error);