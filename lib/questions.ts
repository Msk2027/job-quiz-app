import type { QType, Question } from "@/lib/study-types";

const uid = () => crypto.randomUUID();

export const MIN_CHOICE_OPTIONS = 2;
export const MAX_CHOICE_OPTIONS = 10;

export const dedupeQuestions = (questions: Question[]) =>
  Array.from(
    new Map(questions.map((question) => [question.id, question])).values(),
  );

const stableId = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `auto-${(hash >>> 0).toString(36)}`;
};

export const blankQuestion = (): Question => ({
  id: uid(),
  type: "choice",
  question: "",
  options: ["", "", "", ""],
  answer: "",
  explanation: "",
  modelAnswer: "",
  rubric: "",
});

export const typeName: Record<QType, string> = {
  choice: "選択式",
  ox: "○×",
  fill: "穴埋め",
  essay: "論述",
};

function rowToQuestion(row: Record<string, string>): Question | null {
  const question = (row.question || row.問題文 || "").trim();
  if (!question) return null;
  const rawType = (row.type || row.形式 || "choice").toLowerCase();
  const type: QType =
    rawType === "ox" || rawType === "○×"
      ? "ox"
      : rawType === "fill" || rawType === "穴埋め"
        ? "fill"
        : rawType === "essay" || rawType === "論述"
          ? "essay"
          : "choice";
  const options = Array.from({ length: MAX_CHOICE_OPTIONS }, (_, index) => {
    const number = index + 1;
    return (row[`option${number}`] || row[`選択肢${number}`] || "").trim();
  }).filter(Boolean);
  return {
    id: (row.id || row.ID || "").trim() || stableId(`${type}:${question}`),
    type,
    question,
    options,
    answer: row.answer || row.正解 || "",
    explanation: row.explanation || row.解説 || "",
    modelAnswer: row.modelAnswer || row.模範解答 || "",
    rubric: row.rubric || row.採点ポイント || "",
  };
}

export async function loadSheet(url: string) {
  const { default: Papa } = await import("papaparse");
  const response = await fetch(`/api/sheet?url=${encodeURIComponent(url)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || "スプレッドシートを取得できませんでした。");
  }

  const csv = await response.text();
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  const fatalError = parsed.errors.find(
    (error) => error.code !== "TooFewFields" && error.code !== "TooManyFields",
  );
  if (fatalError)
    throw new Error(`CSVを解析できませんでした（${fatalError.message}）。`);

  const questions = dedupeQuestions(
    parsed.data.map(rowToQuestion).filter((q): q is Question => !!q),
  );
  if (!questions.length)
    throw new Error(
      "問題を読み込めませんでした。CSVの「question」または「問題文」列を確認してください。",
    );
  return questions;
}

export async function loadQuestionFile(file: File) {
  let rows: Record<string, string>[];
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: "",
    });
  } else {
    const { default: Papa } = await import("papaparse");
    const parsed = Papa.parse<Record<string, string>>(await file.text(), {
      header: true,
      skipEmptyLines: true,
    });
    const fatalError = parsed.errors.find(
      (error) => error.code !== "TooFewFields" && error.code !== "TooManyFields",
    );
    if (fatalError) throw new Error(fatalError.message);
    rows = parsed.data;
  }
  const questions = dedupeQuestions(
    rows.map(rowToQuestion).filter((q): q is Question => !!q),
  );
  if (!questions.length)
    throw new Error("「question」または「問題文」列が見つかりません");
  return questions;
}
