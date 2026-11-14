# sesame-hr-mcp

MCP server for [Sesame HR](https://www.sesamehr.com/). It lets an AI assistant (Claude Desktop, Claude Code, Cursor or any MCP host) find employees, clock them in and out, read work entries and answer vacation or absence requests, through the official Sesame public API.

## Tools

| Tool | What it does |
|---|---|
| `find_employees` | Find active employees by email or code (short records, no personal ID numbers) |
| `clock_in` / `clock_out` | Clock an employee in or out now |
| `list_work_entries` | Work entries between two dates |
| `list_vacation_requests` / `list_absence_requests` | Requests by status (pending by default) |
| `accept_vacation_request` / `reject_vacation_request` | Answer a vacation request (marked as destructive, so hosts ask first) |
| `accept_absence_request` / `reject_absence_request` | Answer an absence request |

## Setup

Create an API token in Sesame (**Settings > Integrations > API**) and note your region (for example `eu1`). Then add the server to your MCP host, for example in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sesame": {
      "command": "npx",
      "args": ["-y", "sesame-hr-mcp"],
      "env": { "SESAME_API_TOKEN": "...", "SESAME_REGION": "eu1" }
    }
  }
}
```

Clock in/out uses the `web` origin by default; it must be allowed in your Sesame settings (web, mobile, wall or watch).

## Compatibility

Tested through a real MCP client over stdio against a mock that checks every request against the official Sesame OpenAPI definitions. Not yet tested against a live Sesame account.

## Development

```bash
npm install
npm run fetch-spec
npm test
```

## License

MIT
