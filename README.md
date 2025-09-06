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

### As MCP Server

Run the server directly:
```bash
npx termux-notification-list-mcp
```

Or use the built version:
```bash
node dist/cli.js
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

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## Architecture

This MCP server follows best practices for 2025:

- **Goal-oriented tools**: Each tool accomplishes a complete task rather than just exposing low-level APIs
- **Clear descriptions**: All tools and parameters have detailed descriptions for AI agents
- **Error handling**: Robust error handling with meaningful error messages
- **State management**: Careful state management for the notification monitoring process
- **Resource cleanup**: Proper cleanup of background processes when server closes

The server uses a polling mechanism to detect new notifications by comparing current notifications with previously known ones, identifying new notifications by their unique keys.
