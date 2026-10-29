# ADR 0006 — search_bills の既定回次を回次一覧から決める

- Status: Accepted
- Date: 2026-10-29
- Related: ADR 0002, ADR 0005

## 確認した問題

v0.1.3 の既定回次は定数 221 で、第222回国会（臨時会、2026-10-05〜）の開会後も 221 を検索していた。ADR 0005 は定数を 222 に更新したが、国会は年に複数回召集されるため、次の召集からリリースまで、回次を指定しない検索は前の国会の一覧を返し続ける。ツール説明は「current-session」をうたっており、利用者は古い回次であることに気づきにくい。

あわせて、出典として示す参議院議案情報の入口 `.../kousei/gian/index.htm` は HTTP 404 だった。参議院の各回次ページのパンくずは `.../kousei/gian/current/gian.htm`（最新回次の一覧へ移る小さなページ）を「議案情報」として指している。

## 比較した方式

| 方式 | 追加の通信 | 新しい国会への追従 | 失敗時 |
| --- | --- | --- | --- |
| 定数をリリースごとに更新（ADR 0005） | なし | リリースまで古い回次 | — |
| 衆議院の回次一覧 `gian/pulldown.htm` の最大値 | 約5KBを1回（5分キャッシュ） | 一覧に載った時点 | 定数へ戻して警告 |
| 衆議院 `gian/menu.htm`（最新回次の一覧そのもの）の見出しから回次を読む | 衆議院・両院検索ではなし | 同上 | 見出しの解析に依存、参議院のみの検索は別経路が必要 |
| 参議院 `gian/current/gian.htm` の移動先から読む | 約0.5KBを1回 | 同上 | JavaScript の移動先文字列の解析に依存 |

`pulldown.htm` は衆議院の議案メニューが回次選択に読み込む一覧で、`<OPTION value="kaiji{n}.htm">` が並ぶだけの単純な形をしている（2026-10-29 時点で第142〜222回）。

## 決定

- `session` が指定されないときは `pulldown.htm` を読み、`kaiji{n}.htm` の最大の n を両院の検索回次にする。並び順には依存しない。
- 一覧を取得・解析できないときは定数 222 を検索し、`warnings` に理由と URL を入れる。検索自体が失敗したときも、エラー結果に同じ `warnings` を含める。
- どの経路で回次を決めたかを `query.sessionSource`（`latest` / `fallback` / `argument`）で返す。
- `session` を指定した検索では一覧を取得しない。
- 参議院の出典 URL を `current/gian.htm` にする（ツール結果の `source.sangiin`、README、ADR 0002）。

## 結果

- 回次未指定の検索は衆議院への取得が1回増える。キャッシュ（5分）の間は増えない。参議院のみの検索でも衆議院の一覧を読む。
- 召集日に衆議院の一覧へ新しい回次が載り、参議院の同じ回次のページがまだない場合、両院検索は ADR 0005 のとおり全体が失敗する。院を指定するか、回次を指定して再検索できる。
- 一覧の形式が変わっても、検索は 222 で続き、`warnings` で気づける。定数の更新は代替値の鮮度を保つためだけに行う。

## 一次資料（2026-10-29 確認）

- https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/pulldown.htm
- https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm
- https://www.sangiin.go.jp/japanese/joho1/kousei/gian/current/gian.htm
- https://www.sangiin.go.jp/japanese/joho1/kousei/gian/222/gian.htm
