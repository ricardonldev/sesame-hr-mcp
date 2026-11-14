// Sesame HR MCP server: tools over the official Sesame public API.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export class SesameClient {
	constructor({ token, region = 'eu1', baseUrl, fetchImpl = fetch }) {
		if (!token) throw new Error('SESAME_API_TOKEN is not set');
		if (!baseUrl && !/^[a-z0-9-]+$/.test(region)) throw new Error('SESAME_REGION can only contain letters, numbers and dashes (for example eu1)');
		this.token = token;
		this.baseUrl = String(baseUrl || `https://api-${region}.sesametime.com`).replace(/\/+$/, '');
		this.fetch = fetchImpl;
	}

	async request(method, path, { query, body } = {}) {
		const url = new URL(this.baseUrl + path);
		for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
		const res = await this.fetch(url, {
			method,
			headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await res.text();
		let data = {};
		try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
		if (!res.ok) throw new Error(`Sesame HR ${res.status}: ${data.message ?? data.error?.message ?? 'request failed'}`);
		return data;
	}

	// Paginated lists: { data, meta: { lastPage } }, capped so a tool answer stays small.
	async list(path, query = {}, max = 100) {
		const out = [];
		for (let page = 1; out.length < max; page++) {
			const res = await this.request('GET', path, { query: { ...query, page, limit: Math.min(100, max) } });
			const rows = Array.isArray(res.data) ? res.data : [];
			out.push(...rows);
			if (!rows.length || page >= Number(res.meta?.lastPage ?? page)) break;
		}
		return out.slice(0, max);
	}
}

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e.message }] });
const wrap = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };
const unwrap = (r) => (r && typeof r === 'object' && 'data' in r ? r.data : r);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const origin = z.enum(['web', 'mobile', 'wall', 'watch']).default('web').describe('Where the check is recorded from; must be allowed in Sesame');
const read = { readOnlyHint: true };
// Keeps employee answers short and without personal IDs (bank, social security, ID numbers).
const brief = (e) => ({ id: e.id, firstName: e.firstName, lastName: e.lastName, email: e.email, code: e.code, status: e.status, workStatus: e.workStatus });

export function createServer(client) {
	const server = new McpServer({ name: 'sesame-hr-mcp', version: '0.1.0' });

	server.registerTool('find_employees', {
		description: 'Find employees by email or employee code, or list active ones. Returns IDs needed by the other tools.',
		inputSchema: { email: z.string().email().optional(), code: z.number().int().optional(), limit: z.number().int().min(1).max(100).default(50) }, annotations: read,
	}, wrap(async ({ email, code, limit }) => (await client.list('/core/v3/employees', { email, code, status: 'active' }, limit)).map(brief)));

	server.registerTool('clock_in', {
		description: 'Clock an employee in now.',
		inputSchema: { employee_id: z.string().min(1), origin },
	}, wrap(async ({ employee_id, origin: o }) => unwrap(await client.request('POST', '/schedule/v1/work-entries/clock-in', { body: { employeeId: employee_id, origin: o } }))));

	server.registerTool('clock_out', {
		description: 'Clock an employee out now (ends the open work entry).',
		inputSchema: { employee_id: z.string().min(1), origin },
	}, wrap(async ({ employee_id, origin: o }) => unwrap(await client.request('POST', '/schedule/v1/work-entries/clock-out', { body: { employeeId: employee_id, origin: o } }))));

	server.registerTool('list_work_entries', {
		description: 'Work entries (clock-ins and outs) between two dates, optionally for one employee.',
		inputSchema: { from: date, to: date, employee_id: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) }, annotations: read,
	}, wrap(({ from, to, employee_id, limit }) => client.list('/schedule/v1/work-entries', { from, to, employeeId: employee_id }, limit)));

	for (const kind of ['vacation', 'absence']) {
		server.registerTool(`list_${kind}_requests`, {
			description: `${kind === 'vacation' ? 'Vacation' : 'Absence'} requests, by default the pending ones.`,
			inputSchema: { status: z.enum(['pending', 'accepted', 'rejected']).default('pending'), employee_id: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) }, annotations: read,
		}, wrap(({ status, employee_id, limit }) => client.list(`/schedule/v1/${kind}-day-off-requests`, { status, employeeId: employee_id }, limit)));
		for (const action of ['accept', 'reject']) {
			const takesComment = !(kind === 'vacation' && action === 'accept');
			server.registerTool(`${action}_${kind}_request`, {
				description: `${action === 'accept' ? 'Accept' : 'Reject'} a ${kind} request. Confirm with the user before calling it.${takesComment ? '' : ' Sesame does not take a comment here.'}`,
				inputSchema: { request_id: z.string().min(1), manager_id: z.string().optional(), ...(takesComment ? { comment: z.string().optional() } : {}) },
				annotations: { destructiveHint: true },
			}, wrap(async ({ request_id, manager_id, comment }) => {
				const body = {};
				if (manager_id) body.managerId = manager_id;
				if (takesComment && comment) body.resolutionComment = comment;
				return unwrap(await client.request('POST', `/schedule/v1/${kind}-day-off-requests/${encodeURIComponent(request_id)}/${action}`, { body }));
			}));
		}
	}
	return server;
}
