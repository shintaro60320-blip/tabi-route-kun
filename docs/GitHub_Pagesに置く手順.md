# 旅ルートくんを GitHub Pages に置く手順

**2026-11-04 に置いた**：https://github.com/shintaro60320-blip/tabi-route-kun → **https://shintaro60320-blip.github.io/tabi-route-kun/**（公開・秘密なし）。
以下は「もう一度置く」「更新する」時の手順。

アプリは `app/` の中身をそのまま置けば動きます（ビルド不要・秘密情報なし）。

## 1. 公開リポジトリを作る
1. GitHub にログイン → 右上「+」→「New repository」。
2. Repository name：`tabi-route-kun`、Public、「Add a README file」は**チェックしない**。「Create repository」。

## 2. ファイルを入れる（2 つのうちどちらか）

### A. ブラウザから（Git を使わない）
1. 作ったリポジトリのページで「uploading an existing file」を押す。
2. `C:\CashKeeper\AppKeeper\projects\旅ルートくん\app\` の中身を**フォルダごと**ドラッグ（`index.html`・`css`・`js`・`icons`・`manifest.webmanifest`・`sw.js`・`docs`。`tests` と `tools` と `package.json` は入れなくてよい）。
3. 「Commit changes」。

### B. Git から（慣れていれば）
```
cd C:\CashKeeper\AppKeeper\projects\旅ルートくん\app
git init
git add index.html css js icons manifest.webmanifest sw.js docs
git commit -m "旅ルートくん 1.0.0"
git branch -M main
git remote add origin https://github.com/<アカウント>/tabi-route-kun.git
git push -u origin main
```

## 3. Pages を有効にする
1. リポジトリの「Settings」→ 左の「Pages」。
2. 「Build and deployment」の Source を「Deploy from a branch」、Branch を `main` / `/ (root)` にして「Save」。
3. 1〜2 分待つと上に URL が出る：`https://<アカウント>.github.io/tabi-route-kun/`。

## 4. 確かめる
- その URL を PC の Chrome で開く → 「どこへ行きますか？」が出れば OK。
- 歯車 → キーを貼って「キーを確かめる」→「使えます」。

## 5. 更新のしかた
- `app/` のファイルを直して、同じ手順で上げ直す（A ならファイルをもう一度アップロード、B なら `git push`）。
- 版を上げる時は `js/app.js` の `APP_VERSION` と `sw.js` の `CACHE_NAME` を同じ番号に揃える（例 `1.0.1` / `trk-v1.0.1`）。スマホ側は次に開いた時に新しい殻を取り、その次の起動で切り替わる。

## 注意
- リポジトリは公開でよい（キーはアプリの中に無い。使う人のスマホの中にだけある）。
- 開発用に使った捨てキーは、本人に渡したら Google AI Studio で削除する。
