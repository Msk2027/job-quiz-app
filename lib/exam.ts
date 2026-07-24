import type { AnswerRecord } from "@/lib/study-types";

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

export const formatRemainingTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
