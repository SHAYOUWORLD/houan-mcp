#!/usr/bin/env node

const SERVER_NAME = "houan-mcp";
const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2025-06-18";
const NDL_API_BASE = "https://kokkai.ndl.go.jp/api";
const NDL_TXT_BASE = "https://kokkai.ndl.go.jp/txt";
const SHUGIIN_BASE = "https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian";
const SANGIIN_BASE = "https://www.sangiin.go.jp/japanese/joho1/kousei/gian";
const DEFAULT_SESSION = 221;
const REQUEST_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.HOUAN_MCP_TIMEOUT_MS ?? "20000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
})();

const tools = [
  {
    name: "find_diet_qa",
    description:
      "Full-text search of Japanese Diet committee speeches via the NDL Kokkai API. Returns speeches matching the keyword along with speaker, position, committee, and the canonical NDL URL.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Full-text query. Spaces are AND." },
        from: { type: "string", description: "Date range start, YYYY-MM-DD." },
        until: { type: "string", description: "Date range end, YYYY-MM-DD." },
        chamber: {
          type: "string",
          enum: ["衆議院", "参議院", "両院", "両院協議会"],
          description: "Chamber filter.",
        },
        committee: {
          type: "string",
          description: "Committee name, e.g. 外務委員会. Spaces are OR.",
        },
        speaker: { type: "string", description: "Speaker name." },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of results. Defaults to 10.",
        },
      },
      required: ["keyword"],
      additionalProperties: false,
    },
  },
  {
    name: "get_meeting_record",
    description:
      "Retrieve the full transcript of one Diet committee meeting by issueID via the NDL Kokkai API. Use the issueID from a find_diet_qa result.",
    inputSchema: {
      type: "object",
      properties: {
        issueID: {
          type: "string",
          description: "Meeting issueID, e.g. 122103968X00620260410.",
        },
      },
      required: ["issueID"],
      additionalProperties: false,
    },
  },
  {
    name: "search_bills",
    description:
      "Search current-session Japanese Diet bills (衆議院議案情報 / 参議院議案情報) by title keyword. Returns bill metadata with proceedings and full-text URLs.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Keyword to match in bill title." },
        chamber: {
          type: "string",
          enum: ["shugiin", "sangiin", "both"],
          description: "Which chamber to search. Defaults to both.",
        },
        session: {
          type: "number",
          minimum: 1,
          description: "Diet session number. Defaults to 221.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          description: "Maximum number of results. Defaults to 30.",
        },
      },
      required: ["keyword"],
      additionalProperties: false,
    },
  },
  {
    name: "get_bill",
    description:
      "Retrieve detail of one bill by chamber and proceedings URL. Returns title, submitter, committee assignment, and a status timeline parsed from the proceedings page.",
    inputSchema: {
      type: "object",
      properties: {
        chamber: {
          type: "string",
          enum: ["shugiin", "sangiin"],
          description: "Chamber the bill is registered with.",
        },
        proceedingURL: {
          type: "string",
          description: "Proceedings URL returned by search_bills.",
        },
      },
      required: ["chamber", "proceedingURL"],
      additionalProperties: false,
    },
  },
];

