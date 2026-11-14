// Small Sesame HR mock that checks every request against the official OpenAPI subset (test/sesame-spec.json):
// path and method exist, query parameters are declared, required body fields and enums, Bearer token.
// Keeps employees, work entries and requests in memory. Usage: node test/mock-server.mjs [port]
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const spec = JSON.parse(readFileSync(new URL('./sesame-spec.json', import.meta.url)));
const TOKEN = 'test-token';
export const log = [];

const routes = Object.entries(spec.paths).flatMap(([p, ops]) =>
	Object.entries(ops).map(([method, op]) => ({
		method: method.toUpperCase(),
		re: new RegExp('^' + p.replace(/\{[^}]+\}/g, '([^/]+)') + '$'),
		op,
	})),
);

const resolve = (s) => (s?.$ref ? spec.components.schemas[s.$ref.split('/').pop()] : s);

function validateBody(schema, body, where = 'body') {
	schema = resolve(schema);
	const errors = [];
	if (!schema || schema.type !== 'object') return errors;
	for (const r of schema.required ?? []) if (body?.[r] === undefined) errors.push(`${where}.${r} is required`);
	for (const [k, v] of Object.entries(body ?? {})) {
		const ps = resolve(schema.properties?.[k]);
		if (!ps) { errors.push(`${where}.${k} is not in the spec`); continue; }
		if (ps.enum && !ps.enum.includes(v)) errors.push(`${where}.${k} must be one of ${ps.enum.join(', ')}`);
		if (ps.type === 'object' && typeof v === 'object') errors.push(...validateBody(ps, v, `${where}.${k}`));
		if (ps.format === 'Y-m-dTH:i:sP' && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(v)) errors.push(`${where}.${k} must be Y-m-dTH:i:sP`);
		if (ps.format === 'date' && !/^\d{4}-\d\d-\d\d$/.test(v)) errors.push(`${where}.${k} must be Y-m-d`);
	}
	return errors;
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
const company = { id: '11111111-1111-4111-8111-111111111111', name: 'Demo SL' };
const db = {
	employees: [
		{ id: 'e1', firstName: 'Lucia', lastName: 'Garcia', email: 'lucia@demo.test', status: 'active', code: 1, phone: '600000001', personalMail: 'l@home.test', children: 2, company, createdAt: '2026-01-01T09:00:00+00:00', updatedAt: '2026-01-01T09:00:00+00:00' },
		{ id: 'e2', firstName: 'Mario', lastName: 'Ruiz', email: 'mario@demo.test', status: 'active', code: 2, company, createdAt: '2026-01-02T09:00:00+00:00', updatedAt: '2026-01-02T09:00:00+00:00' },
	],
	workEntries: [],
	vacation: [{ id: 'v1', status: 'pending', employee: { id: 'e1' }, daysOff: [{ date: '2026-12-24' }], createdAt: '2026-11-10T10:00:00+00:00' }],
	absence: [{ id: 'a1', status: 'pending', employee: { id: 'e2' }, daysOff: [{ date: '2026-11-20' }], createdAt: '2026-11-11T10:00:00+00:00' }],
};

const page = (rows, q) => {
	const limit = Number(q.get('limit') ?? 20);
	const p = Number(q.get('page') ?? 1);
	const lastPage = Math.max(1, Math.ceil(rows.length / limit));
	return { data: rows.slice((p - 1) * limit, p * limit), meta: { currentPage: p, lastPage, total: rows.length, perPage: limit } };
};

function handle(method, path, q, body) {
	const emp = (id) => db.employees.find((e) => e.id === id);
	if (method === 'GET' && path === '/core/v3/info') return [200, { data: { company } }];
	if (method === 'GET' && path === '/core/v3/employees') {
		let rows = db.employees;
		if (q.get('email')) rows = rows.filter((e) => e.email === q.get('email'));
		if (q.get('status')) rows = rows.filter((e) => e.status === q.get('status'));
		return [200, page(rows, q)];
	}
	let m;
	if ((m = path.match(/^\/core\/v3\/employees\/([^/]+)$/))) {
		const e = emp(m[1]);
		if (!e) return [404, { message: 'Employee not found' }];
		if (method === 'GET') return [200, { data: e }];
		if (method === 'PUT') { Object.assign(e, body, { updatedAt: now() }); return [200, { data: e }]; }
	}
	if (method === 'POST' && path === '/core/v3/employees') {
		if (body.companyId !== company.id) return [422, { message: 'Invalid companyId' }];
		const e = { id: randomUUID(), ...body, company, createdAt: now(), updatedAt: now() };
		db.employees.push(e);
		return [201, { data: e }];
	}
	if (path === '/schedule/v1/work-entries') {
		if (method === 'GET') {
			let rows = db.workEntries;
			if (q.get('employeeId')) rows = rows.filter((w) => w.employee.id === q.get('employeeId'));
			if (q.get('updatedAt[gte]')) rows = rows.filter((w) => w.updatedAt >= q.get('updatedAt[gte]'));
			if ((q.get('orderBy') ?? '').endsWith('desc')) rows = [...rows].reverse();
			return [200, page(rows, q)];
		}
		if (!emp(body.employeeId)) return [404, { message: 'Employee not found' }];
		const w = { id: randomUUID(), employee: { id: body.employeeId }, workEntryType: body.workEntryType, workEntryIn: body.workEntryIn, workEntryOut: body.workEntryOut ?? null, createdAt: now(), updatedAt: now() };
		db.workEntries.push(w);
		return [200, { data: w }];
	}
	if (method === 'POST' && path === '/schedule/v1/work-entries/clock-in') {
		if (!emp(body.employeeId)) return [404, { message: 'Employee not found' }];
		if (db.workEntries.some((w) => w.employee.id === body.employeeId && !w.workEntryOut)) return [409, { message: 'Employee is already clocked in' }];
		const w = { id: randomUUID(), employee: { id: body.employeeId }, workEntryType: 'work', workEntryIn: { date: now() }, workEntryOut: null, createdAt: now(), updatedAt: now() };
		db.workEntries.push(w);
		return [200, { data: w }];
	}
	if (method === 'POST' && path === '/schedule/v1/work-entries/clock-out') {
		const w = db.workEntries.find((x) => x.employee.id === body.employeeId && !x.workEntryOut);
		if (!w) return [409, { message: 'Employee is not clocked in' }];
		Object.assign(w, { workEntryOut: { date: now() }, updatedAt: now() });
		return [200, { data: w }];
	}
	if ((m = path.match(/^\/schedule\/v1\/(vacation|absence)-day-off-requests(?:\/([^/]+)\/(accept|reject))?$/))) {
		const list = db[m[1]];
		if (!m[2]) {
			let rows = list;
			if (q.get('status')) rows = rows.filter((r) => r.status === q.get('status'));
			if (q.get('createdAt[gt]')) rows = rows.filter((r) => r.createdAt > q.get('createdAt[gt]'));
			return [200, page(rows, q)];
		}
		const r = list.find((x) => x.id === m[2]);
		if (!r) return [404, { message: 'Request not found' }];
		if (r.status !== 'pending') return [409, { message: 'Request already resolved' }];
		Object.assign(r, { status: m[3] === 'accept' ? 'accepted' : 'rejected', resolutionComment: body.resolutionComment ?? null, resolvedAt: now() });
		return [200, { data: r }];
	}
	return [501, { message: 'Not implemented in the mock' }];
}

// Adds a record "from Sesame" (used to test the trigger).
export const seed = (kind, row) => db[kind].push({ createdAt: now(), updatedAt: now(), ...row });

export function start(port = 4010) {
	const server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const u = new URL(req.url, 'http://x');
			const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
			const route = routes.find((r) => r.method === req.method && r.re.test(u.pathname));
			log.push(`${req.method} ${u.pathname}${u.search}`);
			if (!route) return send(404, { message: `Not in the Sesame spec: ${req.method} ${u.pathname}` });
			if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'Unauthorized' });
			const declared = new Set((route.op.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name));
			const bad = [...u.searchParams.keys()].filter((k) => !declared.has(k));
			if (bad.length) return send(400, { message: `Query parameters not in the spec: ${bad.join(', ')}` });
			let body = {};
			try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, { message: 'Body is not JSON' }); }
			const schema = route.op.requestBody?.content?.['application/json']?.schema;
			const errs = schema ? validateBody(schema, body) : raw && raw !== '{}' ? ['this endpoint takes no body'] : [];
			if (errs.length) return send(422, { message: errs.join('; ') });
			const [code, out] = handle(req.method, u.pathname, u.searchParams, body);
			send(code, out);
		});
	});
	return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (process.argv[1]?.endsWith('mock-server.mjs')) start(Number(process.argv[2] ?? 4010)).then(() => console.log('mock ready'));
