"use client";
import { useMemo, useState } from "react";
import { breakdownAnswers, summarizeAnswers } from "@/lib/exam";
import { typeName } from "@/lib/questions";
import type { AnswerRecord, QType, Question, Subject } from "@/lib/study-types";

type Filter = "all" | "wrong" | "correct" | "essay";

type ReviewItem = {
  record: AnswerRecord;
  number: number;
  question: string;
  type: QType;
  correctAnswer: string;
  explanation: string;
  contentChanged: boolean;
};

const findCurrentQuestion = (
  subjects: Subject[],
  record: AnswerRecord,
  fallbackSubjectId?: string,
): Question | undefined => {
  const subjectId = record.subjectId || fallbackSubjectId;
  const target = subjects.find((item) => item.id === subjectId);
  return (
    target?.questions.find((question) => question.id === record.questionId) ||
    (subjectId
      ? undefined
      : subjects
          .flatMap((item) => item.questions)
          .find((question) => question.id === record.questionId))
  );
};

const buildItems = (
  answers: AnswerRecord[],
  subjects: Subject[],
  fallbackSubjectId?: string,
): ReviewItem[] =>
  answers.map((record, index) => {
    const current = findCurrentQuestion(subjects, record, fallbackSubjectId);
    return {
      record,
      number: index + 1,
      question: record.question || current?.question || "過去の問題",
      type: record.type || current?.type || "choice",
      correctAnswer: record.correctAnswer || current?.answer || "",
      explanation: record.explanation || current?.explanation || "",
      contentChanged: !!(
        current &&
        record.question &&
        (record.question !== current.question ||
          record.type !== current.type ||
          record.correctAnswer !== current.answer ||
          (record.explanation || "") !== current.explanation ||
          (record.modelAnswer || "") !== current.modelAnswer ||
          (record.rubric || "") !== current.rubric)
      ),
    };
  });

const matchesFilter = (item: ReviewItem, filter: Filter) =>
  filter === "all"
    ? true
    : filter === "wrong"
      ? item.record.correct === false
      : filter === "correct"
        ? item.record.correct === true
        : item.type === "essay";

