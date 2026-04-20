# Markserv Master / Multi-Root 実装案

## 背景

現状の `markserv` は「1プロセス = 1ルートディレクトリ = 1ポート」の前提で動いている。

- `markserv <dir>` で単一 root を起動する
- ルートページ `/` はその root のディレクトリ listing
- sidebar / recent / edit / notebook もその単一 root を前提にしている
- HTTP port は未明示時に順次 fallback する

この運用だと、複数プロジェクトを見たいときに `markserv` を複数プロセス起動し、`8642`, `8643`, `8644` のようにポートを分ける必要がある。

今回やりたいことは逆で、

- `markserv master` を主導線にする
- 外向け公開は master の `8642` だけにする
- 個別に立ち上げていた root directory は master 配下に「登録」する
- master の `/` に登録済み root の一覧を出す
- 各 root は master 配下の URL で閲覧する
- `tailscale serve` は master に対して 1 回だけ設定すればよい
- port の自動 fallback はやめる

## 目標

- 単一の master server で複数 root を配信できる
- master の root page で登録済み root を選べる
- 各 root の既存 UI は極力維持する
- `localhost:8642` だけを公開対象にできる
- port fallback を廃止し、指定 port を固定で使う
- root registry の変更を master が hot-reload で反映できる

## 非目標

- 1 つのページに全 root の nav tree を統合表示すること
- root 間で Markdown リンクを自動解決すること
- LAN 向けの `0.0.0.0` 公開を前提にすること
- 初回からフル機能の動的管理 API を作り込むこと

## 推奨運用像

```sh
markserv master -a localhost -p 8642
tailscale serve localhost:8642
```

root の追加は別コマンドで registry に登録する。

```sh
markserv root add ~/workspace/tenchijin/compass_backend --slug compass-backend --title "Compass Backend"
markserv root add ~/workspace/tenchijin/compass_frontend --slug compass-frontend --title "Compass Frontend"
```

master の `/` は次のような一覧ページになる。

- Compass Backend
- Compass Frontend
- title
- slug
- path
- open link

## 現状コードの制約

現在の実装は単一 root 前提がかなり強い。

- `lib/cli.js` は `flags.dir` を 1 つだけ作る
- `createRequestHandler()` は 1 つの `dir` を閉じ込める
- `buildSidebarFileLink()` は `href="/..."` を返す
- `toEditableRequestPath()` も root 直下の `/file.md` を返す
- notebook route は `"/__markserv/ipynb-render?..."`
- edit route は `"/__markserv/edit"`
- `createBreadcrumbs()` も単一 root を前提に breadcrumb を組む

そのため multi-root 化の本体は「server を 1 つ増やす」ことではなく、
「request ごとに root context を解決し、すべてのリンク生成を routeBase 対応にする」こと。

## 提案アーキテクチャ

### 1. Master と RootRegistry を導入する

master server は単一の HTTP server を持ち、複数 root を registry から読む。

```json
{
  "version": 1,
  "roots": [
    {
      "slug": "compass-backend",
      "title": "Compass Backend",
      "dir": "/Users/koheikawasaki/workspace/tenchijin/compass_backend",
      "flags": {
        "markdownOnlyDir": true,
        "showAllDir": false
      }
    }
  ]
}
```

registry の保存先は既定で次を想定する。

```text
~/.config/markserv/roots.json
```

### 2. URL 設計

衝突回避のため、各 root は固定 prefix 配下に mount する。

- `/` : master index
- `/roots/:slug/` : root の directory index
- `/roots/:slug/<path>` : Markdown / HTML / directory
- `/roots/:slug/__markserv/edit` : edit API
- `/roots/:slug/__markserv/ipynb-render?...` : notebook render API

`/{markserv}...` の shared asset は現状のまま global でよい。

### 3. RootContext を request ごとに解決する

各 request はまず次のどちらかに分類する。

- master-level route
- root-scoped route

root-scoped route の場合は `slug` から root を引いて `RootContext` を作る。

```js
{
  slug,
  title,
  dir,
  routeBase: `/roots/${slug}`,
  flags,
  markdownDirectoryIndex
}
```

これを既存の rendering helpers に渡す。

## ルートページの責務

master の `/` は従来の「単一 root の directory listing」ではなく、登録済み root 一覧ページに変える。

表示項目は最低限でよい。

- title
- slug
- absolute path
- open link

このページは directory tree を持たなくてよい。root を選ぶ hub として割り切る。

## CLI / コマンド設計案

### 推奨コマンド体系

```sh
markserv master
markserv root add <dir> [--slug ...] [--title ...]
markserv root remove <slug>
markserv root list
markserv root open <slug>
```

### 主導線の方針

`markserv master` を主導線とする。CLI 設計も master 前提で寄せる。

互換性のために既存の `markserv <dir>` は当面残してよいが、README と help の主導線にはしない。

登録対象はディレクトリのみとし、単一 Markdown ファイル登録はサポートしない。

## オプション整理

### 変えないもの

- `--address`
- `--browser`
- `--silent`
- `--verbose`
- `--poll`
- `--autoreload`
- `--show-all-dir`
- `--markdown-only-dir`

ただし `--show-all-dir` と `--markdown-only-dir` は master では「server 全体の既定値」として扱い、
将来的に root ごとの override を registry 側で許可する。

### 意味を変えるもの

- `--port`
  - 単一 root 時と master 時の両方で「固定 port」とする
  - 未明示なら既定 `8642`
  - 空いていなければ失敗

