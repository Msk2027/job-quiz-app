# Study Studio

複数科目・複数問題形式・学習履歴・AI論述採点に対応した学習アプリです。

## Supabaseで端末間同期を有効にする

1. Supabaseでプロジェクトを作成します。
2. Supabaseの SQL Editor で [`supabase/schema.sql`](supabase/schema.sql) を実行します。
3. Supabaseの Authentication > Providers で Email を有効にします。
4. Vercelに次の環境変数を設定し、再デプロイします。
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
5. Supabaseの Authentication > URL Configuration で Site URL をVercelの本番URLにします。

環境変数が未設定の場合は、従来どおり端末内だけに保存されます。設定後に初めてログインしたとき、クラウド側が空ならその端末に残っている科目・問題・履歴を自動で移行します。

## 開発

```bash
npm install
npm run dev
```
