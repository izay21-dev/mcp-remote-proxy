# MCP Remote Proxy

A TypeScript CLI tool that creates a proxy for MCP (Model Context Protocol) servers, exposing them over TCP or WebSocket connections with JWT authentication and role-based access control.

## Features

- **Protocol Support**: TCP and WebSocket protocols
- **JWT Authentication**: Secure token-based authentication
- **Role-Based Access Control**: Fine-grained permissions for different user types
- **Auto-Reconnection**: Client auto-reconnect with exponential backoff
- **JWT Token Management**: Built-in secret generation and token creation tools
- **Request Filtering**: Method-level access control based on user roles
- **Audit Logging**: Debug logging for security events and blocked requests

## Installation

```bash
npm install
npm run build
```

## Quick Start

### 1. Generate JWT Secret

```bash
# Generate a 256-bit secure secret
mcp-remote generate-secret --bits 256
```

### 2. Create JWT Tokens with Roles

```bash
# Create admin token (full access)
mcp-remote generate-token --jwt-secret "your-secret" --user "admin" --roles "admin" --expires-in "24h"

# Create normal user token (limited access)
mcp-remote generate-token --jwt-secret "your-secret" --user "editor" --roles "user" --expires-in "12h"

# Create readonly token (read-only access)
mcp-remote generate-token --jwt-secret "your-secret" --user "viewer" --roles "readonly" --expires-in "8h"

# Auto-generate secret and token together
mcp-remote generate-token --auto-secret --user "admin" --roles "admin" --expires-in "24h"
```

### 3. Start Server with Role-Based Permissions

```bash
# Basic server with JWT authentication
mcp-remote server tcp --port 8080 --jwt-secret "your-secret" -- your-mcp-server

# Server with role requirements
mcp-remote server tcp --port 8080 --jwt-secret "your-secret" --require-roles "admin,user" -- your-mcp-server

# Server with fine-grained permissions
mcp-remote server tcp --port 8080 --jwt-secret "your-secret" --permissions-config "permissions.json" -- your-mcp-server
```

### 4. Connect Clients

```bash
# Connect with JWT token
mcp-remote client tcp --port 8080 --jwt-token "your-jwt-token"

# Connect with auto-reconnection
mcp-remote client tcp --port 8080 --jwt-token "your-jwt-token" --auto-reconnect --max-attempts 10
```

## Usage

### Server Mode

Start an MCP server and expose it over network:

```bash
# TCP Server
mcp-remote server tcp --port 8080 [options] -- <mcp-server-command> [args...]

# WebSocket Server  
mcp-remote server ws --port 8080 [options] -- <mcp-server-command> [args...]
```

**Server Options:**
- `--port <port>` - Port to listen on (required)
- `--jwt-secret <secret>` - JWT secret for authentication
- `--require-roles <role1,role2>` - Required roles for connection
- `--permissions-config <file>` - Path to permissions configuration file

### Client Mode

Connect to a remote MCP proxy server:

```bash
# TCP Client
mcp-remote client tcp --port 8080 [options]

# WebSocket Client
mcp-remote client ws --port 8080 [options]
```

**Client Options:**
- `--port <port>` - Port to connect to (required)
- `--host <host>` - Host to connect to (default: localhost)
- `--jwt-token <token>` - JWT token for authentication
- `--auto-reconnect` - Enable automatic reconnection
- `--max-attempts <n>` - Maximum reconnection attempts (default: 5)
- `--reconnect-delay <ms>` - Initial reconnection delay (default: 1000ms)

### JWT Management

#### Generate Secure Secrets

```bash
# Generate 128-bit secret
mcp-remote generate-secret --bits 128

# Generate 256-bit secret (default)
mcp-remote generate-secret --bits 256

# Generate 512-bit secret
mcp-remote generate-secret --bits 512
```

#### Generate JWT Tokens

```bash
# Basic token
mcp-remote generate-token --jwt-secret "your-secret"

# Token with user info and roles
mcp-remote generate-token --jwt-secret "your-secret" --user "alice" --roles "admin,user" --expires-in "24h"

# Token with custom expiration
mcp-remote generate-token --jwt-secret "your-secret" --expires-in "7d"

# Auto-generate secret and token
mcp-remote generate-token --auto-secret --user "admin" --expires-in "12h"
```

**Expiration formats**: `60s`, `30m`, `12h`, `7d`, `1y`

