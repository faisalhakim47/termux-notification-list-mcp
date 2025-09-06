#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTermuxNotificationListMcpServer } from '@app/termux-notification-list-mcp-server.js';

const server = createTermuxNotificationListMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
