"use client";
import { useRef, useState } from "react";
import type { SyncDiagnostics } from "@/hooks/use-study-sync";
import { buildBackup, parseBackup } from "@/lib/local-store";
import type { StudySnapshot } from "@/lib/study-storage";

const formatTime = (value: number | null) =>
  value ? new Date(value).toLocaleString("ja-JP") : "まだ保存していません";

const statusLabel: Record<SyncDiagnostics["status"], string> = {
  loading: "読み込み中",
  saving: "保存中",
  saved: "クラウドに保存済み",
  error: "保存できていません",
  offline: "端末内のみ",
};

export function DataHealth({
  diagnostics,
  snapshot,
  onSaveNow,
  onRestore,
}: {
  diagnostics: SyncDiagnostics;
  snapshot: StudySnapshot;
  onSaveNow: () => Promise<unknown>;
  onRestore: (snapshot: StudySnapshot) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cloudActive = diagnostics.supabaseConfigured && diagnostics.signedIn;

  function download() {
    const payload = buildBackup(snapshot);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `study-studio-backup-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function restore(file: File) {
    try {
      const restored = parseBackup(await file.text());
      if (
        !confirm(
          `科目${restored.subjects.length}件・履歴${restored.attempts.length}件を取り込みます。現在のデータは消さず、足りないものだけ復元します。`,
        )
      )
        return;
      await onRestore(restored);
      alert("バックアップから復元しました");
    } catch (error) {
      alert(
        `復元できませんでした：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const rows: { label: string; value: string; warn?: boolean }[] = [
    {
      label: "クラウド同期",
      value: !diagnostics.supabaseConfigured
        ? "無効（Supabaseの環境変数が未設定のため、この端末にしか保存されません）"
        : diagnostics.signedIn
          ? `有効（${diagnostics.email ?? "ログイン中"}）`
          : "未ログイン",
      warn: !diagnostics.supabaseConfigured,
    },
    {
      label: "状態",
      value: statusLabel[diagnostics.status],
      warn: diagnostics.status === "error",
    },
    {
      label: "最後にクラウドへ保存",
      value: formatTime(diagnostics.lastSyncedAt),
      warn: cloudActive && !diagnostics.lastSyncedAt,
    },
    {
      label: "未送信の変更",
      value: diagnostics.pendingChanges ? "あり" : "なし",
      warn: diagnostics.pendingChanges,
    },
    {
      label: "この端末の保存",
      value: diagnostics.storageHealthy
        ? "正常"
        : `失敗・容量不足（${diagnostics.storageError ?? "原因不明"}）`,
      warn: !diagnostics.storageHealthy,
    },
    {
      label: "この端末のデータ",
      value: `科目${diagnostics.local.subjects}・問題${diagnostics.local.questions}・履歴${diagnostics.local.attempts}`,
    },
    {
      label: "クラウドのデータ",
      value: diagnostics.remote
        ? `科目${diagnostics.remote.subjects}・履歴${diagnostics.remote.attempts}`
        : "未取得",
    },
  ];
  if (diagnostics.restoredFromDevice > 0)
    rows.push({
      label: "端末から復元した件数",
      value: `${diagnostics.restoredFromDevice}件`,
    });
  if (diagnostics.lastError)
    rows.push({
      label: "直近のエラー",
      value: diagnostics.lastError,
      warn: true,
    });

  return (
    <section className="card mt-6 p-5 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-black">
            <span className="sm:hidden">保存・バックアップ</span>
            <span className="hidden sm:inline">データの保存状況とバックアップ</span>
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {!diagnostics.supabaseConfigured
              ? "クラウド同期が無効です。端末内だけに保存されています。"
              : diagnostics.status === "error"
                ? "クラウドに保存できていません。内容を確認してください。"
                : "保存先とバックアップを確認できます。"}
          </p>
        </div>
        <button
          onClick={() => setOpen((current) => !current)}
          className="h-11 w-full rounded-xl border px-4 font-bold sm:w-auto sm:min-w-36"
        >
          {open ? "閉じる ▲" : "詳細を見る ▼"}
        </button>
      </div>
      {open && (
        <>
          <dl className="mt-4 space-y-2">
            {rows.map((row) => (
              <div
                key={row.label}
                className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:justify-between sm:gap-2 ${
                  row.warn ? "border-amber-300 bg-amber-50" : ""
                }`}
              >
                <dt className="font-bold">{row.label}</dt>
                <dd
                  className={`break-words text-left sm:text-right ${row.warn ? "font-bold text-amber-800" : "text-gray-600"}`}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <button
              onClick={download}
              className="h-12 w-full rounded-xl bg-blue-600 px-5 font-bold text-white"
            >
              バックアップをダウンロード
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              className="h-12 w-full rounded-xl border border-blue-600 px-5 font-bold text-blue-700"
            >
              バックアップから復元
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void restore(file);
                event.target.value = "";
              }}
            />
            {cloudActive && (
              <button
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSaveNow();
                    alert("クラウドに保存しました");
                  } catch (error) {
                    alert(
                      `保存できませんでした：${
                        error instanceof Error ? error.message : String(error)
                      }`,
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                className="h-12 w-full rounded-xl border px-5 font-bold disabled:opacity-50"
              >
                {saving ? "保存中…" : "今すぐクラウドに保存"}
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            バックアップのJSONは、端末を変えるときや不具合時の復元に使えます。
            復元は「足りないものを追加する」動作なので、現在のデータは消えません。
          </p>
        </>
      )}
    </section>
  );
}
