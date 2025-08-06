FROM node:22-alpine AS release

# First ensure we have the built tarball from the current directory
COPY izay21.dev-mcp-remote-proxy-1.2.3.tgz /tmp/mcp-remote-proxy.tgz

# Install the locally built mcp-remote package globally first
RUN npm install -g /tmp/mcp-remote-proxy.tgz

# Install the filesystem MCP server from npm as a working server
RUN npm install -g @modelcontextprotocol/server-filesystem

# Create the /projects mount point
RUN mkdir -p /projects/documents /projects/code /projects/data

# Verify installation
RUN which mcp-remote
RUN which mcp-server-filesystem
