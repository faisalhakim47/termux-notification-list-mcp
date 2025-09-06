import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { NotificationSchema } from './notification-monitor.js';

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

test('Termux device smoke test - basic connectivity and termux-notification-list', async () => {
  console.log(`Testing SSH connection to ${TERMUX_SSH_USER}@${TERMUX_SSH_HOST}:${TERMUX_SSH_PORT}`);
  
  // Test 1: Basic SSH connectivity
  const pingResult = await runSSH('echo "SSH connection OK"');
  assert.strictEqual(pingResult.code, 0, `SSH connection failed: ${pingResult.stderr}`);
  assert.ok(pingResult.stdout.includes('SSH connection OK'), 'SSH echo test failed');

  // Test 2: Check if termux-notification-list command exists and runs
  const listResult = await runSSH('termux-notification-list');
  
  if (listResult.code !== 0) {
    if (listResult.stderr.includes('permission') || listResult.stderr.includes('Permission')) {
      throw new Error(
        'termux-notification-list failed due to permissions. ' +
        'Please grant notification access to Termux: ' +
        'Android Settings → Apps → Special app access → Notification access → Enable for Termux'
      );
    }
    throw new Error(`termux-notification-list failed (code ${listResult.code}): ${listResult.stderr}`);
  }

  // Test 3: Validate JSON output structure
  let notifications;
  try {
    notifications = JSON.parse(listResult.stdout);
  } catch (error) {
    throw new Error(`termux-notification-list output is not valid JSON: ${error}`);
  }

  assert.ok(Array.isArray(notifications), 'termux-notification-list should return an array');

  // Test 4: Validate notification schema if any notifications exist
  if (notifications.length > 0) {
    const validatedNotifications = z.array(NotificationSchema).safeParse(notifications);
    if (!validatedNotifications.success) {
      console.warn('Some notifications failed schema validation:', validatedNotifications.error);
      // Don't fail the test, just warn - notification formats might vary
    } else {
      console.log(`Found ${notifications.length} valid notifications on device`);
    }
  } else {
    console.log('No notifications found on device (this is normal)');
  }

  console.log('✓ Termux device smoke test passed');
});

test('Termux device integration test - create and detect notification', async () => {
  const testId = Math.floor(Date.now() / 1000); // Unix timestamp as unique ID
  const testTitle = 'MCP-INTEGRATION-TEST';
  const testContent = `Integration test notification ${testId}`;

  console.log(`Creating test notification with ID ${testId}`);

  // Test 1: Create a test notification
  const createResult = await runSSH(
    `termux-notification -i ${testId} -t "${testTitle}" -c "${testContent}"`
  );
  
  if (createResult.code !== 0) {
    throw new Error(`Failed to create test notification: ${createResult.stderr}`);
  }

  // Test 2: Wait a moment for notification to appear
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 3: List notifications and find our test notification
  const listResult = await runSSH('termux-notification-list');
  assert.strictEqual(listResult.code, 0, `termux-notification-list failed: ${listResult.stderr}`);

  const notifications = JSON.parse(listResult.stdout);
  const testNotification = notifications.find((n: any) => 
    n.id === testId || n.title === testTitle
  );

  assert.ok(testNotification, `Test notification with ID ${testId} not found in notification list`);
  assert.strictEqual(testNotification.title, testTitle, 'Test notification title mismatch');
  assert.strictEqual(testNotification.content, testContent, 'Test notification content mismatch');

  // Test 4: Validate the notification against our schema
  const validatedNotification = NotificationSchema.safeParse(testNotification);
  assert.ok(validatedNotification.success, `Test notification failed schema validation: ${validatedNotification.error}`);

  console.log('✓ Test notification created and detected successfully');

  // Cleanup: Try to remove the test notification (optional, don't fail if this doesn't work)
  try {
    await runSSH(`termux-notification-remove ${testId}`);
    console.log('✓ Test notification cleaned up');
  } catch (error) {
    console.warn('Could not clean up test notification (this is OK):', error);
  }
});