function writeJson(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function log(message) {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

function rpcResult(id, result) {
  writeJson({ jsonrpc: "2.0", id, result });
}

function rpcError(id, code, message, data) {
  const error = data === undefined ? { code, message } : { code, message, data };
  writeJson({ jsonrpc: "2.0", id, error });
}

function assertString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function clampNumber(value, fallback, min, max) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function nowIso() {
  return new Date().toISOString();
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html) {
  return decodeHtmlEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

async function fetchAllowed(url, expectedOrigin, accept) {
  const target = new URL(url);
  if (target.origin !== expectedOrigin) {
    throw new Error(`Refused fetch outside ${expectedOrigin}: ${url}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": `${SERVER_NAME}/${SERVER_VERSION} (+https://github.com/SHAYOUWORLD/houan-mcp)`,
        Accept: accept,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${target.host}${target.pathname}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  const response = await fetchAllowed(url, "https://kokkai.ndl.go.jp", "application/json");
  return await response.json();
}

async function fetchHtml(url, expectedOrigin) {
  const response = await fetchAllowed(url, expectedOrigin, "text/html,*/*");
  // Pages may declare Shift_JIS but most serve UTF-8 in practice; rely on content-type.
  return await response.text();
}

function attribution(extra) {
  return {
    name: "国会会議録検索システム (NDL Kokkai)",
    url: "https://kokkai.ndl.go.jp/",
    apiDocs: "https://kokkai.ndl.go.jp/api.html",
    attribution: "出典: 国会会議録検索システム（https://kokkai.ndl.go.jp/）",
    retrievedAt: nowIso(),
    ...(extra ?? {}),
  };
}

function billsAttribution(extra) {
  return {
    name: "衆議院議案情報 / 参議院議案情報",
    shugiin: "https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm",
    sangiin: "https://www.sangiin.go.jp/japanese/joho1/kousei/gian/index.htm",
    attribution: "出典: 衆議院議案情報 / 参議院議案情報",
    retrievedAt: nowIso(),
    ...(extra ?? {}),
  };
}

function buildSpeechApiUrl(args) {
  const params = new URLSearchParams();
  params.set("any", args.keyword);
  params.set("recordPacking", "json");
  params.set("maximumRecords", String(args.limit));
  if (args.from) params.set("from", args.from);
  if (args.until) params.set("until", args.until);
  if (args.chamber) params.set("nameOfHouse", args.chamber);
  if (args.committee) params.set("nameOfMeeting", args.committee);
  if (args.speaker) params.set("speaker", args.speaker);
  return `${NDL_API_BASE}/speech?${params.toString()}`;
}

async function findDietQa(args) {
  const keyword = assertString(args?.keyword, "keyword");
  const limit = clampNumber(args?.limit, 10, 1, 100);
  const apiArgs = {
    keyword,
    limit,
    from: typeof args?.from === "string" ? args.from.trim() : undefined,
    until: typeof args?.until === "string" ? args.until.trim() : undefined,
    chamber: typeof args?.chamber === "string" ? args.chamber.trim() : undefined,
    committee: typeof args?.committee === "string" ? args.committee.trim() : undefined,
    speaker: typeof args?.speaker === "string" ? args.speaker.trim() : undefined,
  };

  const url = buildSpeechApiUrl(apiArgs);
  const data = await fetchJson(url);
  const records = Array.isArray(data?.speechRecord) ? data.speechRecord : [];

  const results = records.map((rec) => {
    const speech = typeof rec.speech === "string" ? rec.speech : "";
    return {
      speechURL: rec.speechURL,
      meetingURL: rec.meetingURL,
      issueID: rec.issueID,
      speechID: rec.speechID,
      session: rec.session,
      chamber: rec.nameOfHouse,
      committee: rec.nameOfMeeting,
      issue: rec.issue,
      date: rec.date,
      speechOrder: rec.speechOrder,
      speaker: rec.speaker,
      speakerPosition: rec.speakerPosition,
      speakerGroup: rec.speakerGroup,
      speakerRole: rec.speakerRole,
      snippet: speech.length > 400 ? `${speech.slice(0, 400)}…` : speech,
      speech,
    };
  });

  return {
    query: { keyword, ...apiArgs },
    apiURL: url,
    totalHits: typeof data?.numberOfRecords === "number" ? data.numberOfRecords : results.length,
    returned: results.length,
    nextRecordPosition: data?.nextRecordPosition ?? null,
    results,
    source: attribution(),
    note:
      "Diet records typically appear in NDL Kokkai about 1〜2 weeks after a meeting; very recent committee meetings may not yet be indexed.",
  };
}

async function getMeetingRecord(args) {
  const issueID = assertString(args?.issueID, "issueID");
  const url = `${NDL_API_BASE}/meeting?issueID=${encodeURIComponent(issueID)}&maximumRecords=1&recordPacking=json`;
  const data = await fetchJson(url);
  const records = Array.isArray(data?.meetingRecord) ? data.meetingRecord : [];
  if (records.length === 0) {
    return {
      issueID,
      apiURL: url,
      meeting: null,
      source: attribution(),
      note: `No meeting record returned for issueID ${issueID}. The meeting may not yet be indexed (1〜2 weeks lag is normal).`,
    };
  }
  const m = records[0];
  const speeches = Array.isArray(m.speechRecord) ? m.speechRecord : [];
  return {
    issueID,
    apiURL: url,
    meeting: {
      issueID: m.issueID,
      session: m.session,
      chamber: m.nameOfHouse,
      committee: m.nameOfMeeting,
      issue: m.issue,
      date: m.date,
      meetingURL: m.meetingURL ?? `${NDL_TXT_BASE}/${encodeURIComponent(m.issueID)}`,
      pdfURL: m.pdfURL ?? null,
      speechCount: speeches.length,
      speeches: speeches.map((s) => ({
        speechOrder: s.speechOrder,
        speaker: s.speaker,
        speakerYomi: s.speakerYomi,
        speakerPosition: s.speakerPosition,
        speakerGroup: s.speakerGroup,
        speakerRole: s.speakerRole,
        speechURL: s.speechURL,
        speech: s.speech,
      })),
    },
    source: attribution(),
  };
}

function shugiinIndexUrl(session) {
  return `${SHUGIIN_BASE}/${session}/${session}gian.htm`;
}

function sangiinIndexUrl(session) {
  return `${SANGIIN_BASE}/${session}/gian.htm`;
}

function absoluteShugiinUrl(href, session) {
  if (!href) return null;
  if (/^https?:/i.test(href)) return href;
  if (href.startsWith("./")) return `${SHUGIIN_BASE}/${session}/${href.slice(2)}`;
  if (href.startsWith("/")) return `https://www.shugiin.go.jp${href}`;
  return `${SHUGIIN_BASE}/${session}/${href}`;
}

function absoluteSangiinUrl(href, session) {
  if (!href) return null;
  if (/^https?:/i.test(href)) return href;
  if (href.startsWith("./")) return `${SANGIIN_BASE}/${session}/${href.slice(2)}`;
  if (href.startsWith("/")) return `https://www.sangiin.go.jp${href}`;
  return `${SANGIIN_BASE}/${session}/${href}`;
}

function parseShugiinBills(html, session) {
  const bills = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of html.matchAll(rowPattern)) {
    const row = rowMatch[1];
    const cells = [];
    for (const cell of row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      cells.push(cell[1]);
    }
    if (cells.length < 3) continue;
    const text = cells.map(stripTags);
    const numCell = text[0];
    if (!/^\d+$/.test(numCell)) continue;
    const links = [];
    for (const a of row.matchAll(/<a\s+[^>]*href=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/a>/gi)) {
      links.push({ href: a[1], text: stripTags(a[2]) });
    }
    const titleLink = links.find((l) => l.text && !/(過去|本文|要綱|英文|提出時)/.test(l.text));
    const proceeding = links.find((l) => /過去|経過|議案要旨|議案情報/.test(l.text));
    const fullText = links.find((l) => /本文/.test(l.text));
    bills.push({
      chamber: "shugiin",
      session,
      billNumber: numCell,
      title: titleLink ? titleLink.text : text[1] ?? "",
      status: text[text.length - 1] ?? "",
      proceedingURL: absoluteShugiinUrl(proceeding?.href ?? titleLink?.href ?? null, session),
      fullTextURL: absoluteShugiinUrl(fullText?.href ?? null, session),
    });
  }
  return bills;
}

function parseSangiinBills(html, session) {
  const bills = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of html.matchAll(rowPattern)) {
    const row = rowMatch[1];
    const cells = [];
    for (const cell of row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      cells.push(cell[1]);
    }
    if (cells.length < 2) continue;
    const text = cells.map(stripTags);
    const numCell = text[0];
    if (!/^\d+$/.test(numCell)) continue;
    const links = [];
    for (const a of row.matchAll(/<a\s+[^>]*href=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/a>/gi)) {
      links.push({ href: a[1], text: stripTags(a[2]) });
    }
    const titleLink = links.find((l) => l.text);
    bills.push({
      chamber: "sangiin",
      session,
      billNumber: numCell,
      title: titleLink ? titleLink.text : text[1] ?? "",
      status: text[text.length - 1] ?? "",
      proceedingURL: absoluteSangiinUrl(titleLink?.href ?? null, session),
      fullTextURL: null,
    });
  }
  return bills;
}

async function searchBills(args) {
  const keyword = assertString(args?.keyword, "keyword");
  const chamber = args?.chamber ?? "both";
  const session = clampNumber(args?.session, DEFAULT_SESSION, 1, 9999);
  const limit = clampNumber(args?.limit, 30, 1, 200);
  const needle = keyword.toLowerCase();

  const sources = {};
  const collected = [];

  if (chamber === "shugiin" || chamber === "both") {
    const url = shugiinIndexUrl(session);
    sources.shugiin = url;
    try {
      const html = await fetchHtml(url, "https://www.shugiin.go.jp");
      collected.push(...parseShugiinBills(html, session));
    } catch (err) {
      log(`shugiin fetch failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (chamber === "sangiin" || chamber === "both") {
    const url = sangiinIndexUrl(session);
    sources.sangiin = url;
    try {
      const html = await fetchHtml(url, "https://www.sangiin.go.jp");
      collected.push(...parseSangiinBills(html, session));
    } catch (err) {
      log(`sangiin fetch failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const filtered = collected
    .filter((b) => b.title && b.title.toLowerCase().includes(needle))
    .slice(0, limit);

  return {
    query: { keyword, chamber, session, limit },
    indexes: sources,
    totalScanned: collected.length,
    matched: filtered.length,
    results: filtered,
    source: billsAttribution({ session }),
    note:
      "Bill list pages on shugiin.go.jp / sangiin.go.jp are HTML-only (no public JSON API). Layout changes may affect parsing; report issues at https://github.com/SHAYOUWORLD/houan-mcp/issues.",
  };
}

async function getBill(args) {
  const chamber = assertString(args?.chamber, "chamber");
  if (chamber !== "shugiin" && chamber !== "sangiin") {
    throw new Error(`chamber must be shugiin or sangiin, got ${chamber}`);
  }
  const proceedingURL = assertString(args?.proceedingURL, "proceedingURL");
  const expectedOrigin =
    chamber === "shugiin" ? "https://www.shugiin.go.jp" : "https://www.sangiin.go.jp";
  const html = await fetchHtml(proceedingURL, expectedOrigin);

  const titleMatch =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) ??
    /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html);
  const title = titleMatch ? stripTags(titleMatch[1]) : null;

  const labelMap =
    chamber === "shugiin"
      ? {
          submitter: /提出者[^<]*<\/[^>]*>([\s\S]*?)<(?:tr|\/table)/i,
          submittedDate: /提出日[^<]*<\/[^>]*>([\s\S]*?)<(?:tr|\/table)/i,
          committee: /(?:衆議院での所属委員会|付託委員会|付託)[^<]*<\/[^>]*>([\s\S]*?)<(?:tr|\/table)/i,
          status: /(?:衆議院での審査状況|現状況|状況)[^<]*<\/[^>]*>([\s\S]*?)<(?:tr|\/table)/i,
        }
      : {
          submitter: /(?:提出者|発議者)[^<]*<\/[^>]*>([\s\S]*?)<(?:tr|\/table)/i,
          submittedDate: /(?:提出日|提出年月日)[^<]*<\/[^>]*>([\s\S]*?)<(?:tr|\/table)/i,
          committee: /(?:付託委員会|付託)[^<]*<\/[^>]*>([\s\S]*?)<(?:tr|\/table)/i,
          status: /(?:議案の状況|議案状況|参議院での審議|状況)[^<]*<\/[^>]*>([\s\S]*?)<(?:tr|\/table)/i,
        };

  const fields = {};
  const warnings = [];
  for (const [key, pattern] of Object.entries(labelMap)) {
    const m = pattern.exec(html);
    if (m) {
      fields[key] = stripTags(m[1]);
    } else {
      fields[key] = null;
      warnings.push(`field ${key} not parsed from ${chamber} page`);
    }
  }

  const timeline = [];
  const tablePattern = /<table[\s\S]*?<\/table>/gi;
  for (const tableMatch of html.matchAll(tablePattern)) {
    const table = tableMatch[0];
    if (!/(経過|状況|処理|採決|可決|否決)/.test(table)) continue;
    for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cellTexts = [];
      for (const cell of row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
        cellTexts.push(stripTags(cell[1]));
      }
      if (cellTexts.length >= 2 && cellTexts[0]) {
        timeline.push({ label: cellTexts[0], detail: cellTexts.slice(1).join(" / ") });
      }
    }
    if (timeline.length > 0) break;
  }

  return {
    chamber,
    proceedingURL,
    title,
    submitter: fields.submitter,
    submittedDate: fields.submittedDate,
    committee: fields.committee,
    status: fields.status,
    timeline,
    parseWarnings: warnings,
    source: billsAttribution(),
  };
}

async function callTool(name, args) {
  switch (name) {
    case "find_diet_qa":
      return findDietQa(args);
    case "get_meeting_record":
      return getMeetingRecord(args);
    case "search_bills":
      return searchBills(args);
    case "get_bill":
      return getBill(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function toolResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

async function handleRequest(message) {
  if (!message || message.jsonrpc !== "2.0") {
    rpcError(message?.id ?? null, -32600, "Invalid JSON-RPC message");
    return;
  }

  const { id, method, params } = message;

  try {
    switch (method) {
      case "initialize":
        rpcResult(id, {
          protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
        break;

      case "notifications/initialized":
        break;

      case "ping":
        rpcResult(id, {});
        break;

      case "tools/list":
        rpcResult(id, { tools });
        break;

      case "tools/call": {
        const toolName = assertString(params?.name, "params.name");
        const data = await callTool(toolName, params?.arguments ?? {});
        rpcResult(id, toolResult(data));
        break;
      }

      default:
        if (id !== undefined) {
          rpcError(id, -32601, `Method not found: ${method}`);
        }
        break;
    }
  } catch (error) {
    log(error?.stack ?? String(error));
    if (id !== undefined) {
      rpcError(id, -32000, error instanceof Error ? error.message : String(error));
    }
  }
}

async function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    rpcError(null, -32700, "Parse error", error instanceof Error ? error.message : String(error));
    return;
  }
  if (Array.isArray(message)) {
    for (const item of message) {
      await handleRequest(item);
    }
    return;
  }
  await handleRequest(message);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    void handleLine(line);
  }
});

process.stdin.on("end", () => {
  if (buffer.trim()) {
    void handleLine(buffer);
  }
});

process.on("uncaughtException", (error) => {
  log(error?.stack ?? String(error));
});

process.on("unhandledRejection", (error) => {
  log(error?.stack ?? String(error));
});
