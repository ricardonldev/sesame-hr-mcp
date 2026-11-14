#!/usr/bin/env node
// Runs the Sesame HR MCP server over stdio. Needs SESAME_API_TOKEN (and SESAME_REGION if it is not eu1).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SesameClient, createServer } from './server.js';

try {
	const client = new SesameClient({
		token: process.env.SESAME_API_TOKEN,
		region: process.env.SESAME_REGION || 'eu1',
		baseUrl: process.env.SESAME_BASE_URL || undefined,
	});
	await createServer(client).connect(new StdioServerTransport());
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
