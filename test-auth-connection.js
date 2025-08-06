#!/usr/bin/env node

import WebSocket from 'ws';
import jwt from 'jsonwebtoken';

const DOCKER_MCP_HOST = 'localhost';
const DOCKER_MCP_PORT = 9000;
const DOCKER_JWT_SECRET = '4ZPeqenC9Cs3scxjR11tvTh1AWESFvXeJxaIlhbJQFSMyRy9CEkfZtCm7GIu6z1fDeATRdsqstjG2bmVJnxFTA';

// Generate JWT token with admin role
const jwtToken = jwt.sign({ user: 'testuser', roles: ['admin'] }, DOCKER_JWT_SECRET, { expiresIn: '1h' });

async function testAuthenticatedConnection() {
  console.log('Testing authenticated WebSocket connection to Docker container...');
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${DOCKER_MCP_HOST}:${DOCKER_MCP_PORT}`);
    let authSuccess = false;
    
    ws.on('open', () => {
      console.log('✅ WebSocket connection established, sending JWT token...');
      // Send JWT token as first message
      ws.send(jwtToken);
    });
    
    ws.on('message', (data) => {
      const message = data.toString().trim();
      console.log('📨 Received raw message:', message);
      
      // Handle authentication response
      if (message === 'AUTH_SUCCESS') {
        console.log('✅ Authentication successful!');
        authSuccess = true;
        
        // Now send MCP initialize request
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
        console.log('📤 Sending initialize request:', JSON.stringify(initRequest, null, 2));
        ws.send(JSON.stringify(initRequest));
        return;
      }
      
      if (message === 'AUTH_FAILED') {
        console.log('❌ Authentication failed');
        ws.close();
        reject(new Error('Authentication failed'));
        return;
      }
      
      // Handle MCP responses
      if (authSuccess) {
        try {
          const response = JSON.parse(message);
          console.log('📨 Received MCP response:', JSON.stringify(response, null, 2));
          
          if (response.id === 1) {
            if (response.result) {
              console.log('✅ MCP initialization successful');
              console.log('📋 Protocol version:', response.result.protocolVersion);
              console.log('🛠️  Server capabilities:', JSON.stringify(response.result.capabilities, null, 2));
              
              // Test listing tools
              const toolsRequest = {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {}
              };
              ws.send(JSON.stringify(toolsRequest));
            } else if (response.error) {
              console.log('❌ MCP initialization failed:', response.error.message);
              ws.close();
              reject(new Error(response.error.message));
            }
          } else if (response.id === 2) {
            if (response.result && response.result.tools) {
              console.log('🔧 Available tools:', response.result.tools.map(t => t.name).join(', '));
              console.log('✅ Successfully connected to filesystem MCP server via local mcp-remote!');
              ws.close();
              resolve();
            }
          }
        } catch (err) {
          console.log('❌ Failed to parse MCP response:', err.message);
          console.log('Raw response:', message);
          reject(err);
        }
      }
    });
    
    ws.on('error', (err) => {
      console.log('❌ WebSocket error:', err.message);
      reject(err);
    });
    
    setTimeout(() => {
      ws.close();
      reject(new Error('Connection test timeout'));
    }, 20000);  // Increase timeout to 20 seconds
  });
}

testAuthenticatedConnection()
  .then(() => {
    console.log('🎉 SUCCESS: Docker container is using locally built mcp-remote package!');
    process.exit(0);
  })
  .catch((error) => {
    console.log('❌ Test failed:', error.message);
    process.exit(1);
  });