import type { QType, Question } from "@/lib/study-types";

const uid = () => crypto.randomUUID();

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
  choice: "4択",
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
  return {
    id: (row.id || row.ID || "").trim() || stableId(`${type}:${question}`),
    type,
    question,
    options: [row.option1, row.option2, row.option3, row.option4].filter(
      Boolean,
    ),
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
