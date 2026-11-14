// Downloads the official Sesame HR docs for the endpoints this node uses and builds test/sesame-spec.json (not committed).
import { writeFileSync } from 'node:fs';
import YAML from 'yaml';
const pages = ['showtokeninfo', 'listemployees', 'getemployee', 'createemployee', 'updateemployee', 'clockin', 'clockout', 'listworkentries', 'createworkentry', 'listvacationdayoffrequests', 'acceptvacationdayoffrequest', 'rejectvacationdayoffrequest', 'listabsencedayoffrequests', 'acceptabsencedayoffrequest', 'rejectabsencedayoffrequest'];
const spec = { openapi: '3.0.0', info: { title: 'Sesame HR subset', version: '1' }, paths: {}, components: { schemas: {} } };
for (const p of pages) {
	const md = await (await fetch(`https://apidocs.sesametime.com/api-reference/${p}.md`)).text();
	const m = md.match(/````yaml[^\n]*\n([\s\S]*?)\n````/);
	if (!m) throw new Error(`No OpenAPI block in ${p}`);
	const d = YAML.parse(m[1]);
	for (const [path, ops] of Object.entries(d.paths)) spec.paths[path] = { ...(spec.paths[path] ?? {}), ...ops };
	Object.assign(spec.components.schemas, d.components?.schemas ?? {});
}
// The docs mark "origin" as required for clock-in/out but do not define it; its values come from
// GET /core/v3/configurations/available-check-origin (web, mobile, wall, watch).
for (const p of ['/schedule/v1/work-entries/clock-in', '/schedule/v1/work-entries/clock-out']) {
	const s = spec.paths[p].post.requestBody.content['application/json'].schema;
	s.properties.origin = { type: 'string', enum: ['web', 'mobile', 'wall', 'watch'] };
}
writeFileSync(new URL('../test/sesame-spec.json', import.meta.url), JSON.stringify(spec));
console.log('endpoints:', Object.values(spec.paths).reduce((n, o) => n + Object.keys(o).length, 0));
