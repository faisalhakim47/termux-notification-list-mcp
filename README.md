# Termux Notification List MCP Server

A Model Context Protocol (MCP) server that provides access to Android notifications via Termux, enabling AI agents to monitor and read Android notifications in real-time.

## Features

- **Real-time notification monitoring**: Stream new notifications as they arrive
- **Current notification retrieval**: Get a snapshot of all active notifications
- **Filtering capabilities**: Filter notifications by package name or limit results
- **Clean notification data**: Structured JSON output with all notification metadata

## Prerequisites

- **Android device** with Termux installed
- **Termux API** app installed and configured
- **Node.js 18+** in Termux environment
- Proper permissions for notification access

### Setup Termux Environment

1. Install Termux and Termux:API from F-Droid or Google Play
2. Install required packages in Termux:
   ```bash
   pkg update && pkg upgrade
   pkg install nodejs termux-api
   ```
3. Grant notification access permissions to Termux:API in Android settings

## Installation

```bash
npm install termux-notification-list-mcp
```

Or build from source:

```bash
git clone <repository-url>
cd termux-notification-list-mcp
npm install
npm run build
```

## Usage

### As MCP Server (stdio)

Run the server directly:
```bash
npx termux-notification-list-mcp
```

Or use the built version:
```bash
node dist/stdio.js
```

### As SSE Server

The package can also run as an SSE server for web-based MCP clients:

```bash
npx termux-notification-list-mcp-sse
```

Or use the built version:
```bash
node dist/sse.js
```

The SSE server listens on port 3000 by default, configurable via PORT environment variable.

### Security Configuration

The SSE server includes several security features for remote access:

#### Environment Variables

- `MCP_AUTH_TOKEN`: Bearer token for authentication (required for production)
- `MCP_BASIC_USER`: Username for HTTP Basic Authentication
- `MCP_BASIC_PASS`: Password for HTTP Basic Authentication
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins (default: `http://localhost:3000`)
- `PORT`: Server port (default: 3000)

#### Authentication

The server supports Bearer token, HTTP Basic Authentication, and query parameter authentication:

**Bearer Token Authentication:**
```bash
curl -H "Authorization: Bearer your-token" https://your-server:3000/sse
```

**Query Parameter Authentication (for EventSource/SSE):**
```bash
curl "https://your-server:3000/sse?token=your-token"
# Or in JavaScript EventSource:
# new EventSource('https://your-server:3000/sse?token=your-token')
```

**HTTP Basic Authentication:**
```bash
curl -u username:password https://your-server:3000/sse
```

Or with explicit header:
```bash
curl -H "Authorization: Basic $(echo -n 'username:password' | base64)" https://your-server:3000/sse
```

**Configuration:**
```bash
# Bearer token
export MCP_AUTH_TOKEN=your-secure-token

# Basic auth
export MCP_BASIC_USER=admin
export MCP_BASIC_PASS=secure-password
```

You can enable both authentication methods simultaneously for maximum compatibility.

#### Security Features

- **Rate Limiting**: 100 requests per 15 minutes per IP
- **CORS Protection**: Configurable allowed origins
- **Input Validation**: JSON payload validation
- **Helmet Security Headers**: XSS protection, HSTS, CSP
- **TLS 1.2+**: Strong cipher suites for HTTPS
- **Error Handling**: Secure error responses without information leakage

### Running as a Background Service in Termux

To run the SSE server indefinitely as a background service using runit:

#### Automated Setup

Run the provided setup script:
```bash
wget https://raw.githubusercontent.com/faisalhakim47/termux-notification-list-mcp/main/setup-service.sh
chmod +x setup-service.sh
./setup-service.sh
```

Note: After running the setup script, restart your Termux session or run `source $PREFIX/etc/profile` to use service management commands.

#### Manual Setup

1. Install termux-services:
   ```bash
   pkg install termux-services
   ```

2. Install the package globally:
   ```bash
   npm install -g termux-notification-list-mcp
   ```

3. Create the service directory:
   ```bash
   mkdir -p $PREFIX/var/service/termux-notification-mcp
   ```

