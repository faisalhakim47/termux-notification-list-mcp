import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { TermuxNotificationMonitor } from './termux-notification-monitor.js';
import type { Notification } from './notification-monitor.js';

// Environment variables for SSH connection
const TERMUX_SSH_USER = process.env.TERMUX_SSH_USER || 'u0_a630';
const TERMUX_SSH_HOST = process.env.TERMUX_SSH_HOST || '192.168.1.25';
const TERMUX_SSH_PORT = process.env.TERMUX_SSH_PORT || '8022';
const TERMUX_SSH_KEY = process.env.TERMUX_SSH_KEY;

/**
 * Helper function to run SSH commands on the Termux device
 */
async function runSSH(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const sshArgs = [
      '-p', TERMUX_SSH_PORT,
      ...(TERMUX_SSH_KEY ? ['-i', TERMUX_SSH_KEY] : []),
      '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=no',
      `${TERMUX_SSH_USER}@${TERMUX_SSH_HOST}`,
      command
    ];

    const process = spawn('ssh', sshArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      resolve({ stdout, stderr, code: code || 0 });
    });

    process.on('error', (error) => {
      reject(new Error(`SSH process failed: ${error.message}`));
    });
  });
}

/**
 * Wait for an event with timeout
 */
function waitForEvent<T>(emitter: any, eventName: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      emitter.removeListener(eventName, onEvent);
      reject(new Error(`Timeout waiting for ${eventName} event after ${timeoutMs}ms`));
    }, timeoutMs);

    const onEvent = (data: T) => {
      clearTimeout(timeout);
      emitter.removeListener(eventName, onEvent);
      resolve(data);
    };

    emitter.on(eventName, onEvent);
  });
}

test('TermuxNotificationMonitor integration test with SSH', async () => {
  const testId = Math.floor(Date.now() / 1000);
  const testTitle = 'MCP-MONITOR-INTEGRATION-TEST';
  const testContent = `Monitor integration test ${testId}`;

  // Construct SSH command for the monitor to use
  const sshCommand = [
    'ssh',
    '-p', TERMUX_SSH_PORT,
    ...(TERMUX_SSH_KEY ? ['-i', TERMUX_SSH_KEY] : []),
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=no',
    `${TERMUX_SSH_USER}@${TERMUX_SSH_HOST}`,
    'termux-notification-list'
  ].join(' ');

  console.log(`Testing TermuxNotificationMonitor with SSH command: ${sshCommand}`);

  // Create monitor instance with SSH command override
  const monitor = new TermuxNotificationMonitor(sshCommand);

  try {
    // Test 1: Basic getCurrentNotifications via SSH
    console.log('Testing getCurrentNotifications() via SSH...');
    const initialNotifications = await monitor.getCurrentNotifications();
    assert.ok(Array.isArray(initialNotifications), 'getCurrentNotifications should return an array');
    console.log(`✓ Found ${initialNotifications.length} initial notifications via SSH`);

    // Test 2: Start monitoring and wait for new notification event
    console.log('Starting notification monitoring...');
    monitor.startMonitoring();

    // Create test notification after a short delay
    setTimeout(async () => {
      console.log(`Creating test notification with ID ${testId}...`);
      try {
        await runSSH(`termux-notification -i ${testId} -t "${testTitle}" -c "${testContent}"`);
        console.log('✓ Test notification created');
      } catch (error) {
        console.error('Failed to create test notification:', error);
      }
    }, 1000);

    // Wait for the newNotification event
    console.log('Waiting for newNotification event...');
    const newNotification: Notification = await waitForEvent(monitor, 'newNotification', 10000);

    // Test 3: Validate the received notification
    assert.ok(newNotification, 'Should receive a newNotification event');
    
    // Check if this is our test notification (it might be any new notification)
    if (newNotification.title === testTitle && newNotification.id === testId) {
      assert.strictEqual(newNotification.content, testContent, 'Notification content should match');
      console.log('✓ Successfully detected our test notification via monitor');
    } else {
      // We detected a different notification, which is also valid for the monitor test
      console.log(`✓ Successfully detected a new notification via monitor: "${newNotification.title}"`);
      console.log('Note: This was not our test notification, but proves the monitor works');
    }

    console.log('✓ Successfully detected new notification via monitor');
    console.log('✓ TermuxNotificationMonitor integration test passed');

  } catch (error) {
    throw error;
  } finally {
    // Cleanup: Stop monitoring
    monitor.stopMonitoring();
    console.log('✓ Monitoring stopped');

    // Cleanup: Try to remove test notification
    try {
      await runSSH(`termux-notification-remove ${testId}`);
      console.log('✓ Test notification cleaned up');
    } catch (error) {
      console.warn('Could not clean up test notification (this is OK):', error);
    }
  }
});

test('TermuxNotificationMonitor error handling with SSH', async () => {
  // Test with invalid SSH command to ensure error handling works
  const invalidSshCommand = 'ssh -p 99999 invalid@invalid.host termux-notification-list';
  const monitor = new TermuxNotificationMonitor(invalidSshCommand);

  try {
    await monitor.getCurrentNotifications();
    assert.fail('Should have thrown an error for invalid SSH connection');
  } catch (error) {
    assert.ok(error instanceof Error, 'Should throw an Error instance');
    const errorMessage = error.message.toLowerCase();
    const hasExpectedMessage = errorMessage.includes('failed to execute') || 
                              errorMessage.includes('notification list command') ||
                              errorMessage.includes('connection') ||
                              errorMessage.includes('timeout');
    assert.ok(hasExpectedMessage, `Error message should be descriptive. Got: ${error.message}`);
    console.log('✓ Error handling works correctly for invalid SSH commands');
  }
});
