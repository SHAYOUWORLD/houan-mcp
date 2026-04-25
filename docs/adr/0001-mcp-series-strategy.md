# ADR 0001 — codeagent.jp MCP シリーズの分割戦略

- Status: Accepted
- Date: 2026-04-25
- Deciders: codeagent.jp
- Related: ADR 0002, ADR 0003

## Context

codeagent.jp は AI エージェントが日本の行政・法務・立法情報を**出典付きで引ける**ための小さな MCP サーバー群を、別パッケージとして個別に公開していく方針を採用した。最初の2本は次のとおり。

| パッケージ | 範囲 | 一次データソース |
| --- | --- | --- |
| `@codeagentjp/egov-law-mcp` | 現行法令(法律・政令・省令) | e-Gov 法令検索 |
| `@codeagentjp/houan-mcp` | 国会提出議案 + 委員会議事録 | NDL 国会会議録検索システム / 衆参議案情報 |

ロードマップに `law-diff-mcp`、`local-ordinances-mcp`、`precedent-mcp` を追加予定([egov-law-mcp issues#1](https://github.com/SHAYOUWORLD/egov-law-mcp/issues/1))。

## Decision

**1パッケージ1責務**として、データソース別・利用文脈別に MCP を分ける。1つの大きな MCP に統合しない。

具体的には:

- **法令(=現行ルール)** と **議案/議事録(=立法プロセス)** は別パッケージ
- **国法 / 自治体条例 / 判例 / 法案改正 diff** も将来別パッケージ
- 共通レイヤー(認証、出典整形、タイムアウト)は各パッケージで個別に実装(共通ライブラリは作らない)

## Consequences

### 良い点

- 利用者がスコープを選んで最小限だけ入れられる(`npx -y @codeagentjp/houan-mcp` 単独で動く)
- データソースの仕様変更が起きてもパッケージ単位で更新でき、ブレが他に波及しない
- リポジトリ単位でコミット履歴・Issue・Star が独立し、利用ニーズの可視化に役立つ
- 失敗しても他に波及しない(法案 MCP のスクレイパが壊れても法令 MCP は無事)

### 悪い点

- リポジトリ管理 / publish workflow / NPM_TOKEN 設定が N 倍に増える
- 利用者から見ると複数パッケージを設定ファイルに並べる必要がある

### 受け入れる理由

利用者側コストはコピペ1ブロックで済む。一方、サーバー側コストはパッケージ統合で発生する依存膨張・テスト範囲拡大の方が長期的に重い。

## Alternatives Considered

### 単一巨大 MCP `@codeagentjp/jp-policy-mcp`

すべての日本行政データソースを 1 つの MCP に押し込む案。利用者は1つのコマンドで全機能。却下:

- データソースのライセンス・利用条件が源ごとに異なる(e-Gov、NDL、裁判所、自治体)。一括ライセンス表記が複雑化する
- 1つの MCP に何十ものツールが並ぶと、LLM 側のツール選択が悪化する(MCP ベストプラクティスとして「ツール数は絞る」)

### モノレポ + 共通ライブラリ

`packages/*` 構造で共通コードを抽出する案。却下:

- 現状の各 MCP は依存ゼロの単一 .mjs(数百行)で完結している。共通化の利得が小さい
- モノレポはリリース管理(changesets 等)を要し、運用コストが上がる
- いずれの MCP も外部 API への薄いラッパーで、コード重複は限定的

## References

- ADR 0002: houan-mcp のデータソースとツール選定
- ADR 0003: 公開・CI 方針
- egov-law-mcp ロードマップ: <https://github.com/SHAYOUWORLD/egov-law-mcp/issues/1>
