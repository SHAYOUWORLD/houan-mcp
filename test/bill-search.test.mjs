import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = process.env.HOUAN_TEST_BIN ?? fileURLToPath(new URL('../bin/houan-mcp.mjs', import.meta.url));
const mock = new URL('./fixtures/bill-fetch.mjs', import.meta.url).href;
const base = 'https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/';
const title = '賃金上昇を上回る所得税の負担増加に対処するために所得税に関し講ずべき措置に関する法律案';
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const search = (args) => call(1, 'search_bills', { keyword: '法律案', chamber: 'shugiin', ...args });

function run(lines, scenario = 'normal', env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', mock, bin], {
      env: { ...process.env, BILL_TEST_SCENARIO: scenario, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Server test timed out')); }, 15000);
    child.stdout.setEncoding('utf8').on('data', (s) => { stdout += s; });
    child.stderr.setEncoding('utf8').on('data', (s) => { stderr += s; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0, stderr);
        resolve({ responses: stdout.trim().split('\n').map(JSON.parse).flat(),
          fetches: stderr.split('\n').filter((s) => s.startsWith('[bill-fetch] ')).map((s) => s.slice(13)), stderr });
      } catch (err) { reject(err); }
    });
    child.stdin.end(lines.map(JSON.stringify).join('\n') + '\n');
  });
}
function success(response) {
  assert.equal(response.error, undefined, JSON.stringify(response.error));
  assert.notEqual(response.result.isError, true, response.result.content[0].text);
  return JSON.parse(response.result.content[0].text);
}
function failure(response, chamber, pattern) {
  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, true);
  const data = JSON.parse(response.result.content[0].text);
  assert.equal(data.results, undefined);
  assert.equal(data.matched, undefined);
  const error = data.sourceErrors.find((e) => e.chamber === chamber);
  assert.ok(error);
  assert.match(error.message, pattern);
  assert.ok(error.url.startsWith('https://www.'));
  return data;
}

test('defaults to the latest listed session; separates number, title, status, and carryover session', async () => {
  const { responses, fetches } = await run([{ jsonrpc: '2.0', id: 0, method: 'tools/list' }, search({ keyword: title })]);
  const schema = responses[0].result.tools.find((t) => t.name === 'search_bills').inputSchema;
  assert.match(schema.properties.session.description, /latest session .*falls back to 222/);
  const data = success(responses[1]);
  assert.equal(data.query.session, 222);
  assert.equal(data.query.sessionSource, 'latest');
  assert.deepEqual(data.warnings, []);
  assert.deepEqual(fetches, [base + 'pulldown.htm', base + 'kaiji222.htm']);
  assert.equal(data.source.sangiin, 'https://www.sangiin.go.jp/japanese/joho1/kousei/gian/current/gian.htm');
  assert.equal(data.matched, 1);
  assert.deepEqual(data.results[0], {
    chamber: 'shugiin', session: 222, submittedSession: 221, billType: '衆法', billNumber: '30', title,
    status: '撤回', proceedingURL: base + 'keika/1DE2D72.htm', fullTextURL: base + 'honbun/g22105030.htm',
  });
});

test('handles an explicit historical session through kaiji221.htm', async () => {
  const { responses, fetches } = await run([search({ session: 221, keyword: '政治資金規正法' })]);
  const data = success(responses[0]);
  assert.equal(data.query.session, 221);
  assert.equal(data.query.sessionSource, 'argument');
  assert.ok(data.results.some((b) => b.billNumber === '1' && b.submittedSession === 221));
  assert.deepEqual(fetches, [base + 'kaiji221.htm']);
});

test('takes the highest session from the list regardless of option order, also for Sangiin-only searches', async () => {
  const { responses, fetches } = await run([search({ chamber: 'sangiin', keyword: '負担' })], 'pulldown-reversed');
  const data = success(responses[0]);
  assert.equal(data.query.session, 222);
  assert.equal(data.query.sessionSource, 'latest');
  assert.deepEqual(fetches, [base + 'pulldown.htm', 'https://www.sangiin.go.jp/japanese/joho1/kousei/gian/222/gian.htm']);
});

