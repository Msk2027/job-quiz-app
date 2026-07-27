# Study Studio

複数科目・複数問題形式・学習履歴・AI論述採点に対応した学習アプリです。

## Supabaseで端末間同期を有効にする

1. Supabaseでプロジェクトを作成します。
2. Supabaseの SQL Editor で [`supabase/schema.sql`](supabase/schema.sql) を実行します。
3. 続けて
   [`supabase/migrations/20260725010000_relational_study_storage.sql`](supabase/migrations/20260725010000_relational_study_storage.sql)
   と
   [`supabase/migrations/20260727120000_study_deletions.sql`](supabase/migrations/20260727120000_study_deletions.sql)
   を順に実行します。GitHub Integrationを有効にしている場合は、mainへの反映時に
   `supabase/migrations`の変更が自動適用されます。
   後者は削除履歴（tombstone）用で、未適用でもアプリは動作しますが、
   複数端末で削除を正しく同期するために必要です。
4. Supabaseの Authentication > Providers で Email を有効にします。
5. Vercelに次の環境変数を設定し、再デプロイします。
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
6. Supabaseの Authentication > URL Configuration で Site URL をVercelの本番URLにします。

環境変数が未設定の場合は、従来どおり端末内だけに保存されます。設定後に初めてログインしたとき、クラウド側が空ならその端末に残っている科目・問題・履歴を自動で移行します。

新方式では、科目・問題・履歴・回答を分割テーブルに保存します。従来の
`user_data`にも同じ内容をバックアップし続けるため、移行中も旧データは削除されません。
緊急時はVercelに`NEXT_PUBLIC_STUDY_STORAGE_MODE=legacy`を設定して再デプロイすると、
旧`user_data`方式へ戻せます。

## データが保存されない・消えるときの確認手順

ホーム画面下部の「データの保存状況とバックアップ」→「詳細を見る」で、いまどこに保存されているかを確認できます。

1. **「クラウド同期：無効」と出る場合**
   Vercelに`NEXT_PUBLIC_SUPABASE_URL`と`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`が設定されていません。
   この状態ではデータはその端末のブラウザにしか保存されず、他端末では見られません。
   iOSのSafariなどでは一定期間で自動的に消えることがあります。環境変数を設定して再デプロイしてください。
2. **「状態：保存できていません」「直近のエラー」が出る場合**
   表示されているエラー文がそのまま原因です。テーブル未作成なら
   [`supabase/schema.sql`](supabase/schema.sql)と`supabase/migrations`のSQLを実行してください。
3. **「この端末の保存：失敗・容量不足」と出る場合**
   ブラウザの保存容量がいっぱいか、プライベートモードです。
   「バックアップをダウンロード」でJSONを保存してから、不要な履歴を削除してください。
   なお容量が足りない場合でも、科目・問題を優先して端末に残し、履歴はクラウド側に保存します。

「バックアップをダウンロード」で保存したJSONは「バックアップから復元」で戻せます。
復元は現在のデータを消さず、足りないものだけを追加します。

## 選択式問題のCSV列

選択式問題は `option1` から `option10` まで読み込めます。日本語の列名 `選択肢1` から `選択肢10` も使用できます。空欄の選択肢は無視されるため、五択問題なら `option1`〜`option5` を入力してください。正解は `answer`（または `正解`）列に、正解の選択肢本文をそのまま入力します。

## 開発

```bash
npm install
npm run dev
```
