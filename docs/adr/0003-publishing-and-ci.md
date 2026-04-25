# ADR 0003 — 公開・CI 方針

- Status: Pending(2026-04-25 時点で npm 公開待ち)
- Date: 2026-04-25
- Related: ADR 0001

## Context

`@codeagentjp/houan-mcp` を npm に公開するルートを決める。先行する `@codeagentjp/egov-law-mcp` は **GitHub Actions のタグ駆動公開**を採用しており、同じ方針で揃えるかどうかを決定する必要がある。

実装 + GitHub repo 公開は完了。npm publish のみ未実行。

## Decision

公開ルートは **GitHub Actions タグ駆動 (workflow `.github/workflows/publish.yml`)** を採用し、egov-law-mcp と揃える。具体的には:

- v* タグ push でワークフローが起動
- workflow が `package.json` の version とタグの一致を検証
- `npm publish --access public --provenance` を OIDC 認証で実行
- リポジトリ secret `NPM_TOKEN` (Granular Access Token、`@codeagentjp` スコープ書込権限、bypass 2FA) を使う

CLI からの直接 publish も可能だが、再現性とログの観点で CI ルートを正とする。一度きりの初回公開のみ CLI publish を許容する余地を残す。

## Consequences

### 良い点

- リリース履歴がタグ + GitHub Actions ログとして可視化される
- npm provenance(GitHub OIDC で署名)が付き、サプライチェーンセキュリティに強い
- バージョン番号のタグずれを CI で fail させ、ヒューマンエラーを防ぐ

### 悪い点

- 各リポジトリで NPM_TOKEN secret を個別にセットアップする必要がある(`gh secret set NPM_TOKEN -R SHAYOUWORLD/houan-mcp`)
- 初回公開のために secret セットアップ → タグ push の 2 ステップが必要

### 現在の状態(2026-04-25)

- ✅ Workflow `.github/workflows/publish.yml` 配置済み
- ⏸️ NPM_TOKEN secret 未設定 (egov-law-mcp と同じ Granular Access Token を再利用可能)
- ⏸️ v0.1.0 タグ未付与
- ⏸️ npm publish 未実行

## Resume Steps

セッション再開時の手順:

1. ユーザー側で `gh secret set NPM_TOKEN -R SHAYOUWORLD/houan-mcp` (egov-law-mcp と同じトークン値を貼り付け)
2. 確認: `gh secret list -R SHAYOUWORLD/houan-mcp` で `NPM_TOKEN` が出ること
3. ローカルで:
   ```
   git -C <local-clone> tag -a v0.1.0 -m "v0.1.0: initial public release"
   git -C <local-clone> push origin v0.1.0
   ```
4. 進行監視: https://github.com/SHAYOUWORLD/houan-mcp/actions
5. 公開確認: https://www.npmjs.com/package/@codeagentjp/houan-mcp
6. GitHub Release を `gh release create v0.1.0 ...` で作成

## Alternatives Considered

### CLI 直接 publish

最短だが、ワークフローと secret 整備をスキップすることになり、後から追加するのが面倒。却下。

### Trusted Publishers (npm の OIDC 連携)

provenance より進んだ「トークンレス公開」も npm が対応中。今後検討するが、現時点では Granular Token 方式で十分。

## References

- npm 公開と provenance: <https://docs.npmjs.com/generating-provenance-statements>
- GitHub Actions OIDC for npm: <https://github.blog/2023-04-19-introducing-npm-package-provenance/>
- egov-law-mcp の publish workflow(同型): <https://github.com/SHAYOUWORLD/egov-law-mcp/blob/main/.github/workflows/publish.yml>
