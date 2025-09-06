import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { EventSource } from 'eventsource';

// Environment variables for SSH connection
const TERMUX_SSH_USER = process.env.TERMUX_SSH_USER || 'u0_a630';
const TERMUX_SSH_HOST = process.env.TERMUX_SSH_HOST || '192.168.1.25';
const TERMUX_SSH_PORT = process.env.TERMUX_SSH_PORT || '8022';

// SSE server configuration
const SSE_HOST = process.env.SSE_HOST || '192.168.1.25';
const SSE_PORT = process.env.SSE_PORT || '3000';
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '71c94056fb10c0feba55323951a1545d505d87fbd5580ac123c8a04d5d39cc78';

/**
 * Helper function to run SSH commands on the Termux device
 */
async function runSSH(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const sshArgs = [
      '-p', TERMUX_SSH_PORT,
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
      reject(error);
    });

    // Set a timeout
    setTimeout(() => {
      process.kill('SIGTERM');
      reject(new Error('SSH command timeout'));
    }, 15000);
  });
}

/**
 * Connect to SSE and get session info
 */
async function connectToSSE(): Promise<{ sessionId: string; eventSource: EventSource }> {
  return new Promise((resolve, reject) => {
    const eventSource = new EventSource(`http://${SSE_HOST}:${SSE_PORT}/sse?token=${AUTH_TOKEN}`);

    let sessionId: string | null = null;

    const timeout = setTimeout(() => {
      eventSource.close();
      reject(new Error('Timeout waiting for SSE connection'));
    }, 10000);

    eventSource.onopen = () => {
      console.log('SSE connection opened');
    };

    eventSource.addEventListener('endpoint', (event) => {
      console.log('Received endpoint event:', event.data);
      const endpointData = event.data;
      const match = endpointData.match(/sessionId=([^&]+)/);
      if (match) {
        sessionId = match[1];
        clearTimeout(timeout);
        resolve({ sessionId, eventSource });
      }
    });

    eventSource.onerror = (error) => {
      clearTimeout(timeout);
      eventSource.close();
      reject(new Error(`SSE connection error: ${error}`));
    };
  });
}

/**
 * Send MCP request
 */
async function sendMCPRequest(sessionId: string, method: string, params: any = {}): Promise<any> {
  const requestBody = {
    jsonrpc: '2.0',
    id: Math.random().toString(36).substring(2),
    method,
    params
  };

  const response = await fetch(`http://${SSE_HOST}:${SSE_PORT}/messages?sessionId=${sessionId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await response.json();
  } else {
    const text = await response.text();
    return { result: text };
  }
}

test('Basic E2E Test: SSH + MCP Connection + Tool Discovery', async () => {
  const testId = Math.floor(Date.now() / 1000);
  console.log(`Starting basic E2E test with notification ID: ${testId}`);

  let eventSource: EventSource | null = null;
  let sessionId: string | null = null;

  try {
    // Step 1: Test SSH connectivity
    console.log('Testing SSH connectivity...');
    const sshResult = await runSSH('echo "SSH_OK"');
    assert.strictEqual(sshResult.code, 0, 'SSH should connect successfully');
    assert.ok(sshResult.stdout.includes('SSH_OK'), 'SSH should return expected output');
    console.log('✓ SSH connectivity verified');

    // Step 2: Connect to SSE
    console.log('Connecting to SSE...');
    const connection = await connectToSSE();
    eventSource = connection.eventSource;
    sessionId = connection.sessionId;
    console.log(`✓ SSE connected with session: ${sessionId}`);

    // Step 3: Initialize MCP
    console.log('Initializing MCP...');
    const initResponse = await sendMCPRequest(sessionId, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'basic-e2e-test',
        version: '1.0.0'
      }
    });
    console.log('✓ MCP initialization sent');

    // Step 4: Collect responses for a few seconds
    console.log('Collecting MCP responses...');
    const responses: any[] = [];
    
    eventSource.addEventListener('message', (event) => {
      try {
        const response = JSON.parse(event.data);
        responses.push(response);
        console.log('MCP Response:', JSON.stringify(response, null, 2));
      } catch (error) {
        console.warn('Non-JSON response:', event.data);
      }
    });

    // Wait for responses
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 5: List available tools
    console.log('Requesting tools list...');
    await sendMCPRequest(sessionId, 'tools/list', {});
    
    // Wait for tools response
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 6: Create a test notification
    console.log('Creating test notification...');
    const sshNotificationResult = await runSSH(
      `termux-notification -i ${testId} -t "E2E-BASIC-TEST" -c "Basic E2E test notification"`
    );
    console.log(`SSH notification result: code=${sshNotificationResult.code}, stdout="${sshNotificationResult.stdout}", stderr="${sshNotificationResult.stderr}"`);

    // Step 7: Test if we can remove the notification
    console.log('Removing test notification...');
    const removeResult = await runSSH(`termux-notification-remove ${testId}`);
    console.log(`Remove result: code=${removeResult.code}`);

    console.log('🎉 Basic E2E test completed successfully!');
    console.log(`Total MCP responses received: ${responses.length}`);
    
    if (responses.length > 0) {
      console.log('Summary of received responses:');
      responses.forEach((resp, idx) => {
        if (resp.result) {
          console.log(`  ${idx + 1}. Method response:`, Object.keys(resp.result));
        } else if (resp.error) {
          console.log(`  ${idx + 1}. Error:`, resp.error.message);
        }
      });
    }

  } catch (error) {
    console.error('Basic E2E test failed:', error);
    throw error;
  } finally {
    if (eventSource) {
      eventSource.close();
    }
    // Cleanup
    if (sessionId) {
      try {
        await runSSH(`termux-notification-remove ${testId}`);
      } catch (error) {
        console.warn('Cleanup failed:', error);
      }
    }
  }
});