export function AnswerReviewList({
  answers,
  subjects,
  fallbackSubjectId,
  showSubject = false,
  showFilter = true,
}: {
  answers: AnswerRecord[];
  subjects: Subject[];
  fallbackSubjectId?: string;
  showSubject?: boolean;
  showFilter?: boolean;
}) {
  const items = useMemo(
    () => buildItems(answers, subjects, fallbackSubjectId),
    [answers, subjects, fallbackSubjectId],
  );
  const counts: Record<Filter, number> = {
    all: items.length,
    wrong: items.filter((item) => item.record.correct === false).length,
    correct: items.filter((item) => item.record.correct === true).length,
    essay: items.filter((item) => item.type === "essay").length,
  };
  const [filter, setFilter] = useState<Filter>(
    counts.wrong > 0 ? "wrong" : "all",
  );
  const visible = items.filter((item) => matchesFilter(item, filter));
  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: "すべて" },
    { value: "wrong", label: "間違えた問題" },
    { value: "correct", label: "正解した問題" },
    { value: "essay", label: "論述" },
  ];
  return (
    <div className="text-left">
      {showFilter && (
        <div className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <button
              key={item.value}
              onClick={() => setFilter(item.value)}
              className={`rounded-full border px-4 py-2 text-sm font-bold ${
                filter === item.value
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-300 text-gray-600"
              }`}
            >
              {item.label} {counts[item.value]}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 space-y-3">
        {!visible.length && (
          <p className="rounded-xl bg-gray-50 p-5 text-center text-sm text-gray-500">
            {filter === "wrong"
              ? "間違えた問題はありません"
              : "表示できる問題がありません"}
          </p>
        )}
        {visible.map((item) => {
          const { record } = item;
          const wrong = record.correct === false;
          return (
            <div
              key={`${record.questionId}-${item.number}`}
              className={`rounded-xl border p-4 ${
                wrong
                  ? "border-red-200 bg-red-50"
                  : record.correct === true
                    ? "border-green-200 bg-green-50"
                    : "border-gray-200 bg-gray-50"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-gray-500">
                    <span className="rounded bg-white px-2 py-1">
                      Q{item.number}
                    </span>
                    <span className="rounded bg-white px-2 py-1">
                      {typeName[item.type]}
                    </span>
                    {showSubject && record.subjectName && (
                      <span className="rounded bg-white px-2 py-1">
                        {record.subjectName}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 font-bold">{item.question}</p>
                </div>
                <span
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-sm font-black ${
                    record.correct === true
                      ? "bg-green-600 text-white"
                      : wrong
                        ? "bg-red-600 text-white"
                        : record.grading
                          ? "bg-blue-600 text-white"
                          : "bg-amber-500 text-white"
                  }`}
                >
                  {record.correct === true
                    ? "正解"
                    : wrong
                      ? "不正解"
                      : record.grading
                        ? `${record.grading.score}点`
                        : "採点待ち"}
                </span>
              </div>
              {item.contentChanged && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                  この問題は回答後に内容が変更されています。表示中の履歴は回答当時の内容です。
                </p>
              )}
              <p className="mt-3 text-sm">
                <b>あなたの回答：</b>
                <span
                  className={
                    wrong ? "font-bold text-red-700" : "whitespace-pre-wrap"
                  }
                >
                  {record.answer || "（未回答）"}
                </span>
              </p>
              {item.type !== "essay" && item.correctAnswer && (
                <p className="mt-1 text-sm text-green-700">
                  <b>正解：</b>
                  {item.correctAnswer}
                </p>
              )}
              {item.explanation && (
                <p className="mt-1 text-sm text-gray-600">
                  <b>解説：</b>
                  {item.explanation}
                </p>
              )}
              {item.type === "essay" && (
                <div className="mt-3 rounded-lg bg-white p-3 text-sm">
                  {record.grading ? (
                    <div className="space-y-2">
                      <p className="text-lg font-black text-blue-700">
                        AI採点：{record.grading.score}点
                      </p>
                      <p>
                        <b>総合評価：</b>
                        {record.grading.assessment}
                      </p>
                      <p>
                        <b>良かった点：</b>
                        {record.grading.goodPoints}
                      </p>
                      <p>
                        <b>不足している点：</b>
                        {record.grading.missingPoints}
                      </p>
                      <p>
                        <b>改善した答案例：</b>
                        {record.grading.improvedAnswer}
                      </p>
                      <p className="text-xs text-gray-500">
                        取込日時：{record.grading.importedAt}
                      </p>
                    </div>
                  ) : (
                    <>
                      {record.modelAnswer && (
                        <p className="mb-2">
                          <b>模範解答：</b>
                          {record.modelAnswer}
                        </p>
                      )}
                      <p className="text-gray-600">
                        サイト内では採点しません。テキスト出力後、AIに採点させ、結果のExcelを取り込んでください。
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AnswerBreakdown({ answers }: { answers: AnswerRecord[] }) {
  const stats = summarizeAnswers(answers);
  const groups: { title: string; rows: ReturnType<typeof breakdownAnswers> }[] =
    [
      { title: "科目別", rows: breakdownAnswers(answers, "subject") },
      { title: "形式別", rows: breakdownAnswers(answers, "type") },
    ];
  return (
    <div className="text-left">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-green-50 p-4">
          <p className="text-xs font-bold text-green-700">正解</p>
          <p className="mt-1 text-2xl font-black text-green-700">
            {stats.correct}問
          </p>
        </div>
        <div className="rounded-xl bg-red-50 p-4">
          <p className="text-xs font-bold text-red-700">不正解</p>
          <p className="mt-1 text-2xl font-black text-red-700">
            {stats.incorrect}問
          </p>
        </div>
        <div className="rounded-xl bg-blue-50 p-4">
          <p className="text-xs font-bold text-blue-700">択一等の正答率</p>
          <p className="mt-1 text-2xl font-black text-blue-700">
            {stats.autoTotal
              ? `${Math.round((stats.correct / stats.autoTotal) * 1000) / 10}%`
              : "—"}
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 p-4">
          <p className="text-xs font-bold text-amber-700">論述</p>
          <p className="mt-1 text-2xl font-black text-amber-700">
            {!stats.essayTotal
              ? "なし"
              : stats.essayPending
                ? `採点待ち${stats.essayPending}問`
                : `平均${stats.essayAverage}点`}
          </p>
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.title} className="mt-5">
          <h4 className="text-sm font-black text-gray-500">{group.title}</h4>
          <div className="mt-2 space-y-2">
            {group.rows.map((row) => (
              <div
                key={row.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm"
              >
                <span className="font-bold">{row.label}</span>
                <span className="text-gray-600">
                  {[
                    row.stats.autoTotal
                      ? `正解 ${row.stats.correct}/${row.stats.autoTotal}（${
                          Math.round(
                            (row.stats.correct / row.stats.autoTotal) * 1000,
                          ) / 10
                        }%）`
                      : "",
                    row.stats.essayTotal
                      ? row.stats.essayPending
                        ? `論述${row.stats.essayTotal}問（採点待ち${row.stats.essayPending}問）`
                        : `論述${row.stats.essayTotal}問（平均${row.stats.essayAverage}点）`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("・")}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
