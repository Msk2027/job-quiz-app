import { typeName } from "@/lib/questions";
import type { AnswerRecord, QType } from "@/lib/study-types";

export const shuffle = <T,>(items: T[]) =>
  items
    .map((item) => ({ item, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ item }) => item);

export function scoreExam(
  answers: AnswerRecord[],
  passPercentage: number,
) {
  const essayPending = answers.some(
    (answer) => answer.type === "essay" && !answer.grading,
  );
  const scored = answers.flatMap((answer) => {
    if (answer.type === "essay")
      return answer.grading ? [answer.grading.score] : [];
    return [answer.correct ? 100 : 0];
  });
  const percentage = scored.length
    ? Math.round(
        (scored.reduce((sum, score) => sum + score, 0) / scored.length) * 10,
      ) / 10
    : 0;
  return {
    score: answers.filter((answer) => answer.correct === true).length,
    total: answers.filter((answer) => answer.type !== "essay").length,
    percentage,
    essayPending,
    passed: essayPending ? undefined : percentage >= passPercentage,
  };
}

export type AnswerStats = {
  total: number;
  autoTotal: number;
  correct: number;
  incorrect: number;
  essayTotal: number;
  essayGraded: number;
  essayPending: number;
  essayAverage: number | null;
};

export function summarizeAnswers(answers: AnswerRecord[]): AnswerStats {
  const essays = answers.filter((answer) => answer.type === "essay");
  const graded = essays.filter((answer) => answer.grading);
  return {
    total: answers.length,
    autoTotal: answers.filter((answer) => answer.type !== "essay").length,
    correct: answers.filter((answer) => answer.correct === true).length,
    incorrect: answers.filter((answer) => answer.correct === false).length,
    essayTotal: essays.length,
    essayGraded: graded.length,
    essayPending: essays.length - graded.length,
    essayAverage: graded.length
      ? Math.round(
          (graded.reduce(
            (sum, answer) => sum + (answer.grading?.score || 0),
            0,
          ) /
            graded.length) *
            10,
        ) / 10
      : null,
  };
}

const TYPE_ORDER: QType[] = ["choice", "ox", "fill", "essay"];

export function breakdownAnswers(
  answers: AnswerRecord[],
  by: "subject" | "type",
) {
  const groups = new Map<string, { label: string; answers: AnswerRecord[] }>();
  answers.forEach((answer) => {
    const key =
      by === "subject"
        ? answer.subjectId || answer.subjectName || "unknown"
        : answer.type || "choice";
    const label =
      by === "subject"
        ? answer.subjectName || "科目未設定"
        : typeName[answer.type || "choice"];
    const group = groups.get(key) || { label, answers: [] };
    group.answers.push(answer);
    groups.set(key, group);
  });
  const rows = Array.from(groups, ([key, group]) => ({
    key,
    label: group.label,
    stats: summarizeAnswers(group.answers),
  }));
  return by === "type"
    ? rows.sort(
        (a, b) =>
          TYPE_ORDER.indexOf(a.key as QType) -
          TYPE_ORDER.indexOf(b.key as QType),
      )
    : rows;
}

export const formatRemainingTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
