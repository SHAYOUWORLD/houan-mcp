# ADR 0007 — npm への公開を trusted publishing(OIDC)に移す

- Status: Accepted
- Date: 2026-10-29
- Related: ADR 0003

## Context

v0.1.4 のタグで動いた公開ワークフロー(2026-10-29)は、provenance の署名までは成功したが、`npm publish` の書き込みが `E404 Not Found` で失敗した。npm は認証できない公開にこのエラーを返す。2026-04-25 にリポジトリへ登録した `NPM_TOKEN`(Granular Access Token)が失効または無効になっていたと見られる。npm の最新版は 0.1.3 のまま残った。

npm の公式資料(2026-10-29 参照)では、classic token は 2025-11 に廃止され、granular token による直接公開も 2027-01 に廃止予定とされている。代わりに、GitHub Actions の OIDC で認証する trusted publishing が案内されている。条件は npm CLI 11.5.1 以上、Node 22.14.0 以上、GitHub ホストのランナー、`id-token: write` で、公開リポジトリなら provenance が自動で付く。

## Decision

- `publish.yml` は npm の公開に token を使わず、npmjs.com に登録した trusted publisher(GitHub Actions、`SHAYOUWORLD/houan-mcp`、`publish.yml`)で認証する。`NODE_AUTH_TOKEN` は渡さない。
- Node は 24 にし、npm が 11.5.1 未満なら公開前に止める。
- タグと `package.json`・`server.json` の版の照合と `npm test` を、npm への公開より前に済ませる。`server.json` の版違いで npm だけ公開される状態を避ける。
- `package.json` の `bin` は `bin/houan-mcp.mjs`(先頭の `./` なし)と書く。npm 11.19.1 の `npm publish --dry-run` は `./bin/houan-mcp.mjs` を不正として削除すると警告した。0.1.2・0.1.3 の公開物も `bin/houan-mcp.mjs` に正規化されている。
- MCP Registry への登録は従来どおり `mcp-publisher login github-oidc` を使う。

## Consequences

### 良い点

- 長期間有効な公開用 token をリポジトリに置かずに済む。期限切れで公開が止まることもない。
- provenance が自動で付く。

### 悪い点

- npmjs.com 側の trusted publisher 登録が前提になる。登録内容は保存時に検証されないので、誤りは公開時に初めて分かる(ワークフロー名・リポジトリ名は大文字小文字まで一致させる)。
- 公開は GitHub Actions が有効なときだけ動く。

### 移行後に本人が行うこと

1. trusted publisher で公開できたことを確認する。
2. パッケージ設定の Publishing access を「Require two-factor authentication and disallow tokens」にする。
3. 不要になった `NPM_TOKEN` を npm 側で取り消し、リポジトリの secret から削除する。

## References

- npm Trusted publishing: <https://docs.npmjs.com/trusted-publishers>
- npm access tokens: <https://docs.npmjs.com/about-access-tokens>
