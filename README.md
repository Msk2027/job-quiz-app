# job-quiz-app（期末試験対策アプリ）

Google スプレッドシートで管理した問題を読み込んで出題する、4択クイズ形式の試験対策 Web アプリです。[Next.js](https://nextjs.org)（App Router）+ TypeScript + Tailwind CSS で作られています。

成績の履歴や問題ごとの正答率（弱点分析）はブラウザの `localStorage` に保存されるため、サーバーやデータベースは不要です。

## 主な機能

- **4択クイズ**: スプレッドシートの問題からランダムに出題。選択肢の並び順も毎回シャッフルされます。
- **出題数の指定**: スライダーまたは数値入力で、出題する問題数を選べます。
- **解説表示**: 回答後に正誤と解説を表示します。
- **途中中断**: クイズを途中で終了して、そこまでの成績を記録できます。
- **成績履歴**: 過去の挑戦結果（最大50件）と、間違えた問題・正解を確認できます。
- **統計データ（弱点分析）**: 問題ごとの正答率を集計し、苦手な問題順に表示します。

## 動作の仕組み

問題データは下記の形式の CSV（Google スプレッドシートの「ウェブに公開」機能で出力した URL）から読み込みます。

| 列名 | 内容 |
| --- | --- |
| `question` | 問題文 |
| `option1` 〜 `option4` | 選択肢 |
| `answer` | 正解の選択肢番号（`1`〜`4`） |
| `explanation` | 解説文 |

読み込み先の URL とアプリのタイトル・科目名は `app/page.tsx` の先頭付近で設定しています。

```tsx
// app/page.tsx
const APP_TITLE = "期末試験対策";
const APP_SUBTITLE = "消費者行動論Ⅱ";
// ...
const SHEET_URL = 'https://docs.google.com/.../pub?...&output=csv';
```

## セットアップ

依存パッケージをインストールし、開発サーバーを起動します。

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) をブラウザで開くとアプリが表示されます。`app/page.tsx` を編集すると自動で再読み込みされます。

### その他のコマンド

```bash
npm run build   # 本番ビルド
npm run start   # 本番サーバー起動
npm run lint    # ESLint によるチェック
```

## 技術スタック

- [Next.js 16](https://nextjs.org)（App Router, `app/` ディレクトリ）
- React 19 / TypeScript
- [Tailwind CSS 4](https://tailwindcss.com)
- [PapaParse](https://www.papaparse.com/)（CSV パース）

## ディレクトリ構成

```
app/
  layout.tsx   … 全体レイアウト・メタdata（タブのタイトルなど）
  page.tsx     … アプリ本体（クイズ・履歴・統計の全画面）
  globals.css  … グローバルスタイル
public/        … 静的ファイル（アイコン等）
```

## 今後の機能（ロードマップ）

今後の実装を検討している機能です。

### ① 複数科目への対応

現状は単一科目（1つのスプレッドシート）のみに対応しています。期末試験に向けて、複数科目を切り替えて学習できるようにする予定です。

想定している方向性:

- 科目ごとに問題ソース（スプレッドシート URL）を持たせ、メニューで科目を選択できるようにする。
- 成績履歴・統計データを科目ごとに分けて保存・表示する（`localStorage` のキーを科目別に分割）。

### ② 論述問題への対応

現状は4択（選択式）のみに対応しています。論述・記述式の問題にも対応できるようにする予定です。

想定している方向性:

- 問題データに問題種別（選択式 / 論述式）の列を追加する。
- 論述問題ではテキスト入力欄を表示し、模範解答・採点ポイントを照らし合わせて自己採点できるようにする。

## デプロイ

Next.js アプリは [Vercel](https://vercel.com/new) で簡単にデプロイできます。詳細は [Next.js のデプロイドキュメント](https://nextjs.org/docs/app/building-your-application/deploying) を参照してください。
