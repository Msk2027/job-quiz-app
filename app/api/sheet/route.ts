import { NextRequest, NextResponse } from "next/server";

const MAX_CSV_BYTES = 5 * 1024 * 1024;

function normalizeSheetUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com")
    throw new Error("GoogleスプレッドシートのURLを入力してください。");

  const published = url.pathname.match(/^\/spreadsheets\/d\/e\/([^/]+)\/pub$/);
  if (published) {
    url.searchParams.set("output", "csv");
    return url;
  }

  const regular = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (regular) {
    const gid = url.searchParams.get("gid") || url.hash.match(/gid=(\d+)/)?.[1];
    const exportUrl = new URL(
      `https://docs.google.com/spreadsheets/d/${regular[1]}/export`,
    );
    exportUrl.searchParams.set("format", "csv");
    if (gid) exportUrl.searchParams.set("gid", gid);
    return exportUrl;
  }

  throw new Error("GoogleスプレッドシートのURL形式を確認してください。");
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl)
    return NextResponse.json(
      { error: "CSV URLが指定されていません。" },
      { status: 400 },
    );

  try {
    const url = normalizeSheetUrl(rawUrl);
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new Error(`スプレッドシートの取得に失敗しました（${response.status}）。`);

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_CSV_BYTES)
      throw new Error("CSVのサイズが大きすぎます。");

    const csv = await response.text();
    if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES)
      throw new Error("CSVのサイズが大きすぎます。");
    if (
      response.headers.get("content-type")?.includes("text/html") ||
      /^\s*<!doctype html/i.test(csv)
    )
      throw new Error(
        "スプレッドシートをCSVとして取得できません。共有・公開設定を確認してください。",
      );

    return new NextResponse(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "スプレッドシートの取得がタイムアウトしました。もう一度お試しください。"
        : error instanceof Error
          ? error.message
          : "スプレッドシートを取得できませんでした。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
