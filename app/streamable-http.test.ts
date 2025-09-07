import { afterEach, beforeEach, describe, it, suite } from 'node:test';
import { createServer, Server } from 'node:http';
import { doesNotReject } from 'node:assert';

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTermuxNotificationMcpServerExpressApp } from '@app/streamable-http.js';
import { MockNotificationMonitor } from '@app/mock-notification-monitor.js';
import { NotificationMonitor } from '@app/notification-monitor.js';

suite('Termux Notification MCP Server Streamable HTTP', () => {
  let notificationMonitor: NotificationMonitor;
  let httpServer: Server<any, any>;
  let httpServerUrl: string;
  let clientOrigin: string;

  beforeEach(async () => {
    httpServerUrl = await new Promise<string>((resolve, reject) => {
      notificationMonitor = new MockNotificationMonitor();
      const termuxNotificationMcpServerExpressApp = createTermuxNotificationMcpServerExpressApp(notificationMonitor);
      httpServer = createServer(termuxNotificationMcpServerExpressApp);
      httpServer.addListener('error', (error) => {
        reject(new Error(`Server error: ${error.message}`, {
          cause: error,
        }));
      });
      httpServer.listen(0, () => {
        const address = httpServer.address();
        if (address && typeof address === 'object') {
          const port = address.port;
          resolve(`http://localhost:${port}`);
        }
        else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
    // set client origin to match the server's host:port (ensures Origin header aligns with running server)
    clientOrigin = new URL(httpServerUrl).origin;
  });

  afterEach(() => {
    if (httpServer) httpServer.close();
  });

  describe('Streamable HTTP Server', () => {

    it('should establish SSE connection', async () => {
      const transport = new StreamableHTTPClientTransport(new URL(`${httpServerUrl}/mcp`), {
        fetch: createLoggedFetch('SSEConnectionTest'),
      });

      await doesNotReject(transport.start(), (error) => {
        console.error('Failed to start SSE transport:', error);
        return false;
      });

      await transport.close();
    });

    it('should handle POST with notification and return 202 Accepted', async () => {
      // First, initialize to get session ID
      const initResponse = await fetch(`${httpServerUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Origin': clientOrigin,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
          },
        }),
      });

      if (!initResponse.ok) {
        throw new Error(`Initialization failed: ${initResponse.status}`);
      }

      const sessionId = getSessionIdFromResponse(initResponse);
      if (!sessionId) {
        throw new Error('No session ID returned');
      }

      // Now send a notification
      const notificationResponse = await fetch(`${httpServerUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Origin': clientOrigin,
          'mcp-session-id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      if (notificationResponse.status !== 202) {
        throw new Error(`Expected 202 Accepted, got ${notificationResponse.status}`);
      }
    });

    it('should handle POST with request and return SSE stream', async () => {
      // First, initialize
      const initResponse = await fetch(`${httpServerUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Origin': clientOrigin,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
          },
        }),
      });

      if (!initResponse.ok) {
        throw new Error(`Initialization failed: ${initResponse.status}`);
      }

      const sessionId = getSessionIdFromResponse(initResponse);
      if (!sessionId) {
        throw new Error('No session ID returned');
      }

      // Send a request (e.g., list tools)
      const requestResponse = await fetch(`${httpServerUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Origin': clientOrigin,
          'mcp-session-id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/list',
        }),
      });

      if (!requestResponse.ok) {
        const text = await requestResponse.text().catch(() => '<<no body>>');
        throw new Error(`Request failed: ${requestResponse.status} - ${text}`);
      }

      const contentType = requestResponse.headers.get('content-type');
      if (contentType?.includes('text/event-stream')) {
        // SSE stream initiated
      } else if (contentType?.includes('application/json')) {
        // JSON response
      } else {
        throw new Error(`Unexpected content type: ${contentType}`);
      }
    });

    it('should handle GET request to open SSE stream', async () => {
      // First, initialize
      const initResponse = await fetch(`${httpServerUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Origin': clientOrigin,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
          },
        }),
      });

      if (!initResponse.ok) {
        throw new Error(`Initialization failed: ${initResponse.status}`);
      }

      const sessionId = getSessionIdFromResponse(initResponse);
      if (!sessionId) {
        throw new Error('No session ID returned');
      }

      // GET to open SSE stream
      const sseResponse = await fetch(`${httpServerUrl}/mcp`, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Origin': clientOrigin,
          'mcp-session-id': sessionId,
        },
      });

      if (!sseResponse.ok) {
        throw new Error(`GET SSE failed: ${sseResponse.status}`);
      }

      const contentType = sseResponse.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        throw new Error(`Expected text/event-stream, got ${contentType}`);
      }

      // Per Streamable HTTP spec, SSE responses SHOULD include cache-control and connection hints
      const cacheControl = sseResponse.headers.get('cache-control') || sseResponse.headers.get('Cache-Control');
      if (!cacheControl || !cacheControl.includes('no-cache')) {
        // Not fatal, but log for visibility; some servers omit this header.
        console.info('Warning: SSE response missing Cache-Control: no-cache');
      }
      const connectionHeader = sseResponse.headers.get('connection') || sseResponse.headers.get('Connection');
      if (!connectionHeader || !/keep-alive/i.test(connectionHeader)) {
        console.info('Warning: SSE response missing Connection: keep-alive');
      }
    });

    it('should support multiple simultaneous connections', async () => {
      const transport1 = new StreamableHTTPClientTransport(new URL(`${httpServerUrl}/mcp`), {
        fetch: createLoggedFetch('MultiConnTest1'),
      });
      const transport2 = new StreamableHTTPClientTransport(new URL(`${httpServerUrl}/mcp`), {
        fetch: createLoggedFetch('MultiConnTest2'),
      });

      await doesNotReject(transport1.start(), (error) => {
        console.error('Failed to start transport1:', error);
        return false;
      });

      await doesNotReject(transport2.start(), (error) => {
        console.error('Failed to start transport2:', error);
        return false;
      });

      await transport1.close();
      await transport2.close();
    });

    it('should handle session management correctly', async () => {
      // Initialize without session ID
      const initResponse = await fetch(`${httpServerUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Origin': clientOrigin,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
          },
        }),
      });

      if (!initResponse.ok) {
        throw new Error(`Initialization failed: ${initResponse.status}`);
      }

      const sessionId = getSessionIdFromResponse(initResponse);
      if (!sessionId) {
        throw new Error('No session ID returned');
      }

      // Subsequent request with session ID
      const followUpResponse = await fetch(`${httpServerUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Origin': clientOrigin,
          'mcp-session-id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      if (followUpResponse.status !== 202) {
        throw new Error(`Expected 202, got ${followUpResponse.status}`);
      }

      // Request without session ID should fail
      const noSessionResponse = await fetch(`${httpServerUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Origin': clientOrigin,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
        }),
      });

      if (noSessionResponse.status !== 400) {
        throw new Error(`Expected 400 for missing session ID, got ${noSessionResponse.status}`);
      }
    });

    it('should support backwards compatibility with old HTTP+SSE transport', async () => {
      // Test old SSE endpoint
      const sseResponse = await fetch(`${httpServerUrl}/sse`, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
        },
      });

      if (!sseResponse.ok) {
        throw new Error(`Old SSE GET failed: ${sseResponse.status}`);
      }

      const contentType = sseResponse.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        throw new Error(`Expected text/event-stream for old SSE, got ${contentType}`);
      }
    });

  });

});

