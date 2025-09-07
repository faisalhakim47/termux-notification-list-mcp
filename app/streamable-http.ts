#!/usr/bin/env node

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { argv } from 'node:process';
import { randomUUID } from 'node:crypto';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createTermuxNotificationListMcpServer } from '@app/termux-notification-list-mcp-server.js';
import { TermuxNotificationMonitor } from '@app/termux-notification-monitor.js';
import { NotificationMonitor } from '@app/notification-monitor.js';

type TermuxNotificationMcpServerExpressAppOptions = {
  allowedOrigins?: string[];
  bearerToken?: string;
  basicUser?: string;
  basicPass?: string;
};

export function createTermuxNotificationMcpServerExpressApp(monitor: NotificationMonitor, options?: TermuxNotificationMcpServerExpressAppOptions) {
  const server = createTermuxNotificationListMcpServer(monitor);
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const oldTransports: Record<string, SSEServerTransport> = {};
  const app = express();

  const allowedOrigins = options?.allowedOrigins || [];
  const bearerToken = options?.bearerToken;
  const basicUser = options?.basicUser;
  const basicPass = options?.basicPass;

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));

  // Rate limiting
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  }));

  // CORS configuration
  app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ['Mcp-Session-Id'],
    allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id', 'WWW-Authenticate'],
  }));

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Authentication middleware
  const authenticate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string; // Support token via query parameter for SSE

    // If no authentication is configured, skip authentication (for development)
    if (!bearerToken && !basicUser) {
      return next();
    }

    // Check for token authentication via query parameter (for SSE EventSource compatibility)
    if (queryToken && bearerToken) {
      if (queryToken !== bearerToken) {
        return res.status(401).json({ error: 'Unauthorized: Invalid query token' });
      }
      return next();
    }

    if (!authHeader && !queryToken) {
      res.setHeader('WWW-Authenticate', 'Basic realm="MCP Server", Bearer');
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    // Check for Bearer token authentication
    if (authHeader && authHeader.startsWith('Bearer ')) {
      if (!bearerToken) {
        return res.status(401).json({ error: 'Unauthorized: Bearer token authentication not configured' });
      }

      const providedToken = authHeader.substring(7); // Remove 'Bearer ' prefix
      if (providedToken !== bearerToken) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }
      return next();
    }

    // Check for HTTP Basic Authentication
    if (authHeader && authHeader.startsWith('Basic ')) {
      if (!basicUser || !basicPass) {
        return res.status(401).json({ error: 'Unauthorized: Basic authentication not configured' });
      }

      try {
        const base64Credentials = authHeader.substring(6); // Remove 'Basic ' prefix
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
        const [username, password] = credentials.split(':');

        if (username !== basicUser || password !== basicPass) {
          return res.status(401).json({ error: 'Unauthorized: Invalid credentials' });
        }
        return next();
      } catch (error) {
        return res.status(401).json({ error: 'Unauthorized: Invalid basic auth format' });
      }
    }

    // Unsupported authentication method
    res.setHeader('WWW-Authenticate', 'Basic realm="MCP Server", Bearer');
    return res.status(401).json({ error: 'Unauthorized: Unsupported authentication method' });
  };

  // Input validation middleware
  const validateInput = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Basic JSON validation
    if (req.method === 'POST' && req.headers['content-type']?.includes('application/json')) {
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }
    }
    next();
  };

  // Apply authentication to MCP routes
  app.use('/mcp', authenticate);
  app.use('/sse', authenticate);
  app.use('/messages', authenticate);

  // Apply input validation
  app.use(validateInput);

  // MCP endpoint
  app.all('/mcp', async (req: express.Request, res: express.Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Reuse existing transport
        transport = transports[sessionId];
      } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        // New initialization request
        const incomingOrigin = (req.headers.origin as string | undefined) || undefined;
        const configuredAllowed = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : undefined;
        const allowedOrigins = configuredAllowed ?? (incomingOrigin ? [incomingOrigin] : ['http://localhost:3000']);

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = transport;
          },
          allowedOrigins,
          enableDnsRebindingProtection: true,
        });

        // Set up onclose handler to clean up transport when closed
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            delete transports[sid];
          }
        };

        // Connect the transport to the MCP server
        await server.connect(transport);
      } else {
        // Invalid request - no session ID or not initialization request
        return res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Invalid session ID or not an initialization request',
          },
          id: null,
        });
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  });

  // Backwards compatibility: old HTTP+SSE transport
  app.all('/sse', async (req: express.Request, res: express.Response) => {
    try {
      const transport = new SSEServerTransport('/messages', res);
      oldTransports[transport.sessionId] = transport;

      // Listen for new notifications and send them as SSE events
      const notificationHandler = (notification: any) => {
        try {
          if (oldTransports[transport.sessionId]) {
            // Send notification as SSE event
            res.write(`event: notification\n`);
            res.write(`data: ${JSON.stringify(notification)}\n\n`);
          }
        } catch (error) {
          console.error('Error sending notification SSE event:', error);
        }
      };

      monitor.on('newNotification', notificationHandler);

      res.on('close', () => {
        monitor.off('newNotification', notificationHandler);
        delete oldTransports[transport.sessionId];
      });

      res.setHeader('mcp-session-id', transport.sessionId);

      await server.connect(transport);
    } catch (error) {
      console.error('Error establishing SSE connection:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  });

  // Backwards compatibility: old messages endpoint
  app.post('/messages', async (req: express.Request, res: express.Response) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId || !oldTransports[sessionId]) {
      return res.status(400).json({ error: 'Invalid session' });
    }

    const transport = oldTransports[sessionId];
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error('Error handling message:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  });

  // Listen for new notifications and send them to all connected transports
  monitor.on('newNotification', (notification: any) => {
    // Send to new Streamable HTTP transports
    for (const transport of Object.values(transports)) {
      try {
        transport.send({
          jsonrpc: '2.0',
          method: 'notifications/message',
          params: notification,
        });
      } catch (error) {
        console.error('Error sending notification to Streamable HTTP transport:', error);
      }
    }
    // Send to old SSE transports
    for (const transport of Object.values(oldTransports)) {
      try {
        // For old transport, we need to send via the response stream
        // But since we don't have access to res here, we can't send directly
        // The old transport handles notifications in the /sse endpoint
      } catch (error) {
        console.error('Error sending notification to SSE transport:', error);
      }
    }
  });

  // Health check endpoint
  app.get('/health', (req: express.Request, res: express.Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 404 handler
  app.use((req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Error handler
  app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return app;
}

const __filename = fileURLToPath(import.meta.url);
const [, script] = argv;

if (script === __filename) {
  const httpPort = parseInt(process.env.TERMUX_NOTIFICATION_MCP_HTTP_PORT || '3000', 10);
  const allowedOrigins = process.env.TERMUX_NOTIFICATION_MCP_ALLOWED_ORIGINS ? process.env.TERMUX_NOTIFICATION_MCP_ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'];
  const bearerToken = process.env.TERMUX_NOTIFICATION_MCP_BEARER_TOKEN;
  const basicUser = process.env.TERMUX_NOTIFICATION_MCP_BASIC_USER;
  const basicPass = process.env.TERMUX_NOTIFICATION_MCP_BASIC_PASS;

  const monitor = new TermuxNotificationMonitor();
  const termuxNotificationMCPApp = createTermuxNotificationMcpServerExpressApp(monitor, {
    allowedOrigins,
    bearerToken,
    basicUser,
    basicPass,
  });
  const httpServer = createServer(termuxNotificationMCPApp);

  httpServer.listen(httpPort, () => {
    const protocol = 'http';
    console.log(`Secure Streamable HTTP MCP Server listening on port ${httpPort}`);
    console.log(`Protocol: ${protocol}`);
    console.log(`MCP endpoint (Streamable HTTP): ${protocol}://localhost:${httpPort}/mcp`);
    console.log(`SSE endpoint (legacy): ${protocol}://localhost:${httpPort}/sse`);
    console.log(`Messages endpoint (legacy): ${protocol}://localhost:${httpPort}/messages`);
    console.log(`Health check: ${protocol}://localhost:${httpPort}/health`);

    const hasBearerAuth = !!process.env.MCP_AUTH_TOKEN;
    const hasBasicAuth = !!(process.env.MCP_BASIC_USER && process.env.MCP_BASIC_PASS);

    if (!hasBearerAuth && !hasBasicAuth) {
      console.warn('WARNING: No authentication configured. Server is running without authentication.');
    } else {
      if (hasBearerAuth) {
        console.log('✓ Bearer token authentication enabled');
      }
      if (hasBasicAuth) {
        console.log('✓ HTTP Basic authentication enabled');
      }
    }
  });
}
