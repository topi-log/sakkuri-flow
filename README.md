# さっくりふろー

## 技術構成

- フロントエンド：HTML / CSS / JavaScript（フレームワークなし）
- 図の描画：SVG。図形・接続線・部署レーンをブラウザ内で描画
- 状態管理：JavaScriptのメモリ上。DB、サーバー保存、自動保存はなし
- 保存と復元：JSONエクスポート／インポート
- 閲覧用出力：SVG / PNG / JPG / HTML
- 配信：Cloudflare Workers Static Assets（サーバー処理なし）
- 開発用：Node.js 24 LTS / npm / Wrangler 4.158.0（lockfileで固定）

MVPの機能と画面を維持して配信用の構成を追加しています。ReactやTypeScriptへの移行は含みません。
Wranglerは配信・ローカル開発用です。閲覧者のブラウザでNode.jsは動きません。

## ファイル

```text
public/            編集対象のHTML・CSS・JavaScript
  index.html
  style.css
  app.js           データ・描画・プロパティ・接続・入出力
  usability.js     図形上の編集・配置行・全体設定など
scripts/           構文／参照確認と静的ファイルのビルド
wrangler.jsonc     Cloudflare配信設定
package-lock.json  開発依存関係の固定
 dist/             npm run build が生成する配信用ファイル
```

`app.js`の後に`usability.js`を読み込む構成です。ファイル単位の分割は既存のままです。
`dist/`を直接編集せず、`public/`を編集してください。
既存Sitesの認証情報、Git履歴、ホスティング設定はこの配布物に含みません。

## ローカル起動

このフォルダで次を実行します。

```sh
npm ci
npm run dev
```

ターミナルに表示されたlocalhostのURLをブラウザで開きます。Ctrl+Cで終了します。
`npm run dev`は起動時にビルドします。編集後はコマンドを再起動してください。

## チェックと配信準備

```sh
npm run check
npm test
npm run build
npm run deploy:check
```

`deploy:check`はWranglerのdry runです。公開はしません。
構文・静的ファイル参照・接続線や上限などの回帰テスト・Wranglerの配信構成を確認します。全操作の自動テストではありません。

## Cloudflareへデプロイ

Cloudflareアカウントを用意して、次の手順を実施します。

1. `wrangler.jsonc`の`name`を、配信先Workerの識別名に変更します。
   現在のWorker識別名は`sakkuri-flow`です。サービスの表示名や独自ドメインとは別の設定です。
   既存Workerと同名にすると更新になるため、初回は未使用の名前を使ってください。
2. Cloudflareへログインします。
3. 対象アカウントを確認してから公開します。

```sh
npx wrangler login
npx wrangler whoami
npm run deploy
```

複数アカウントがある場合は、対象の`account_id`を`wrangler.jsonc`へ設定してから実行します。
公開が成功すると配信URLが表示されます。独自ドメインはWorkerのDomains & Routesで別途設定できます。
アカウント情報・APIトークンはソースや公開ファイルに記載しません。

## mainへのpushで自動デプロイ

Cloudflare Workers BuildsのGit連携を使用します。GitHub ActionsのワークフローやGitHub Secretsの登録は不要です。

CloudflareダッシュボードのWorkers & PagesからGitリポジトリを接続してWorkerを作成します。既存WorkerならSettings → Buildsでリポジトリを接続します。
GitHub連携時に`topi-log/sakkuri-flow`へのアクセスを許可し、次の値を設定してください。

| 設定 | 値 |
| --- | --- |
| リポジトリ | `topi-log/sakkuri-flow` |
| Worker名 | `sakkuri-flow`（wrangler.jsoncのnameと一致） |
| 本番ブランチ | `main` |
| ルートディレクトリ | リポジトリ直下（サブディレクトリ指定なし） |
| ビルドコマンド | `npm run build` |
| デプロイコマンド | `npx wrangler deploy` |
| ビルド環境変数 | `NODE_VERSION=24` |

依存関係はpackage-lock.jsonを含めて管理しています。ビルドコマンド内で構文・静的ファイル参照をチェックします。
mainだけを公開する運用では、非本番ブランチのプレビュービルドは無効にしてください。
接続後、初回のビルド・公開が成功したことをCloudflareのBuilds画面で確認します。以降はmainへのpushで自動ビルド・デプロイされます。

このリポジトリへの設定ファイル追加だけではGit連携は有効になりません。Cloudflare側で一度、上記の接続設定が必要です。

公式資料：
- https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/

## MVPの保存・通信の範囲

図の内容をアップロードするAPIは実装していません。ブラウザの再読み込みで編集中の状態は失われるため、JSONで保存してください。
既存と同じくCSSがGoogle Fontsを読み込みます。図データの送信ではありませんが、フォント取得の外部通信は発生します。
Cloudflareへのアクセスに伴う配信側のログ等と、図データの保存機能は別です。

## 公開後に確認する操作

- 初期状態が3部署・図形なしで開く
- 図形の追加・名前入力・移動、接続・接続先変更
- 部署の並べ替え、部署内行数と行名の変更
- JSONのエクスポートと再インポートで内容が復元される
- PNG・JPG・SVG・HTMLの出力を開ける
- 横スクロール時の部署欄固定、拡大縮小

## 公式資料

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/static-assets/get-started/
- https://developers.cloudflare.com/workers/static-assets/binding/

## データ上限

部署・システムは100件、図形は2,000件、接続線は4,000件までです。追加操作では上限を超える追加を拒否し、図形と線を同時に作る場合は両方追加できる場合だけ作成します。
JSONファイルの入出力は5MBまでです。サイズ超過時はメッセージを表示して保存を中止します。
手動調整した接続線は接続点の位置が変わった場合に自動経路へ戻し、直角を維持します。