function createLoggedFetch(label: string): typeof fetch {
  return async function loggedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const urlString = typeof input === 'string'
      ? input
      : (
        input instanceof URL
          ? input.toString()
          : input.url
      );
    console.info(`[${label}] Fetching: ${urlString}`, init);
    const response = await fetch(input, init);
    // Try to log streamed body chunks safely. Support Node and browser ReadableStream shapes.
    try {
      const clonedResponse = response.clone();
      const body = clonedResponse.body as unknown as ReadableStream<Uint8Array> | null;
      if (body && typeof body.getReader === 'function') {
        const reader = body.getReader();
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const text = new TextDecoder().decode(value);
              console.info(`[${label}] Response chunk begin`);
              console.info(text);
              console.info(`[${label}] Response chunk end`);
            }
            console.info(`[${label}] Response stream closed`);
          }
          catch (err) {
            console.error(`[${label}] Response stream reader error:`, err);
          }
        })();
      }
      else if ((clonedResponse as any).body && typeof (clonedResponse as any).body.on === 'function') {
        // Node.js older fetch polyfills expose a stream-like object with 'on'
        const stream: any = (clonedResponse as any).body;
        stream.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          console.info(`[${label}] Response chunk begin`);
          console.info(text);
          console.info(`[${label}] Response chunk end`);
        });
        stream.on('end', () => console.info(`[${label}] Response stream closed`));
        stream.on('error', (err: unknown) => console.error(`[${label}] Response stream aborted:`, err));
      }
    }
    catch (err) {
      console.info(`[${label}] Couldn't attach stream logger:`, err);
    }
    return response;
  }
}

function getSessionIdFromResponse(response: Response): string | null {
  // Headers can be presented in different casing; prefer the MCP canonical header name but fall back case-insensitively.
  const canonical = response.headers.get('mcp-session-id');
  if (canonical) return canonical;
  // Try iterating all headers for case-insensitive match (some runtimes mutate casing)
  for (const [k, v] of response.headers.entries()) {
    if (k.toLowerCase() === 'mcp-session-id') return v;
  }
  return null;
}
