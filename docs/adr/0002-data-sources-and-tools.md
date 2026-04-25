# ADR 0002 — houan-mcp のデータソースとツール選定

- Status: Accepted
- Date: 2026-04-25
- Related: ADR 0001, ADR 0003

## Context

`houan-mcp` は「国会で何が議論され、何が法案として動いているか」を AI エージェントから引けるツール。実装にあたり、データソースとツール構成を決める必要がある。

## Decision

### データソース 3 種類

1. **NDL Kokkai API** (https://kokkai.ndl.go.jp/api.html)
    - 認証不要、JSON/XML 出力、3エンドポイント (`/api/speech`, `/api/meeting_list`, `/api/meeting`)
    - 議事録は会議開催から 1〜2 週間遅れで索引される
    - レート制限: 一括アクセス・並列リクエストを避けるよう案内あり
2. **衆議院議案情報** (https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/)
    - 公開API なし、HTMLテーブル
    - URL パターン: `{base}/{session}/{session}gian.htm`、詳細は `./keika/{HEX_ID}.htm`
3. **参議院議案情報** (https://www.sangiin.go.jp/japanese/joho1/kousei/gian/)
    - 公開API なし、HTMLテーブル + PDF
    - URL パターン: `{base}/{session}/gian.htm`、詳細は `./meisai/m{session}{type}{session}{number}.htm`

### MCP ツール 4 つ

| Tool | 入力 | 出力 | データソース |
| --- | --- | --- | --- |
| `find_diet_qa` | キーワード、日付範囲、議院、委員会、発言者、limit | 該当発言一覧 + メタ + URL | NDL `/api/speech` |
| `get_meeting_record` | issueID | 委員会全体の発言録 | NDL `/api/meeting` |
| `search_bills` | キーワード、議院(both/shugiin/sangiin)、会期 | 該当法案一覧 | 衆/参議案情報 HTML |
| `get_bill` | 議院、proceedingURL | 法案詳細(提出者・付託・経過) | 各議院の経過/詳細 HTML |

### 設計原則(egov-law-mcp と同じ)

- サーバー側で LLM を呼ばない
- 戻り値に必ず `source` (一次URL含む) と `retrievedAt` を含める
- 単一 .mjs、ビルド工程なし、native fetch、依存ゼロ
- `process.stdout` は JSON-RPC 専用、ログは `process.stderr` 限定
- HTTP origin chain を fetch wrapper でロックダウン
- 戻り値全体に「note」フィールドで「議事録は1〜2週間遅れ」を明示

## Consequences

### 良い点

- NDL Kokkai API が無認証 JSON で動作するため、Mythos 質疑(2026-04-10 衆議院外務委員会)の答弁が `find_diet_qa` 一発で取得できることを実装時点で確認済み
- Q&A は API、議案リストは HTML、と用途で API/HTMLを使い分けることで NDL に過度な依存を回避

### 悪い点

- 衆/参の HTML レイアウト変更で `search_bills`/`get_bill` のセレクタが破綻する可能性
- 議事録の 1〜2 週間遅れにより、直近の質疑には対応できない(「houan-mcp で 4/21 質疑の答弁を引く」というユースケースは議事録掲載まで使えない)

### リスク緩和

- HTML 解析は regex ベースだが、`parseWarnings` を戻り値に含めて壊れた箇所を可視化
- README に「直近質疑は議事録未掲載の可能性」を明示
- 戻り値の `note` フィールドで API 利用者に同等の警告を出す

## Alternatives Considered

### NDL API 1 本に絞る

議案情報も NDL でカバーしようとしたが、NDL は議事録が中心で、議案メタデータ(付託先・経過)は衆参サイトにしか網羅されていない。よって却下。

### 法案検索を諦めて Q&A だけにする

`houan-mcp` を「Diet Q&A 検索 MCP」と狭めて NDL のみ使う案。スコープが小さいが、ユーザーが目下知りたいのは「火曜日提出の法案」など議案の動きで、Q&A だけだと不足。却下。

### スクレイピング用ライブラリ(cheerio 等)を使う

可読性は上がるが、依存ゼロ方針(egov-law-mcp と一貫)を崩す。HTML 構造が単純(table+a)で regex で十分なため不採用。

## References

- ADR 0001: MCP シリーズの分割戦略
- NDL Kokkai API ドキュメント: <https://kokkai.ndl.go.jp/api.html>
- 衆議院議案情報: <https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm>
- 参議院議案情報: <https://www.sangiin.go.jp/japanese/joho1/kousei/gian/index.htm>