test('falls back to 222 with a warning when the session list cannot be read', async () => {
  for (const [scenario, reason] of [['pulldown-error', /HTTP 503/], ['pulldown-empty', /no sessions listed/]]) {
    const { responses, fetches } = await run([search({ keyword: title })], scenario);
    const data = success(responses[0]);
    assert.equal(data.query.session, 222);
    assert.equal(data.query.sessionSource, 'fallback');
    assert.equal(data.warnings.length, 1);
    assert.match(data.warnings[0], /pulldown\.htm/);
    assert.match(data.warnings[0], reason);
    assert.equal(data.matched, 1);
    assert.deepEqual(fetches, [base + 'pulldown.htm', base + 'kaiji222.htm']);
  }
  // When the list and the fallback session both fail, the error keeps the session-list warning.
  const { responses } = await run([search({})], 'http-error');
  assert.match(failure(responses[0], 'shugiin', /HTTP 400/).warnings[0], /pulldown\.htm \(HTTP 400/);
});

test('handles 衆法, 参法, 閣法 and missing full text without mixing their numbers', async () => {
  const { responses } = await run([search({ keyword: '負担' }), search({ keyword: '旧氏' })]);
  const bills = success(responses[0]).results;
  assert.ok(bills.some((b) => b.billType === '衆法' && b.submittedSession === 222 && b.billNumber === '1'));
  assert.ok(bills.some((b) => b.billType === '閣法' && b.billNumber === '1'));
  assert.equal(success(responses[1]).results[0].billType, '参法');
  // The sample retains the final cabinet bill, whose text is not published yet.
  const missing = (await run([search({ keyword: '商法' })])).responses[0];
  assert.equal(success(missing).results[0].fullTextURL, null);
});

test('reads the treaty table with no header <tr> and no full-text column', async () => {
  const { responses } = await run([search({ keyword: 'バングラデシュ' })]);
  const bill = success(responses[0]).results[0];
  assert.equal(bill.billType, '条約');
  assert.equal(bill.billNumber, '1');
  assert.equal(bill.proceedingURL, base + 'keika/1DE3662.htm');
  assert.equal(bill.fullTextURL, null);
});

test('unnumbered consent/settlement items do not use submitted session as bill number', async () => {
  const { responses } = await run([search({ keyword: '総調書' }), search({ keyword: '決算' })]);
  for (const response of responses) {
    const data = success(response);
    assert.ok(data.matched > 0);
    assert.ok(data.results.every((b) => b.billNumber === null && b.submittedSession > 0));
  }
});

test('resolves root-relative, absolute, single-quoted and entity-encoded links', async () => {
  const { responses } = await run([search({ keyword: '政治資金規正法' })], 'link-variants');
  const bill = success(responses[0]).results[0];
  assert.equal(bill.proceedingURL, base + 'keika/1DE2D1E.htm?x=1&y=2');
  assert.equal(bill.fullTextURL, base + 'honbun/g22105001.htm');
});

test('maps by table header even when columns are reordered', async () => {
  const { responses } = await run([search({ keyword: title })], 'reordered');
  const bill = success(responses[0]).results[0];
  assert.equal(bill.title, title);
  assert.equal(bill.billNumber, '30');
});

test('a genuine zero-match search and valid empty tables succeed', async () => {
  for (const scenario of ['normal', 'empty']) {
    const { responses } = await run([search({ keyword: '存在しない検索語' })], scenario);
    const data = success(responses[0]);
    assert.equal(data.matched, 0);
    assert.deepEqual(data.results, []);
    assert.equal(data.totalScanned === 0, scenario === 'empty');
  }
});

for (const [scenario, message] of [['http-error', /HTTP 400/], ['network-error', /connection failed/],
  ['timeout', /request timed out/], ['unknown-layout', /No recognized/],
  ['missing-header', /Unrecognized/], ['partial-header-change', /Unrecognized/], ['malformed-row', /Malformed row/]]) {
  test(`surfaces ${scenario} to MCP clients instead of zero hits`, async () => {
    const { responses } = await run([search({})], scenario, { HOUAN_MCP_TIMEOUT_MS: '30' });
    failure(responses[0], 'shugiin', message);
  });
}

test('a failure in either requested chamber fails the both search, including when the other has hits', async () => {
  for (const [scenario, chamber, message] of [['http-error', 'shugiin', /HTTP 400/], ['sangiin-error', 'sangiin', /HTTP 503/]]) {
    const { responses, fetches } = await run([search({ chamber: 'both', keyword: '負担' })], scenario);
    failure(responses[0], chamber, message);
    // Session list + both chamber lists.
    assert.equal(fetches.length, 3);
  }
  const { responses } = await run([search({ chamber: 'both' })], 'all-error');
  assert.equal(failure(responses[0], 'shugiin', /HTTP 400/).sourceErrors.length, 2);
});

test('both succeeds and applies limit after collecting both sources; repeated calls use cache', async () => {
  const { responses, fetches } = await run([search({ chamber: 'both', keyword: '負担', limit: 1 }),
    search({ chamber: 'both', keyword: '負担', limit: 200 })]);
  assert.equal(success(responses[0]).results.length, 1);
  const data = success(responses[1]);
  assert.ok(data.results.some((b) => b.chamber === 'sangiin'));
  assert.ok(data.results.some((b) => b.chamber === 'shugiin'));
  // The session list is cached along with both chamber lists.
  assert.deepEqual(fetches, [base + 'pulldown.htm', base + 'kaiji222.htm',
    'https://www.sangiin.go.jp/japanese/joho1/kousei/gian/222/gian.htm']);
});

test('search result links can be passed directly to get_bill for title, number and proceedings', async () => {
  const searched = await run([search({ keyword: title })]);
  const proceedingURL = success(searched.responses[0]).results[0].proceedingURL;
  const { responses } = await run([call(1, 'get_bill', { chamber: 'shugiin', proceedingURL })]);
  const data = success(responses[0]);
  assert.equal(data.title, title);
  assert.equal(data.billNumber, '30');
  assert.equal(data.submittedSession, 221);
  assert.equal(data.submitter, '鈴木 義弘君外三名');
  assert.equal(data.committee, '財務金融');
  assert.equal(data.status, '撤回許可');
  assert.ok(data.timeline.some((row) => row.label === '衆議院審査終了年月日／衆議院審査結果' && row.detail.includes('令和 8年10月20日')));
  assert.ok(!data.timeline.some((row) => row.label === '項目'));
});

test('existing protocol, both NDL tools, Sangiin search/detail, and URL validation still work', async () => {
  const { responses, fetches } = await run([
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: {} },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    call(2, 'find_diet_qa', { keyword: 'テスト', from: '2026-04-01', committee: '外務委員会' }),
    call(3, 'get_meeting_record', { issueID: '122103968X00620260410' }),
    search({ chamber: 'sangiin', session: 222, keyword: '負担' }),
    call(4, 'get_bill', { chamber: 'sangiin', proceedingURL: 'https://www.sangiin.go.jp/japanese/joho1/kousei/gian/222/meisai/m222080222001.htm' }),
    call(5, 'get_bill', { chamber: 'shugiin', proceedingURL: 'https://example.com/keika/test.htm' }),
  ]);
  assert.equal(responses[0].result.serverInfo.version, '0.1.3');
  assert.deepEqual(responses[1].result, {});
  assert.equal(success(responses[2]).results[0].speech, 'テスト答弁');
  assert.equal(success(responses[3]).meeting.speeches[0].speech, 'テスト答弁');
  const sangiin = success(responses[4]);
  assert.ok(sangiin.matched > 0);
  assert.ok(sangiin.results.every((b) => b.chamber === 'sangiin' && b.proceedingURL.includes('/222/meisai/')));
  assert.ok(success(responses[5]).timeline.length > 0);
  assert.match(responses[6].error.message, /must be on/);
  assert.equal(fetches.length, 4);
  assert.ok(fetches[0].includes('nameOfMeeting='));
});
