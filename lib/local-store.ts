import type { StudySnapshot } from "@/lib/study-storage";
import type { Attempt, Subject } from "@/lib/study-types";

export const SUBJECTS_KEY = "study_subjects_v2";
export const ATTEMPTS_KEY = "study_attempts_v2";
export const CACHE_UPDATED_KEY = "study_cache_updated_v2";
export const CACHE_DIRTY_KEY = "study_cache_dirty_v2";
export const SYNCED_IDS_KEY = "study_synced_ids_v2";
export const BACKUP_KEY = "study_backup_v2";

export const userKey = (key: string, userId: string) => `${key}:${userId}`;

// localStorageは端末やモードによって書き込みが失敗する（プライベートモード、
// 容量超過など）。失敗を握りつぶすと保存できたように見えてデータが消えるため、
// 失敗したキーはメモリへ退避しつつ理由を記録する。
const memory = new Map<string, string>();
const failedKeys = new Set<string>();
let storageError: string | null = null;

const describe = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export const getStorageError = () => storageError;
export const isStorageHealthy = () => failedKeys.size === 0;

export function readRaw(key: string): string | null {
  if (failedKeys.has(key)) return memory.get(key) ?? null;
  try {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
  } catch (error) {
    storageError = describe(error);
  }
  return memory.get(key) ?? null;
}

export function writeRaw(key: string, value: string): boolean {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
    failedKeys.delete(key);
    if (!failedKeys.size) storageError = null;
    return true;
  } catch (error) {
    storageError = describe(error);
    failedKeys.add(key);
    return false;
  }
}

