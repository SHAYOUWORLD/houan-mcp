// Preloaded with `node --import` so the server under test never reaches the
// network. Each fetch is reported on stderr as one `[mock-fetch] {json}` line
// with its start time, the time its body was fully read, and how many requests
// to the same origin were in flight when it started.

const LATENCY_MS = Number.parseInt(process.env.MOCK_FETCH_LATENCY_MS ?? "100", 10);
const inflightByOrigin = new Map();

function payloadFor(url) {
  if (url.origin === "https://kokkai.ndl.go.jp" && url.pathname === "/api/speech") {
    return {
      contentType: "application/json",
      text: JSON.stringify({
        numberOfRecords: 1,
        numberOfReturn: 1,
        startRecord: 1,
        nextRecordPosition: null,
        speechRecord: [
          {
            speechID: "122103968X00620260410_001",
            issueID: "122103968X00620260410",
            session: 221,
            nameOfHouse: "衆議院",
            nameOfMeeting: "外務委員会",
            issue: "第6号",
            date: "2026-04-10",
            speechOrder: 1,
            speaker: "テスト",
            speech: `mock speech for ${url.searchParams.get("any")}`,
            speechURL: "https://kokkai.ndl.go.jp/txt/122103968X00620260410/1",
            meetingURL: "https://kokkai.ndl.go.jp/txt/122103968X00620260410",
          },
        ],
      }),
    };
  }
  if (url.origin === "https://kokkai.ndl.go.jp" && url.pathname === "/api/meeting") {
    return {
      contentType: "application/json",
      text: JSON.stringify({
        numberOfRecords: 1,
        meetingRecord: [
          {
            issueID: url.searchParams.get("issueID"),
            session: 221,
            nameOfHouse: "衆議院",
            nameOfMeeting: "外務委員会",
            issue: "第6号",
            date: "2026-04-10",
            speechRecord: [],
          },
        ],
      }),
    };
  }
  return {
    contentType: "text/html; charset=utf-8",
    text: '<table><tr><td>1</td><td><a href="meisai/m1.htm">テスト法律案</a></td><td>提出</td></tr></table>',
  };
}

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  const inflight = (inflightByOrigin.get(url.origin) ?? 0) + 1;
  inflightByOrigin.set(url.origin, inflight);
  const entry = { origin: url.origin, path: url.pathname, start: Date.now(), inflightAtStart: inflight };
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    inflightByOrigin.set(url.origin, inflightByOrigin.get(url.origin) - 1);
    entry.end = Date.now();
    process.stderr.write(`[mock-fetch] ${JSON.stringify(entry)}\n`);
  };

  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  const { contentType, text } = payloadFor(url);
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  const body = new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(bytes);
        return;
      }
      controller.close();
      finish();
    },
    cancel() {
      finish();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
};
