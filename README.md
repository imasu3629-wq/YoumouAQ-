# YoumouAI Discord Bot

YoumouAI は、複数の最新AIモデル（GPT-5.5, Claude 4.7, Grok-3等）を統合した、高性能かつ多機能な Discord チャットボットです。

## ✨ 特徴
- **マルチモデル対応**: ダッシュボードから瞬時に AI モデルを切り替え可能。
- **マルチモーダル解析**: 画像、動画、テキストファイルの読み取りに対応。
- **リアクション操作**: 📝(要約) 🌐(翻訳) 🔍(解説) のリアクションで即座にAIがアクション。
- **権限システム**: Admin / Whitelist / Regular の3段階によるアクセス制限。
- **永続化**: MongoDB を使用したユーザー設定やホワイトリストの保存。
- **統計レポート**: トークン使用量やメッセージ数を可視化。

## 🚀 セットアップ

### 1. 依存関係のインストール
```bash
npm install
```

### 2. 環境変数の設定
`.env.example` を参考に `.env` ファイルを作成し、各APIキーを入力してください。

### 3. 起動
```bash
npm start
```

## 🛠️ コマンド
- `!dash` / `/dash`: 設定ダッシュボード
- `!stats` / `/stats`: 統計レポート
- `!help` / `/help`: ヘルプ表示
- `!whitelist`: ホワイトリスト管理 (Admin専用)

## 📦 技術スタック
- Node.js
- Discord.js v14
- MongoDB (Mongoose)
- VectorEngine API / Google Gemini API
