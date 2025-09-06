#!/usr/bin/env node

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createTermuxNotificationListMcpServer } from '@app/termux-notification-list-mcp-server.js';

const server = createTermuxNotificationListMcpServer();
const transports: Record<string, SSEServerTransport> = {};

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'GET' && req.url?.startsWith('/sse')) {
    try {
      const transport = new SSEServerTransport('/messages', res);
      transports[transport.sessionId] = transport;
      
      res.on('close', () => {
        delete transports[transport.sessionId];
      });
      
      await server.connect(transport);
    } catch (error) {
      console.error('Error establishing SSE connection:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  } else if (req.method === 'POST' && req.url?.startsWith('/messages')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId || !transports[sessionId]) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid session');
      return;
    }
    
    const transport = transports[sessionId];
    try {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        await transport.handlePostMessage(req, res, JSON.parse(body));
      });
    } catch (error) {
      console.error('Error handling message:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`SSE MCP Server listening on port ${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`Messages endpoint: http://localhost:${PORT}/messages`);
});
