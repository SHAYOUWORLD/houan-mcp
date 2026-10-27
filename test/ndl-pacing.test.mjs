import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/houan-mcp.mjs", import.meta.url));
const MOCK_FETCH = new URL("./fixtures/mock-fetch.mjs", import.meta.url).href;
const NDL_ORIGIN = "https://kokkai.ndl.go.jp";
const SANGIIN_ORIGIN = "https://www.sangiin.go.jp";
const NDL_MIN_INTERVAL_MS = 3000;

function call(id, name, args) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

// Starts the real server with fetch mocked, writes every line at once, closes
// stdin, and waits for the server to finish all queued work and exit.
function runServer(lines, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  if (!("HOUAN_MCP_NDL_INTERVAL_MS" in envOverrides)) delete env.HOUAN_MCP_NDL_INTERVAL_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", MOCK_FETCH, BIN], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const responses = stdout
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line))
        .flat();
      const fetches = stderr
        .split("\n")
        .filter((line) => line.startsWith("[mock-fetch] "))
        .map((line) => JSON.parse(line.slice("[mock-fetch] ".length)))
        .sort((a, b) => a.start - b.start);
      resolve({ code, responses, fetches, stderr });
    });
    child.stdin.end(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  });
}

function assertAllSucceeded(responses, ids) {
  assert.deepEqual(
    responses.map((r) => r.id).sort((a, b) => a - b),
    ids,
  );
  for (const response of responses) {
    assert.equal(response.error, undefined, `id ${response.id}: ${JSON.stringify(response.error)}`);
  }
}

function assertNdlPaced(fetches, intervalMs) {
  const ndl = fetches.filter((f) => f.origin === NDL_ORIGIN);
  for (const f of ndl) {
    assert.equal(f.inflightAtStart, 1, `concurrent NDL request at ${f.path}`);
  }
  for (let i = 1; i < ndl.length; i++) {
    const gap = ndl[i].start - ndl[i - 1].end;
    assert.ok(gap >= intervalMs, `NDL request ${i + 1} started ${gap}ms after the previous one finished`);
  }
  return ndl;
}

describe("NDL Kokkai API pacing", { concurrency: true }, () => {
  it("sends NDL requests one at a time, at least 3s after the previous one finished", async () => {
    const { code, responses, fetches } = await runServer([
      [
        call(1, "find_diet_qa", { keyword: "予算" }),
        call(2, "find_diet_qa", { keyword: "外交" }),
        call(3, "get_meeting_record", { issueID: "122103968X00620260410" }),
      ],
      call(4, "find_diet_qa", { keyword: "教育" }),
      call(5, "find_diet_qa", { keyword: "予算" }),
    ]);

    assert.equal(code, 0);
    assertAllSucceeded(responses, [1, 2, 3, 4, 5]);
    const text = JSON.parse(responses.find((r) => r.id === 1).result.content[0].text);
    assert.equal(text.results[0].speech, "mock speech for 予算");

    // id 5 repeats id 1 and is served from the cache without touching NDL.
    const ndl = assertNdlPaced(fetches, NDL_MIN_INTERVAL_MS);
    assert.equal(ndl.length, 4);
  });

  it("ignores HOUAN_MCP_NDL_INTERVAL_MS below 3s", async () => {
    const { responses, fetches } = await runServer(
      [call(1, "find_diet_qa", { keyword: "予算" }), call(2, "find_diet_qa", { keyword: "外交" })],
      { HOUAN_MCP_NDL_INTERVAL_MS: "0" },
    );

    assertAllSucceeded(responses, [1, 2]);
    assert.equal(assertNdlPaced(fetches, NDL_MIN_INTERVAL_MS).length, 2);
  });

  it("honours a longer HOUAN_MCP_NDL_INTERVAL_MS", async () => {
    const { responses, fetches } = await runServer(
      [call(1, "find_diet_qa", { keyword: "予算" }), call(2, "find_diet_qa", { keyword: "外交" })],
      { HOUAN_MCP_NDL_INTERVAL_MS: "4500" },
    );

    assertAllSucceeded(responses, [1, 2]);
    assert.equal(assertNdlPaced(fetches, 4500).length, 2);
  });

  it("does not hold bill pages behind the NDL interval", async () => {
    const { responses, fetches } = await runServer([
      call(1, "find_diet_qa", { keyword: "予算" }),
      call(2, "search_bills", { keyword: "テスト", chamber: "sangiin", session: 222 }),
    ]);

    assertAllSucceeded(responses, [1, 2]);
    const ndl = fetches.find((f) => f.origin === NDL_ORIGIN);
    const sangiin = fetches.find((f) => f.origin === SANGIIN_ORIGIN);
    assert.ok(sangiin.start - ndl.end < NDL_MIN_INTERVAL_MS);
  });
});