4. Create the run script:
   ```bash
   cat > $PREFIX/var/service/termux-notification-mcp/run << 'EOF'
   #!/bin/sh
   exec termux-notification-list-mcp-sse
   EOF
   chmod +x $PREFIX/var/service/termux-notification-mcp/run
   ```

5. Enable and start the service:
   ```bash
   sv-enable termux-notification-mcp
   ```

The service will now run automatically and restart if it crashes. You can check its status with:
```bash
source $PREFIX/etc/profile  # If not already done
sv status termux-notification-mcp
```

Stop the service with:
```bash
sv down termux-notification-mcp
```

Restart the service with:
```bash
sv restart termux-notification-mcp
```

### Configuration for MCP Clients

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "termux-notifications": {
      "command": "npx",
      "args": ["termux-notification-list-mcp"]
    }
  }
}
```

For SSE clients, connect to `http://localhost:3000/sse`

## Available Tools

### `waitForNotification`

Start monitoring for new Android notifications. Returns immediately and sends notifications via server events as they arrive.

**Parameters:**
- `timeout` (optional): Number of seconds to monitor before automatically stopping

**Example:**
```typescript
// Monitor indefinitely
await client.callTool({
  name: 'waitForNotification',
  arguments: {}
});

// Monitor for 30 seconds
await client.callTool({
  name: 'waitForNotification',
  arguments: { timeout: 30 }
});
```

### `stopWaitingForNotification`

Stop monitoring for new notifications.

**Parameters:** None

**Example:**
```typescript
await client.callTool({
  name: 'stopWaitingForNotification',
  arguments: {}
});
```

### `getCurrentNotifications`

Retrieve all currently active Android notifications.

**Parameters:**
- `packageName` (optional): Filter notifications by specific app package name
- `limit` (optional): Limit the number of notifications returned (1-100)

**Example:**
```typescript
// Get all notifications
await client.callTool({
  name: 'getCurrentNotifications',
  arguments: {}
});

// Get notifications from a specific app
await client.callTool({
  name: 'getCurrentNotifications',
  arguments: { packageName: 'com.bca.mybca.omni.android' }
});

// Get first 5 notifications
await client.callTool({
  name: 'getCurrentNotifications',
  arguments: { limit: 5 }
});
```

## Notification Data Structure

Each notification contains the following fields:

```typescript
interface Notification {
  id: number;           // Unique notification ID
  tag: string;          // Notification tag
  key: string;          // Unique notification key
  group: string;        // Notification group
  packageName: string;  // App package name that created the notification
  title: string;        // Notification title
  content: string;      // Notification content/body
  when: string;         // Timestamp when notification was created
}
```

## Server Events

The server sends real-time notifications via MCP's notification system:

- **New Notification Event**: Sent when `waitForNotification` is active and a new notification arrives
- **Error Events**: Sent when monitoring encounters errors

## Best Practices

1. **Monitoring Lifecycle**: Always call `stopWaitingForNotification` when done monitoring to free resources
2. **Error Handling**: Handle cases where `termux-notification-list` command is not available
3. **Privacy**: Be mindful that this tool can access all Android notifications - implement appropriate access controls
4. **Performance**: Use `limit` parameter when you only need recent notifications

## Security Considerations

- This server provides access to all Android notifications, which may contain sensitive information
- Ensure proper authentication and authorization when deploying
- Consider implementing filtering or access controls for production use
- Follow the principle of least privilege

## Troubleshooting

### `termux-notification-list` command not found
- Ensure Termux:API is installed
- Verify `termux-api` package is installed: `pkg install termux-api`
- Check that notification permissions are granted in Android settings

### No notifications received
- Verify Termux:API has notification access permissions
- Check that there are active notifications to read
- Ensure the monitoring is actually started with `waitForNotification`

### Permission denied errors
- Grant all requested permissions to Termux:API in Android settings
- Restart Termux after granting permissions

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Running in Development

```bash
npx tsx app/cli.ts
```

## License

FSL-1.1-MIT - See LICENSE file for details.
