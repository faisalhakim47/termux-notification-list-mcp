import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NotificationMonitor, Notification } from './notification-monitor.js';
import { TermuxNotificationMonitor } from './termux-notification-monitor.js';
import { stderr } from 'process';

export function createTermuxNotificationListMcpServer(notificationMonitor?: NotificationMonitor): McpServer {
  // Use the provided monitor or create a default TermuxNotificationMonitor
  const monitor = notificationMonitor || new TermuxNotificationMonitor();
  const server = new McpServer({
    version: '1.0.0',
    name: 'termux-notification-list-mcp',
    title: 'Termux Notification List MCP',
  }, {
    capabilities: {
      logging: {}
    }
  });

  // Tool: Start waiting for new notifications
  server.registerTool(
    'waitForNotification',
    {
      title: 'Wait for New Notification',
      description: 'Start monitoring for new Android notifications via Termux. This will continuously watch for new notifications and stream them as they arrive.',
      inputSchema: {
        timeout: z.number()
          .optional()
          .describe('Optional timeout in seconds. If provided, monitoring will stop after this duration.'),
      },
    },
    async ({ timeout }) => {
      try {
        // Start monitoring if not already started
        await monitor.startMonitoring();

        // Set up timeout if provided
        let timeoutHandle: NodeJS.Timeout | null = null;
        if (timeout && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            monitor.stopMonitoring();
          }, timeout * 1000);
        }

        return {
          content: [
            {
              type: 'text',
              text: timeout
                ? `Started monitoring for new notifications. Will automatically stop after ${timeout} second${timeout === 1 ? '' : 's'}.`
                : 'Started monitoring for new notifications. Use stopWaitingForNotification to stop monitoring.'
            }
          ]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Failed to start notification monitoring: ${errorMessage}`
            }
          ],
          isError: true
        };
      }
    }
  );

  // Tool: Stop waiting for notifications
  server.registerTool(
    'stopWaitingForNotification',
    {
      title: 'Stop Waiting for Notifications',
      description: 'Stop monitoring for new Android notifications. This will end the notification monitoring process.',
      inputSchema: {},
    },
    async () => {
      try {
        monitor.stopMonitoring();
        return {
          content: [
            {
              type: 'text',
              text: 'Stopped monitoring for new notifications.'
            }
          ]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Failed to stop notification monitoring: ${errorMessage}`
            }
          ],
          isError: true
        };
      }
    }
  );

  // Tool: Get current notifications
  server.registerTool(
    'getCurrentNotifications',
    {
      title: 'Get Current Notifications',
      description: 'Retrieve all currently active Android notifications via Termux. Returns a snapshot of all notifications currently in the notification panel.',
      inputSchema: {
        packageName: z.string()
          .optional()
          .describe('Optional package name to filter notifications by specific app (e.g., "com.bca.mybca.omni.android")'),
        limit: z.number()
          .min(1)
          .max(100)
          .optional()
          .describe('Optional limit on the number of notifications to return (1-100)'),
      },
    },
    async ({ packageName, limit }) => {
      try {
        let notifications = await monitor.getCurrentNotifications();

        // Filter by package name if provided
        if (packageName) {
          notifications = notifications.filter(n => n.packageName === packageName);
        }

        // Apply limit if provided
        if (limit && limit > 0) {
          notifications = notifications.slice(0, limit);
        }

        const count = notifications.length;
        const responseText = notifications.length > 0
          ? `Found ${count} notification${count === 1 ? '' : 's'}:\n\n${JSON.stringify(notifications, null, 2)}`
          : 'Found 0 notifications:\n\n[]';

        return {
          content: [
            {
              type: 'text',
              text: responseText
            }
          ]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get current notifications: ${errorMessage}`
            }
          ],
          isError: true
        };
      }
    }
  );

  // Set up notification event handler to send notifications to clients
  monitor.on('newNotification', (notification: Notification) => {
    try {
      server.server.notification({
        method: 'notifications/message',
        params: {
          level: 'info',
          logger: 'termux-notification-monitor',
          message: 'New notification received',
          data: {
            type: 'newNotification',
            timestamp: new Date().toISOString(),
            notification: notification,
          },
        },
      });
    } catch (error) {
      stderr.write(`Failed to send new notification to MCP client: ${error?.message ?? error}`);
    }
  });

  // Handle monitoring errors
  monitor.on('error', (error: Error) => {
    try {
      server.server.notification({
        method: 'notifications/message',
        params: {
          level: 'error',
          logger: 'termux-notification-monitor',
          message: 'Notification monitoring error',
          data: {
            type: 'monitoringError',
            timestamp: new Date().toISOString(),
            error: error.message,
          },
        },
      });
    } catch (error) {
      stderr.write(`Failed to send error notification to MCP client: ${error?.message ?? error}`);
    }
  });

  // Clean up when server closes
  server.server.onclose = () => {
    monitor.stopMonitoring();
  };

  return server;
}