export function removeRaw(key: string) {
  memory.delete(key);
  failedKeys.delete(key);
  try {
    localStorage.removeItem(key);
  } catch (error) {
    storageError = describe(error);
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    // 壊れた値でそのまま上書きすると復旧できなくなるので退避しておく
    writeRaw(`${key}:corrupted`, raw);
    storageError = `保存データを読み取れませんでした（${key}）`;
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  return writeRaw(key, JSON.stringify(value));
}

export function hasKey(key: string) {
  return readRaw(key) !== null;
}

let degraded = false;
export const isStorageDegraded = () => degraded;

/**
 * 科目・問題・履歴をまとめて保存する。容量が足りないときは、
 * 作成した問題を優先して残し、古い履歴から削って保存を試みる。
 * （履歴はクラウド側には完全な形で残る）
 */
export function writeSnapshotKeys(
  subjectsKey: string,
  attemptsKey: string,
  snapshot: StudySnapshot,
) {
  if (
    writeJson(subjectsKey, snapshot.subjects) &&
    writeJson(attemptsKey, snapshot.attempts)
  ) {
    degraded = false;
    return true;
  }
  for (const keep of [50, 20, 5, 0]) {
    if (keep >= snapshot.attempts.length) continue;
    if (
      writeJson(attemptsKey, snapshot.attempts.slice(0, keep)) &&
      writeJson(subjectsKey, snapshot.subjects)
    ) {
      degraded = true;
      return false;
    }
  }
  degraded = true;
  return false;
}

export const countQuestions = (subjects: Subject[]) =>
  subjects.reduce((total, subject) => total + subject.questions.length, 0);

export const snapshotSize = (snapshot: StudySnapshot) =>
  snapshot.subjects.length + snapshot.attempts.length;

export const isEmptySnapshot = (snapshot: StudySnapshot) =>
  snapshotSize(snapshot) === 0;

export type SyncedIds = {
  subjects: string[];
  questions: string[];
  attempts: string[];
};

export const emptySyncedIds: SyncedIds = {
  subjects: [],
  questions: [],
  attempts: [],
};

export const snapshotIds = (snapshot: StudySnapshot): SyncedIds => ({
  subjects: snapshot.subjects.map((subject) => subject.id),
  questions: snapshot.subjects.flatMap((subject) =>
    subject.questions.map((question) => question.id),
  ),
  attempts: snapshot.attempts.map((attempt) => attempt.id),
});

const restoreMissing = <T extends { id: string }>(
  remote: T[],
  local: T[],
  syncedIds: string[],
) => {
  const remoteIds = new Set(remote.map((item) => item.id));
  const synced = new Set(syncedIds);
  // 同期済みなのにクラウドから消えている＝他端末で削除された、と判断する。
  // 一度も同期していないものだけを復元するので、削除は復活しない。
  return local.filter(
    (item) => !remoteIds.has(item.id) && !synced.has(item.id),
  );
};

/**
 * クラウドの内容を基準にしつつ、まだ同期できていない端末側のデータを取り戻す。
 * クラウド側の保存が一部失敗していても、端末に残っている分が消えないようにする。
 */
export function mergeSnapshots(
  remote: StudySnapshot,
  local: StudySnapshot,
  syncedIds: SyncedIds,
) {
  const localSubjects = new Map(
    local.subjects.map((subject) => [subject.id, subject]),
  );
  const syncedQuestions = new Set(syncedIds.questions);
  let restored = 0;

  const subjects = remote.subjects.map((subject) => {
    const localSubject = localSubjects.get(subject.id);
    if (!localSubject) return subject;
    const remoteQuestionIds = new Set(
      subject.questions.map((question) => question.id),
    );
    const missing = localSubject.questions.filter(
      (question) =>
        !remoteQuestionIds.has(question.id) &&
        !syncedQuestions.has(question.id),
    );
    if (!missing.length) return subject;
    restored += missing.length;
    return { ...subject, questions: [...subject.questions, ...missing] };
  });

  const restoredSubjects = restoreMissing(
    remote.subjects,
    local.subjects,
    syncedIds.subjects,
  );
  const restoredAttempts = restoreMissing(
    remote.attempts,
    local.attempts,
    syncedIds.attempts,
  );
  restored += restoredSubjects.length + restoredAttempts.length;

  return {
    snapshot: {
      subjects: [...subjects, ...restoredSubjects],
      // 履歴は新しい順に並んでいるため、未同期分は先頭へ戻す
      attempts: [...restoredAttempts, ...remote.attempts],
    },
    restored,
  };
}

export type BackupPayload = {
  app: "study-studio";
  version: 1;
  exportedAt: string;
  subjects: Subject[];
  attempts: Attempt[];
};

export const buildBackup = (snapshot: StudySnapshot): BackupPayload => ({
  app: "study-studio",
  version: 1,
  exportedAt: new Date().toISOString(),
  subjects: snapshot.subjects,
  attempts: snapshot.attempts,
});

export function parseBackup(text: string): StudySnapshot {
  const parsed = JSON.parse(text) as Partial<BackupPayload>;
  if (!parsed || typeof parsed !== "object")
    throw new Error("バックアップの形式が正しくありません");
  const subjects = Array.isArray(parsed.subjects) ? parsed.subjects : [];
  const attempts = Array.isArray(parsed.attempts) ? parsed.attempts : [];
  if (!subjects.length && !attempts.length)
    throw new Error("バックアップに科目・履歴が含まれていません");
  return { subjects, attempts };
}

/** 端末内バックアップ（最後に利用者が意図した内容）を読み書きする */
export const backupKey = (userId?: string) =>
  userId ? userKey(BACKUP_KEY, userId) : BACKUP_KEY;

export function writeBackup(
  userId: string | undefined,
  snapshot: StudySnapshot,
) {
  return writeJson(backupKey(userId), buildBackup(snapshot));
}

export function readBackup(userId?: string): StudySnapshot | null {
  const stored = readJson<Partial<BackupPayload> | null>(
    backupKey(userId),
    null,
  );
  if (!stored) return null;
  const subjects = Array.isArray(stored.subjects) ? stored.subjects : [];
  const attempts = Array.isArray(stored.attempts) ? stored.attempts : [];
  if (!subjects.length && !attempts.length) return null;
  return { subjects, attempts };
}
