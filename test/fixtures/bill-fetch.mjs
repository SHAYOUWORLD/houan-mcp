// Preload only in tests: all network access is replaced, including NDL calls.
import { readFileSync } from 'node:fs';
const scenario = process.env.BILL_TEST_SCENARIO ?? 'normal';
const fixture = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const html = (body) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  process.stderr.write(`[bill-fetch] ${url}\n`);
  if (url.hostname === 'www.shugiin.go.jp') {
    if (scenario === 'http-error' || scenario === 'all-error') return new Response('', { status: 400 });
    if (scenario === 'network-error') throw new Error('connection failed');
    if (scenario === 'timeout') return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('request timed out')), { once: true });
    });
    if (/\/keika\//.test(url.pathname)) return html(fixture('shugiin-proceedings.html'));
    const session = /\/kaiji(221|222)\.htm$/.exec(url.pathname)?.[1];
    if (!session) throw new Error(`Unexpected Shugiin URL ${url}`);
    let body = fixture(`shugiin-${session}.html`);
    if (scenario === 'unknown-layout') body = '<html><h1>Service unavailable</h1><table><tr><td>222</td><td>1</td><td>法律案</td></tr></table></html>';
    if (scenario === 'partial-header-change') body = body.replace('議案件名', '新しい件名列');
    if (scenario === 'missing-header') body = body.replaceAll('議案件名', '新しい件名列');
    if (scenario === 'malformed-row') body = body.replace(/<td[^>]*><span class="txt03">政治資金規正法[^<]*<\/span><\/td>/, '');
    if (scenario === 'empty') body = body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi,
      (row) => /<td\b/i.test(row) ? '' : row);
    if (scenario === 'link-variants') body = body
      .replace('./keika/1DE2D1E.htm', '/internet/itdb_gian.nsf/html/gian/keika/1DE2D1E.htm?x=1&amp;y=2')
      .replace('href="./honbun/g22105001.htm"', "href='https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/honbun/g22105001.htm'");
    if (scenario === 'reordered') body = body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
      const cells = [...row.matchAll(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)].map((m) => m[0]);
      if (cells.length !== 6) return row;
      [cells[1], cells[2]] = [cells[2], cells[1]];
      return `<tr>${cells.join('')}</tr>`;
    });
    return html(body);
  }
  if (url.hostname === 'www.sangiin.go.jp') {
    if (scenario === 'sangiin-error' || scenario === 'all-error') return new Response('', { status: 503 });
    if (/\/meisai\//.test(url.pathname)) return html(fixture('sangiin-proceedings.html'));
    if (!/\/222\/gian\.htm$/.test(url.pathname)) throw new Error(`Unexpected Sangiin URL ${url}`);
    return html(fixture('sangiin-222.html'));
  }
  if (url.hostname === 'kokkai.ndl.go.jp' && url.pathname === '/api/speech') {
    return json({ numberOfRecords: 1, speechRecord: [{ issueID: '122103968X00620260410',
      speechID: 'test-speech', session: 221, nameOfHouse: '衆議院', nameOfMeeting: '外務委員会',
      speaker: 'テスト', speech: 'テスト答弁', speechURL: 'https://kokkai.ndl.go.jp/txt/test' }] });
  }
  if (url.hostname === 'kokkai.ndl.go.jp' && url.pathname === '/api/meeting') {
    return json({ meetingRecord: [{ issueID: url.searchParams.get('issueID'),
      session: 221, speechRecord: [{ speechOrder: 1, speaker: 'テスト', speech: 'テスト答弁' }] }] });
  }
  throw new Error(`Unexpected fetch ${url}`);
};
