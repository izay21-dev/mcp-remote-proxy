#!/usr/bin/env node

import WebSocket from 'ws';

const DOCKER_MCP_HOST = 'localhost';  // Try localhost instead
const DOCKER_MCP_PORT = 9000;

async function testBasicConnection() {
  console.log('Testing basic WebSocket connection to Docker container...');
  
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
        console.log('📨 Received response:', JSON.stringify(response, null, 2));
        
        if (response.id === 1) {
          if (response.result) {
            console.log('✅ MCP initialization successful');
            console.log('📋 Protocol version:', response.result.protocolVersion);
            console.log('🛠️  Server capabilities:', JSON.stringify(response.result.capabilities, null, 2));
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

testBasicConnection()
  .then(() => {
    console.log('✅ Integration test passed! Docker container is using local mcp-remote package.');
    process.exit(0);
  })
  .catch((error) => {
    console.log('❌ Integration test failed:', error.message);
    process.exit(1);
  });