- `--livereloadport`
  - 自動 fallback をやめる
  - 指定 port が使えなければ失敗
  - `false` か `manual` の利用を推奨

- positional `<file/dir>`
  - 互換モードではそのまま使える
  - master モードでは使わず、registry ベースに寄せる

### 追加するもの

- `markserv master`
- `markserv root add`
- `markserv root remove`
- `markserv root list`
- `--registry <path>`

### 廃止または非推奨にするもの

- HTTP port の自動 fallback
- LiveReload port の自動 fallback
- `--force-replace`

## port fallback 廃止案

master 運用では「常に同じ URL / 同じ tailscale serve 設定」であることが重要なので、
port が変わる挙動は相性が悪い。

そのため次の仕様にする。

- 指定 port が使われていたら即エラー
- fallback はしない

期待するエラーメッセージ:

- HTTP: `Port 8642 is already in use.`
- LiveReload: `LiveReload port 35729 is already in use.`
- Address: `Address not available: ...`

## 実装の中心変更

### 1. server.js の責務分離

現状の `createRequestHandler(flags, runtimeState)` は単一 root を前提にしている。

これを次の 2 層に分ける。

- master router
- root renderer

イメージ:

```js
createMasterHandler(masterState) -> (req, res) => {
  if (req.url === "/") renderMasterIndex(...)
  else {
    const rootContext = resolveRootFromRequest(...)
    renderRootRequest(rootContext, req, res)
  }
}
```

### 2. routeBase-aware helper への変更

以下の helper は root mount prefix を考慮する必要がある。

- `toEditableRequestPath()`
- `buildNotebookRenderHref()`
- `buildSidebarFileLink()`
- `createBreadcrumbs()`
- directory listing の `href`
- recent list の `href`
- nav tree の `href`

今は `/file.md` のような絶対パスを返しているが、master では `/roots/<slug>/file.md` を返す必要がある。

### 3. edit / notebook route の root-scope 化

今の `"/__markserv/edit"` と `"/__markserv/ipynb-render"` は単一 root 前提なので、
master では root prefix の下へ移す。

- `/roots/:slug/__markserv/edit`
- `/roots/:slug/__markserv/ipynb-render`

これで payload に余計な root 指定を持たせずに済む。

### 4. Template 追加

新規 template を追加する。

- `lib/templates/master.html`

用途:

- master index の root 一覧表示
- root の追加先・概念説明
- optional で local note を表示

既存の `markdown.html` と `directory.html` は root-scoped page として継続利用する。

## Registry 管理方式

### MVP

まずは file-backed registry を採用する。

- `markserv root add` が JSON を更新
- `markserv root remove` が JSON を更新
- `markserv master` 起動時に読み込む
- registry ファイル変更を watch して master が hot-reload する

これだけで:

- tailscale serve は 1 回で済む
- master の固定 URL を維持できる
- 実装複雑度を抑えられる

### 将来拡張

第 2 段階で local admin API を足す。

- `POST /__markserv/admin/roots`
- `DELETE /__markserv/admin/roots/:slug`
- `POST /__markserv/admin/reload`

ただしこれは loopback only かつ local token 前提にすべき。

## 実装ステップ

### Phase 1: 設計と型の導入

- registry loader / validator を追加
- registry watcher / hot-reload の枠を追加
- `RootContext` の生成処理を追加
- `master.html` を追加

### Phase 2: ルーティング分離

- `/` を master index に変更
- `/roots/:slug/...` の解決を追加
- 単一 root 用 rendering を `renderRootRequest()` へ抽出

### Phase 3: link 生成修正

- nav tree
- recent list
- directory listing
- breadcrumb
- edit
- notebook

ここが実装の本丸。

### Phase 4: CLI 拡張

- `markserv master`
- `markserv root add/remove/list`
- `--registry`

### Phase 5: port fallback 廃止

- `startHTTPServer()` を固定 port bind に変更
- `resolveLiveReloadPort()` も固定 port に変更
- README / help を更新

## テスト追加案

- master index に登録済み roots が表示される
- `/roots/:slug/` で directory page が開く
- `/roots/:slug/doc.md` で markdown page が開く
- sidebar / recent / breadcrumb のリンクに root prefix が付く
- edit API が root prefix 配下で動く
- notebook route が root prefix 配下で動く
- unknown slug が 404 になる
- registry add/remove/list が正しく動く
- registry 更新が master に hot-reload 反映される
- 指定 port 使用中で fallback せず fail する

## README 反映案

README の主メッセージは次へ寄せる。

- master mode を主導線にする
- 単一 root server としても当面は使える
- tailscale 運用では `localhost` bind + `tailscale serve localhost:8642`
- port fallback はしない

## 推奨する最初の着手順

最小の破壊で進めるなら次の順序がよい。

1. `master.html` と registry loader / watcher を入れる
2. `/` を master index にする
3. `/roots/:slug/...` で既存 rendering を動かす
4. すべての `href` 生成を routeBase-aware に直す
5. CLI の `root add/remove/list` を足す
6. registry hot-reload を通す
7. 最後に port fallback と `--force-replace` を外す

## 結論

今回の変更は「ポート管理」より「root の名前空間管理」が本質。

実装方針は、

- 1 master process
- registry で複数 root を管理
- `/` は root 一覧ページ
- `/roots/:slug/...` に既存 UI を載せる
- port fallback は廃止
- `--force-replace` も廃止
- `localhost + tailscale serve` を前提にする

が最も筋が良い。

MVP は file-backed registry + master hot-reload で十分実用になる。
