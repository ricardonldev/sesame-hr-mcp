// Runs the MCP server through a real MCP client over stdio against the spec-checking Sesame mock.
// Needs test/sesame-spec.json: npm run fetch-spec
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { start, log } from './mock-server.mjs';

const PORT = 4049;
let server;
let client;
before(async () => {
	server = await start(PORT);
	client = new Client({ name: 'test', version: '1' });
	await client.connect(new StdioClientTransport({
		command: process.execPath,
		args: ['src/index.js'],
		env: { ...process.env, SESAME_API_TOKEN: 'test-token', SESAME_BASE_URL: `http://localhost:${PORT}` },
	}));
});
after(async () => { await client.close(); server.close(); });

const call = async (name, args = {}) => {
	const r = await client.callTool({ name, arguments: args });
	return { error: !!r.isError, data: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
};

test('tools and annotations', async () => {
	const { tools } = await client.listTools();
	assert.equal(tools.length, 10);
	assert.equal(tools.find((t) => t.name === 'reject_vacation_request').annotations.destructiveHint, true);
	assert.ok(!('comment' in tools.find((t) => t.name === 'accept_vacation_request').inputSchema.properties));
});

test('find employees returns short records without personal IDs', async () => {
	const { data } = await call('find_employees', { email: 'lucia@demo.test' });
	assert.equal(data.length, 1);
	assert.deepEqual(Object.keys(data[0]).sort(), ['code', 'email', 'firstName', 'id', 'lastName', 'status', 'workStatus'].filter((k) => k in data[0]).sort());
	assert.equal(data[0].phone, undefined);
});

test('clock in, clock in again (error), clock out, list entries', async () => {
	assert.equal((await call('clock_in', { employee_id: 'e1' })).data.workEntryOut, null);
	const again = await call('clock_in', { employee_id: 'e1' });
	assert.equal(again.error, true);
	assert.match(again.data, /Sesame HR 409: Employee is already clocked in/);
	assert.ok((await call('clock_out', { employee_id: 'e1', origin: 'mobile' })).data.workEntryOut.date);
	assert.equal((await call('list_work_entries', { from: '2026-01-01', to: '2026-12-31', employee_id: 'e1' })).data.length, 1);
	assert.ok((await call('clock_in', { employee_id: 'e1', origin: 'fax' })).error);
});

test('vacation and absence requests', async () => {
	assert.deepEqual((await call('list_vacation_requests')).data.map((r) => r.id), ['v1']);
	assert.equal((await call('accept_vacation_request', { request_id: 'v1', manager_id: 'e2' })).data.status, 'accepted');
	assert.equal((await call('reject_absence_request', { request_id: 'a1', comment: 'No cover that day' })).data.status, 'rejected');
	const twice = await call('accept_absence_request', { request_id: 'a1' });
	assert.equal(twice.error, true);
	assert.match(twice.data, /already resolved/);
});

test('missing token stops the server with a clear message', async () => {
	const p = spawn(process.execPath, ['src/index.js'], { env: { ...process.env, SESAME_API_TOKEN: '' } });
	let err = '';
	p.stderr.on('data', (d) => (err += d));
	assert.equal(await new Promise((r) => p.on('close', r)), 1);
	assert.match(err, /SESAME_API_TOKEN is not set/);
});

test('every API call matched the official spec', () => {
	assert.ok(log.length >= 8, `only ${log.length} calls`);
});
