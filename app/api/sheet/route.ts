import { NextRequest, NextResponse } from "next/server";

const MAX_CSV_BYTES = 5 * 1024 * 1024;

function normalizeSheetUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com")
    throw new Error("GoogleスプレッドシートのURLを入力してください。");

  const published = url.pathname.match(/^\/spreadsheets\/d\/e\/([^/]+)\/pub$/);
  if (published) {
    url.searchParams.set("output", "csv");
    const htmlUrl = new URL(url);
    htmlUrl.pathname = htmlUrl.pathname.replace(/\/pub$/, "/pubhtml");
    htmlUrl.searchParams.delete("output");
    return { csvUrl: url, htmlUrl };
  }

  const regular = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (regular) {
    const gid = url.searchParams.get("gid") || url.hash.match(/gid=(\d+)/)?.[1];
    const exportUrl = new URL(
      `https://docs.google.com/spreadsheets/d/${regular[1]}/export`,
    );
    exportUrl.searchParams.set("format", "csv");
    if (gid) exportUrl.searchParams.set("gid", gid);
    return { csvUrl: exportUrl };
  }

  throw new Error("GoogleスプレッドシートのURL形式を確認してください。");
}

const fetchSheet = (url: URL) =>
  fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity, code: string) => {
      if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
      const number =
        code[1].toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
    },
  );
}

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

function publishedHtmlToCsv(html: string) {
  const body = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || html;
  const rows = Array.from(body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((row) =>
      Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map(
        (cell) =>
          decodeHtml(
            cell[1]
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/<[^>]+>/g, "")
              .trim(),
          ),
      ),
    )
    .filter((row) => row.length);
  if (!rows.length)
    throw new Error(
      "公開されたスプレッドシートから問題表を読み取れませんでした。",
    );
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl)
    return NextResponse.json(
      { error: "CSV URLが指定されていません。" },
      { status: 400 },
    );

  try {
    const { csvUrl, htmlUrl } = normalizeSheetUrl(rawUrl);
    const response = await fetchSheet(csvUrl);
    let csv: string;
    if (response.ok && !response.headers.get("content-type")?.includes("text/html")) {
      csv = await response.text();
    } else if (htmlUrl) {
      const htmlResponse = await fetchSheet(htmlUrl);
      if (!htmlResponse.ok)
        throw new Error(
          `スプレッドシートの取得に失敗しました（${htmlResponse.status}）。公開設定を確認してください。`,
        );
      csv = publishedHtmlToCsv(await htmlResponse.text());
    } else {
      throw new Error(
        `スプレッドシートの取得に失敗しました（${response.status}）。「リンクを知っている全員が閲覧可」にしてください。`,
      );
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_CSV_BYTES)
      throw new Error("CSVのサイズが大きすぎます。");

    if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES)
      throw new Error("CSVのサイズが大きすぎます。");
    if (/^\s*<!doctype html/i.test(csv))
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
