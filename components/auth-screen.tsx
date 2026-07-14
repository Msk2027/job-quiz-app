"use client";

import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabase";

const AUTH_ERRORS: Record<string, string> = {
  "Invalid login credentials": "メールアドレスまたはパスワードが違います。",
  "Email not confirmed": "確認メール内のリンクを先に開いてください。",
  "User already registered": "このメールアドレスは登録済みです。",
  "Password should be at least 6 characters":
    "パスワードは6文字以上にしてください。",
};

export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError("");
    setMessage("");
    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (result.error) {
      setError(AUTH_ERRORS[result.error.message] || result.error.message);
      return;
    }
    if (mode === "signup" && !result.data.session) {
      setMessage(
        "確認メールを送りました。メール内のリンクを開いてからログインしてください。",
      );
    }
  }

  function switchMode() {
    setMode(mode === "login" ? "signup" : "login");
    setError("");
    setMessage("");
  }

  return (
    <main className="min-h-screen grid place-items-center p-4 bg-gray-50">
      <div className="card w-full max-w-md p-7 md:p-9">
        <p className="text-sm font-bold text-blue-700">Study Studio</p>
        <h1 className="mt-2 text-3xl font-black">
          {mode === "login" ? "ログイン" : "アカウント作成"}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          科目・問題・結果履歴を端末間で同期します
        </p>
        <form onSubmit={submitAuth} className="mt-7 space-y-4">
          <label className="block text-sm font-bold">
            メールアドレス
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 block w-full rounded-lg border p-3 font-normal"
            />
          </label>
          <label className="block text-sm font-bold">
            パスワード
            <input
              type="password"
              required
              minLength={6}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 block w-full rounded-lg border p-3 font-normal"
            />
          </label>
          {error && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
              {message}
            </p>
          )}
          <button
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 py-3 font-bold text-white disabled:bg-gray-300"
          >
            {loading ? "処理中…" : mode === "login" ? "ログイン" : "登録する"}
          </button>
        </form>
        <button
          onClick={switchMode}
          className="mt-5 w-full text-sm font-bold text-blue-700"
        >
          {mode === "login"
            ? "初めての方：アカウントを作成"
            : "登録済みの方：ログインへ戻る"}
        </button>
      </div>
    </main>
  );
}
