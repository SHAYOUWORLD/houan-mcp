# Official HTML regression samples

Captured 2026-10-28 (JST):

- `shugiin-221.html`: https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/kaiji221.htm
- `shugiin-222.html`: https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/kaiji222.htm
- `shugiin-proceedings.html`: https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/keika/1DE2D72.htm
- `sangiin-222.html`: https://www.sangiin.go.jp/japanese/joho1/kousei/gian/222/gian.htm
- `sangiin-proceedings.html`: https://www.sangiin.go.jp/japanese/joho1/kousei/gian/222/meisai/m222080222001.htm

Navigation, scripts and most list rows were removed. Retained table headers and rows preserve the original markup and values; line endings and trailing whitespace are normalized; Shugiin samples were decoded from Shift_JIS to UTF-8. The treaty header intentionally has no surrounding `<tr>`, matching the official source. Samples cover carryover bills, withdrawal, unpublished full text, numbered and unnumbered items, and both chambers' proceedings. Tests mutate copies for empty/malformed/reordered layouts and link variants. `bill-fetch.mjs` preloads these samples into the real stdio server; it rejects unexpected URLs and never uses the network. NDL responses in that mock are synthetic protocol fixtures.

Sources: 衆議院議案情報 / 参議院議案情報. The samples are frozen regression inputs, not current legislative status.
