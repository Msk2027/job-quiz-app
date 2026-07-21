import type { QType, Question } from "@/lib/study-types";

const uid = () => crypto.randomUUID();

export const MIN_CHOICE_OPTIONS = 2;
export const MAX_CHOICE_OPTIONS = 10;

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
  return new Promise<Question[]>((resolve, reject) =>
    Papa.parse<Record<string, string>>(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) =>
        resolve(data.map(rowToQuestion).filter((q): q is Question => !!q)),
      error: reject,
    }),
  );
}