## Role-Based Access Control

### Permissions Configuration

Create a `permissions.json` file to define role-based access:

```json
{
  "permissions": {
    "readonly": {
      "allowedMethods": [
        "ping",
        "initialize", 
        "tools/list",
        "resources/list",
        "resources/read",
        "prompts/list",
        "prompts/get"
      ],
      "blockedMethods": [
        "tools/call",
        "resources/write",
        "resources/delete"
      ]
    },
    "user": {
      "allowedMethods": [
        "ping",
        "initialize",
        "tools/list", 
        "tools/call",
        "resources/list",
        "resources/read",
        "prompts/list",
        "prompts/get",
        "notifications/initialized"
      ],
      "blockedMethods": [
        "resources/write",
        "resources/delete"
      ]
    },
    "admin": {
      "allowedMethods": ["*"],
      "blockedMethods": []
    }
  }
}
```

### Role Definitions

- **readonly**: Can list and read resources, tools, and prompts
- **user**: Can execute tools and perform most operations except write/delete
- **admin**: Full access to all methods (wildcard `*`)

### How It Works

1. **Authentication**: JWT tokens are validated on connection
2. **Authorization**: Each MCP request is checked against role permissions
3. **Filtering**: Blocked requests return JSON-RPC error responses
4. **Logging**: Security events are logged when `DEBUG=true`

## Examples

### Complete Workflow

```bash
# 1. Generate a secure secret
SECRET=$(mcp-remote generate-secret --bits 256)
echo "Secret: $SECRET"

# 2. Create tokens for different users
ADMIN_TOKEN=$(mcp-remote generate-token --jwt-secret "$SECRET" --user "admin" --roles "admin" --expires-in "24h" | grep "Generated JWT token:" -A1 | tail -1)
USER_TOKEN=$(mcp-remote generate-token --jwt-secret "$SECRET" --user "editor" --roles "user" --expires-in "12h" | grep "Generated JWT token:" -A1 | tail -1)
READONLY_TOKEN=$(mcp-remote generate-token --jwt-secret "$SECRET" --user "viewer" --roles "readonly" --expires-in "8h" | grep "Generated JWT token:" -A1 | tail -1)

# 3. Start server with permissions
mcp-remote server tcp --port 8080 --jwt-secret "$SECRET" --permissions-config "permissions.json" -- npx @modelcontextprotocol/server-filesystem /path/to/files

# 4. Connect different users (in separate terminals)
mcp-remote client tcp --port 8080 --jwt-token "$ADMIN_TOKEN"     # Full access
mcp-remote client tcp --port 8080 --jwt-token "$USER_TOKEN"     # Limited access  
mcp-remote client tcp --port 8080 --jwt-token "$READONLY_TOKEN" # Read-only access
```

### Different User Experiences

**Admin User**:
- Can call any MCP method
- Full read/write access
- Can execute tools, modify resources

**Regular User**: 
- Can list and read resources
- Can execute tools  
- Cannot write or delete resources

**Readonly User**:
- Can list and read resources
- Cannot execute tools
- Cannot modify anything

### Error Handling

When a user tries to access a blocked method:

```json
{
  "jsonrpc": "2.0",
  "id": 123, 
  "error": {
    "code": -32601,
    "message": "Method not allowed: Access denied for method 'tools/call'"
  }
}
```

## Development

### Commands

```bash
npm run build    # Compile TypeScript
npm start        # Run the compiled binary  
tsc             # Direct TypeScript compilation
```

### Debug Mode

Enable debug logging:

```bash
DEBUG=true mcp-remote server tcp --port 8080 --jwt-secret "secret" -- your-mcp-server
```

This will log:
- Client connections/disconnections
- Authentication events
- Blocked requests with user roles
- Permission checks

### Architecture

- **Single File**: All functionality in `src/mcp-remote.ts`
- **ES Modules**: Modern JavaScript module system
- **TypeScript**: Compiled to `bin/mcp-remote.js`
- **Dependencies**: `ws` for WebSocket, `jsonwebtoken` for JWT

## Security Features

- **JWT Authentication**: Industry-standard token-based auth
- **Role-Based Access**: Granular permission control
- **Method Filtering**: Request-level access control  
- **Audit Logging**: Security event tracking
- **Token Expiration**: Configurable token lifetimes
- **Secure Secrets**: Cryptographically secure secret generation

## License

MIT
