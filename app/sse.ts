#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createTermuxNotificationListMcpServer } from '@app/termux-notification-list-mcp-server.js';
import { TermuxNotificationMonitor } from '@app/termux-notification-monitor.js';

const monitor = new TermuxNotificationMonitor();
const server = createTermuxNotificationListMcpServer(monitor);
const transports: Record<string, SSEServerTransport> = {};

const app = express();

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
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
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
  const token = process.env.MCP_AUTH_TOKEN;
  const basicAuthUser = process.env.MCP_BASIC_USER;
  const basicAuthPass = process.env.MCP_BASIC_PASS;

  // If no authentication is configured, skip authentication (for development)
  if (!token && !basicAuthUser) {
    return next();
  }

  // Check for token authentication via query parameter (for SSE EventSource compatibility)
  if (queryToken && token) {
    if (queryToken !== token) {
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
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Bearer token authentication not configured' });
    }

    const providedToken = authHeader.substring(7); // Remove 'Bearer ' prefix
    if (providedToken !== token) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    return next();
  }

  // Check for HTTP Basic Authentication
  if (authHeader && authHeader.startsWith('Basic ')) {
    if (!basicAuthUser || !basicAuthPass) {
      return res.status(401).json({ error: 'Unauthorized: Basic authentication not configured' });
    }

    try {
      const base64Credentials = authHeader.substring(6); // Remove 'Basic ' prefix
      const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
      const [username, password] = credentials.split(':');

      if (username !== basicAuthUser || password !== basicAuthPass) {
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
app.use('/sse', authenticate);
app.use('/messages', authenticate);

// Apply input validation
app.use(validateInput);

// SSE endpoint
app.get('/sse', async (req: express.Request, res: express.Response) => {
  try {
    const transport = new SSEServerTransport('/messages', res);
    transports[transport.sessionId] = transport;

    // Listen for new notifications and send them as SSE events
    const notificationHandler = (notification: any) => {
      try {
        if (transports[transport.sessionId]) {
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
      delete transports[transport.sessionId];
    });

    await server.connect(transport);
  } catch (error) {
    console.error('Error establishing SSE connection:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// Messages endpoint
app.post('/messages', async (req: express.Request, res: express.Response) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId || !transports[sessionId]) {
    return res.status(400).json({ error: 'Invalid session' });
  }

  const transport = transports[sessionId];
  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error('Error handling message:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
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

const PORT = parseInt(process.env.PORT || '3000');

let httpServer: any;

httpServer = createServer(app);

httpServer.listen(PORT, () => {
  const protocol = 'http';
  console.log(`Secure SSE MCP Server listening on port ${PORT}`);
  console.log(`Protocol: ${protocol}`);
  console.log(`SSE endpoint: ${protocol}://localhost:${PORT}/sse`);
  console.log(`Messages endpoint: ${protocol}://localhost:${PORT}/messages`);
  console.log(`Health check: ${protocol}://localhost:${PORT}/health`);

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
