# @codeagentjp/houan-mcp

Local stdio MCP server for searching Japanese **Diet bills (衆参議案情報)** and **committee Q&A records** via the [NDL Kokkai (国会会議録検索システム) API](https://kokkai.ndl.go.jp/).

This server does not call an LLM. It only returns source-backed Diet data, with primary URLs (NDL Kokkai, 衆議院議案情報, 参議院議案情報) so your MCP client (Claude Desktop, Claude Code, Cursor, or any other agent) can cite the original source.

Sister package: [`@codeagentjp/egov-law-mcp`](https://www.npmjs.com/package/@codeagentjp/egov-law-mcp) for current Japanese laws (e-Gov Law Search). `houan-mcp` covers the *legislative process* side: bills under deliberation, committee questionings, and full meeting transcripts.

## Status

MVP. Four tools:

- `find_diet_qa` — full-text search across all Diet committee speeches via the NDL Kokkai API. Filter by date, chamber, committee, speaker.
- `get_meeting_record` — retrieve a single committee's full transcript by `issueID`.
- `search_bills` — search current-session bills in either house by title keyword.
- `get_bill` — retrieve detail of one bill (proceedings timeline, committee assignment, full-text URL).

## Requirements

- Node.js 20 or later
- Network access to `https://kokkai.ndl.go.jp`, `https://www.shugiin.go.jp`, `https://www.sangiin.go.jp`

## Install

From npm:

```json
{
  "mcpServers": {
    "houan": {
      "command": "npx",
      "args": ["-y", "@codeagentjp/houan-mcp"]
    }
  }
}
```

From source:

```bash
git clone https://github.com/SHAYOUWORLD/houan-mcp.git
cd houan-mcp
node bin/houan-mcp.mjs
```

```json
{
  "mcpServers": {
    "houan": {
      "command": "node",
      "args": ["/absolute/path/to/houan-mcp/bin/houan-mcp.mjs"]
    }
  }
}
```

## Tools

### `find_diet_qa`

Full-text search of Diet committee speeches via the NDL Kokkai API.

```json
{
  "keyword": "クロード ミトス",
  "from": "2026-04-01",
  "until": "2026-04-25",
  "chamber": "衆議院",
  "committee": "外務委員会",
  "limit": 5
}
```

Returns matched speeches with speaker, position, committee context, and direct NDL URL.

### `get_meeting_record`

Retrieve a single full transcript by `issueID`.

```json
{
  "issueID": "122103968X00620260410"
}
```

### `search_bills`

Search 衆議院議案情報 / 参議院議案情報 by title keyword.

```json
{
  "keyword": "情報",
  "chamber": "both",
  "session": 221,
  "limit": 20
}
```

### `get_bill`

Retrieve a bill detail page (proceedings timeline, committee assignment, full-text URL). The `proceedingURL` must be a URL returned by `search_bills` — it is validated against the chamber's allowed path prefix before fetching.

```json
{
  "chamber": "shugiin",
  "proceedingURL": "https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/keika/1DE..."
}
```

## Data Sources and Attribution

This package uses three Japanese public sources:

- **NDL Kokkai (国会会議録検索システム)** — <https://kokkai.ndl.go.jp/> · [API documentation](https://kokkai.ndl.go.jp/api.html). Diet records published 1947–. No auth required. Be a good neighbour: insert short delays between sequential requests, avoid concurrent bursts.
- **衆議院議案情報** — <https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm>
- **参議院議案情報** — <https://www.sangiin.go.jp/japanese/joho1/kousei/gian/index.htm>

Tool results include the source URL. When you publish or redistribute output based on this package, include an appropriate attribution. Suggested:

> 出典: 国会会議録検索システム (https://kokkai.ndl.go.jp/) / 衆議院議案情報 / 参議院議案情報

## Example: pulling a Mythos Q&A

The 4/10 2026 衆議院外務委員会 questioning by 宇佐美登 (チームみらい) on Anthropic's Claude Mythos Preview can be retrieved like this:

```json
{
  "tool": "find_diet_qa",
  "arguments": {
    "keyword": "クロード",
    "from": "2026-04-01",
    "until": "2026-04-30"
  }
}
```

The response includes 花田貴裕 政府参考人's verbatim answer with `meetingURL` pointing to the canonical NDL record at `https://kokkai.ndl.go.jp/txt/122103968X00620260410`.

## Safety Notes

- This package is a **legislative reference tool, not legal/political advice**.
- It does not execute shell commands.
- It writes JSON-RPC messages only to stdout and logs only to stderr.
- It fetches only the NDL Kokkai API and 衆/参 議案情報 endpoints.
- Diet records in NDL typically appear with a 1–2 week lag after the committee meeting. If a recent meeting cannot be found, check back later or consult the chamber's video library directly.

## Related

- Sibling MCP for current laws: [`@codeagentjp/egov-law-mcp`](https://github.com/SHAYOUWORLD/egov-law-mcp)
- Roadmap (法令diff / 自治体条例 / 判例 MCPs): [SHAYOUWORLD/egov-law-mcp#1](https://github.com/SHAYOUWORLD/egov-law-mcp/issues/1)
- Background article: [codeagent.jp / Tools](https://codeagent.jp/tools/)

## License

[MIT](./LICENSE) © codeagent.jp
