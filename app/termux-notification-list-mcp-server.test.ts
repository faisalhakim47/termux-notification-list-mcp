import { ok, strictEqual, throws, doesNotReject, rejects, equal, deepEqual, notEqual, notDeepEqual } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, suite } from 'node:test';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createTermuxNotificationListMcpServer } from './termux-notification-list-mcp-server.js';
import { MockNotificationMonitor } from './mock-notification-monitor.js';
import { Notification } from './notification-monitor.js';
import { MemoryTransport } from '@app/mcp-server-test-suite.js';

suite('Termux Notification List MCP Server', function () {
  let clientTransport: MemoryTransport;
  let serverTransport: MemoryTransport;
  let server: McpServer;
  let client: Client;
  let mockMonitor: MockNotificationMonitor;

  beforeEach(async function () {
    clientTransport = new MemoryTransport();
    serverTransport = new MemoryTransport();
    clientTransport._paired = serverTransport;
    serverTransport._paired = clientTransport;
    
    mockMonitor = new MockNotificationMonitor();
    server = createTermuxNotificationListMcpServer(mockMonitor);
    client = new Client({ name: 'test-client', version: '1.0.0' });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async function () {
    await Promise.all([
      client.close(),
      server.close(),
    ]);
  });

  describe('Server Initialization', function () {
    it('should create server with correct metadata', function () {
      // Test server creation by checking it exists and has expected structure
      ok(server, 'Server should exist');
      ok(server.server, 'Server should have underlying server instance');
    });

    it('should list all required tools', async function () {
      const tools = await client.listTools();
      const toolNames = tools.tools.map(tool => tool.name);
      
      ok(toolNames.includes('waitForNotification'), 'Should have waitForNotification tool');
      ok(toolNames.includes('stopWaitingForNotification'), 'Should have stopWaitingForNotification tool');
      ok(toolNames.includes('getCurrentNotifications'), 'Should have getCurrentNotifications tool');
    });
  });

  describe('Tool: waitForNotification', function () {
    it('should start monitoring without timeout', async function () {
      const result = await client.callTool({
        name: 'waitForNotification',
        arguments: {}
      });
      
      ok(result.content, 'Should have content');
      const content = result.content as any[];
      ok(content.length > 0, 'Should have content items');
      ok(content[0].type === 'text', 'First content item should be text');
      ok(content[0].text.includes('Started monitoring'), 'Should indicate monitoring started');
      
      // Stop monitoring to clean up
      await client.callTool({
        name: 'stopWaitingForNotification',
        arguments: {}
      });
    });

    it('should start monitoring with timeout', async function () {
      const result = await client.callTool({
        name: 'waitForNotification',
        arguments: { timeout: 1 } // Use shorter timeout for test
      });
      
      ok(result.content, 'Should have content');
      const content = result.content as any[];
      ok(content.length > 0, 'Should have content items');
      ok(content[0].type === 'text', 'First content item should be text');
      ok(content[0].text.includes('Started monitoring'), 'Should indicate monitoring started');
      ok(content[0].text.includes('1 second'), 'Should mention timeout duration');
      
      // Wait for timeout to complete
      await new Promise(resolve => setTimeout(resolve, 1100));
    });
  });

  describe('Tool: stopWaitingForNotification', function () {
    it('should stop monitoring', async function () {
      // Start monitoring first
      await client.callTool({
        name: 'waitForNotification',
        arguments: {}
      });
      
      // Stop monitoring
      const result = await client.callTool({
        name: 'stopWaitingForNotification',
        arguments: {}
      });
      
      ok(result.content, 'Should have content');
      const content = result.content as any[];
      ok(content.length > 0, 'Should have content items');
      ok(content[0].type === 'text', 'First content item should be text');
      ok(content[0].text.includes('Stopped monitoring'), 'Should indicate monitoring stopped');
    });
  });

  describe('Tool: getCurrentNotifications', function () {
    it('should handle getCurrentNotifications without filters', async function () {
      // Set up mock notifications
      const mockNotifications: Notification[] = [
        {
          id: 1,
          tag: 'test-tag',
          key: 'test-key-1',
          group: 'test-group',
          packageName: 'com.example.app',
          title: 'Test Notification',
          content: 'Test content',
          when: '2025-01-01T00:00:00Z'
        }
      ];
      mockMonitor.setMockNotifications(mockNotifications);

      const result = await client.callTool({
        name: 'getCurrentNotifications',
        arguments: {}
      });
      
      ok(result.content, 'Should have content');
      const content = result.content as any[];
      ok(content.length > 0, 'Should have content items');
      ok(content[0].type === 'text', 'First content item should be text');
      ok(content[0].text.includes('Found 1 notification'), 'Should indicate 1 notification found');
    });

    it('should handle getCurrentNotifications with package filter', async function () {
      // Set up mock notifications with different packages
      const mockNotifications: Notification[] = [
        {
          id: 1,
          tag: 'test-tag-1',
          key: 'test-key-1',
          group: 'test-group',
          packageName: 'com.example.app',
          title: 'Test Notification 1',
          content: 'Test content 1',
          when: '2025-01-01T00:00:00Z'
        },
        {
          id: 2,
          tag: 'test-tag-2',
          key: 'test-key-2',
          group: 'test-group',
          packageName: 'com.other.app',
          title: 'Test Notification 2',
          content: 'Test content 2',
          when: '2025-01-01T00:01:00Z'
        }
      ];
      mockMonitor.setMockNotifications(mockNotifications);

      const result = await client.callTool({
        name: 'getCurrentNotifications',
        arguments: { packageName: 'com.example.app' }
      });
      
      ok(result.content, 'Should have content');
      const content = result.content as any[];
      ok(content.length > 0, 'Should have content items');
      ok(content[0].type === 'text', 'First content item should be text');
      ok(content[0].text.includes('Found 1 notification'), 'Should indicate 1 notification found after filtering');
      ok(content[0].text.includes('com.example.app'), 'Should contain the filtered package');
    });

    it('should handle getCurrentNotifications with limit', async function () {
      // Set up mock notifications
      const mockNotifications: Notification[] = [
        {
          id: 1,
          tag: 'test-tag-1',
          key: 'test-key-1',
          group: 'test-group',
          packageName: 'com.example.app',
          title: 'Test Notification 1',
          content: 'Test content 1',
          when: '2025-01-01T00:00:00Z'
        },
        {
          id: 2,
          tag: 'test-tag-2',
          key: 'test-key-2',
          group: 'test-group',
          packageName: 'com.example.app',
          title: 'Test Notification 2',
          content: 'Test content 2',
          when: '2025-01-01T00:01:00Z'
        },
        {
          id: 3,
          tag: 'test-tag-3',
          key: 'test-key-3',
          group: 'test-group',
          packageName: 'com.example.app',
          title: 'Test Notification 3',
          content: 'Test content 3',
          when: '2025-01-01T00:02:00Z'
        }
      ];
      mockMonitor.setMockNotifications(mockNotifications);

      const result = await client.callTool({
        name: 'getCurrentNotifications',
        arguments: { limit: 2 }
      });
      
      ok(result.content, 'Should have content');
      const content = result.content as any[];
      ok(content.length > 0, 'Should have content items');
      ok(content[0].type === 'text', 'First content item should be text');
      ok(content[0].text.includes('Found 2 notification'), 'Should indicate 2 notifications found due to limit');
    });

    it('should handle errors from notification monitor', async function () {
      // Set up mock to simulate error
      mockMonitor.setSimulateError(true);

      const result = await client.callTool({
        name: 'getCurrentNotifications',
        arguments: {}
      });
      
      ok(result.content, 'Should have content');
      const content = result.content as any[];
      ok(content.length > 0, 'Should have content items');
      ok(content[0].type === 'text', 'First content item should be text');
      ok(content[0].text.includes('Failed to get current notifications'), 'Should indicate error');
      ok(result.isError, 'Should be marked as error');
    });
  });

  describe('Mock Notification Monitor', function () {
    it('should emit new notifications when simulated', async function () {
      const testNotification: Notification = {
        id: 999,
        tag: 'test-tag',
        key: 'test-key-999',
        group: 'test-group',
        packageName: 'com.test.app',
        title: 'Simulated Notification',
        content: 'This is a test notification',
        when: '2025-01-01T12:00:00Z'
      };

      // Create a promise to wait for the event
      const notificationPromise = new Promise<Notification>((resolve) => {
        mockMonitor.once('newNotification', resolve);
      });

      mockMonitor.simulateNewNotification(testNotification);
      
      const emittedNotification = await notificationPromise;
      deepEqual(emittedNotification, testNotification, 'Should emit the correct notification');
    });

    it('should clear mock notifications', async function () {
      // Add some notifications
      mockMonitor.addMockNotification({
        id: 1,
        tag: 'test-tag',
        key: 'test-key-1',
        group: 'test-group',
        packageName: 'com.test.app',
        title: 'Test',
        content: 'Test',
        when: '2025-01-01T00:00:00Z'
      });

      // Verify they exist
      let notifications = await mockMonitor.getCurrentNotifications();
      equal(notifications.length, 1, 'Should have 1 notification before clearing');

      // Clear and verify
      mockMonitor.clearMockNotifications();
      notifications = await mockMonitor.getCurrentNotifications();
      equal(notifications.length, 0, 'Should have 0 notifications after clearing');
    });
  });
});
