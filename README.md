# AlSlime

ローカルで動作する AI CLI フロントエンド / キャラクター創作・会話支援ツール

英語版は [README.en.md](README.en.md) を参照してください。

<!-- TODO: スクリーンショットを追加
![AlSlime スクリーンショット](docs/images/screenshot-main.png)
-->

## 概要

AlSlime は、ご自身で導入した AI CLI（Gemini CLI / Claude Code / Antigravity）をブラウザ UI から使うための、手元の PC だけで完結するローカルアプリです。

- **ローカル完結** — サーバーは手元の PC 上で動作し、会話内容・生成物・キャラクター設定が開発者へ送信されることはありません
- **キャラクター創作・会話支援** — キャラクター設定の管理、ロールプレイ向けの会話フロー、プロンプト・パラメータのプリセット管理
- **複数 AI CLI 対応** — Gemini CLI / Claude Code / Antigravity を切り替えて利用（各 CLI の導入・契約はご自身で行ってください）
- **ComfyUI 連携** — 会話からの画像生成（ComfyUI はご自身で導入してください）
- **設定のインポート / エクスポート** — 設定パックとして持ち運び可能
- **日本語 / 英語 UI**

## 動作環境

- Windows / Linux
- 利用したい AI CLI（Gemini CLI / Claude Code / Antigravity のいずれか）が導入・認証済みであること
  - 各 AI CLI の利用には、各提供元での有料プラン等の契約が別途必要な場合があります。必要なプランは各提供元の最新の案内をご確認ください
- ソースからビルドする場合: Go 1.26+（UI を変更する場合はさらに Node.js）

## クイックスタート

### ソースからビルドする

ビルド済みフロントエンドが同梱されているため、Go だけでビルドできます。

```sh
go build -tags purepublic -o alslime ./cmd/app
```

起動するとローカルサーバーが立ち上がるので、ブラウザで開きます。

```sh
./alslime
# → http://127.0.0.1:3000 をブラウザで開く
```

初回起動時に利用規約への同意画面が表示されます。同意後、設定画面から利用する AI CLI の実行ファイルを設定してください。

### UI を変更してビルドする場合

```sh
cd frontend
npm ci
npm run build -- --outDir "../internal/frontend/dist"
cd ..
go build -tags purepublic -o alslime ./cmd/app
```

### 配布版（GitHub Releases）

準備中です。

## 支援

AlSlime は無料で利用できます。開発を支援していただいた方向けの追加機能を準備中です（GitHub Sponsors — 準備中）。

## ライセンス

本リポジトリは **source-available** です。オープンソース（OSI 定義）ではありません。

- ソースコードのライセンス: [PolyForm Noncommercial License 1.0.0](LICENSE.md)
  - 閲覧・学習・改変・**非商用**での利用と再配布は自由です
  - **商用利用はできません**
- 利用規約（EULA）: [EULA.md](EULA.md) — 本ソフトウェアの利用には同意が必要です（18歳以上限定・無保証）

> Required Notice: Copyright (c) YakiMikan

### 第三者ライセンス

本ソフトウェアが利用する第三者ライブラリのライセンス表記は、配布物に THIRD-PARTY-NOTICES として同梱予定です（ソースからのビルドでは `go.mod` / `frontend/package.json` を参照してください）。

## コントリビュート

現在、Pull Request は受け付けていません。バグ報告・要望は Issue でお願いします。

## 免責

本ソフトウェアは現状有姿（AS IS）で提供され、いかなる保証もありません。AI の出力内容は、あなたが接続した外部 AI サービスが生成するものであり、開発者は関与できません。詳細は [EULA.md](EULA.md) を参照してください。
