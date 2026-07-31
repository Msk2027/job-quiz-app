"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ATTEMPTS_KEY,
  CACHE_DIRTY_KEY,
  CACHE_UPDATED_KEY,
  SUBJECTS_KEY,
  SYNCED_IDS_KEY,
  countQuestions,
  emptySyncedIds,
  getStorageError,
  isEmptySnapshot,
  isStorageDegraded,
  isStorageHealthy,
  mergeSnapshots,
  readBackup,
  readJson,
  readRaw,
  removeRaw,
  snapshotIds,
  userKey,
  writeBackup,
  writeJson,
  writeRaw,
  writeSnapshotKeys,
  type SyncedIds,
} from "@/lib/local-store";
import { dedupeQuestions } from "@/lib/questions";
import {
  loadLegacyData,
  loadAttemptAnswers,
  loadRelationalOverview,
  loadRelationalData,
  loadSubjectQuestions,
  saveLegacyBackup,
  saveRelationalChanges,
  type Deletions,
  type StudySnapshot,
} from "@/lib/study-storage";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Attempt, Subject, SyncStatus } from "@/lib/study-types";

const forceLegacyStorage =
  process.env.NEXT_PUBLIC_STUDY_STORAGE_MODE === "legacy";

export type SyncDiagnostics = {
  supabaseConfigured: boolean;
  signedIn: boolean;
  email: string | null;
  status: SyncStatus;
  storageMode: "relational" | "legacy" | "local";
  storageHealthy: boolean;
  storageError: string | null;
  lastError: string | null;
  lastSyncedAt: number | null;
  pendingChanges: boolean;
  restoredFromDevice: number;
  local: { subjects: number; questions: number; attempts: number };
  remote: { subjects: number; attempts: number } | null;
};

const serialize = (subjects: Subject[], attempts: Attempt[]) =>
  JSON.stringify({ subjects, attempts });
const dedupeSubjects = (subjects: Subject[]) =>
  Array.from(
    new Map(
      subjects.map((subject) => [
        subject.id,
        {
          ...subject,
          questions: dedupeQuestions(
            Array.isArray(subject.questions) ? subject.questions : [],
          ),
        },
      ]),
    ).values(),
  );
const normalize = (snapshot: StudySnapshot): StudySnapshot => ({
  subjects: dedupeSubjects(snapshot.subjects),
  attempts: Array.isArray(snapshot.attempts) ? snapshot.attempts : [],
});
const readCache = (userId?: string): StudySnapshot => ({
  subjects: readJson<Subject[]>(
    userId ? userKey(SUBJECTS_KEY, userId) : SUBJECTS_KEY,
    [],
  ),
  attempts: readJson<Attempt[]>(
    userId ? userKey(ATTEMPTS_KEY, userId) : ATTEMPTS_KEY,
    [],
  ),
});
const readSyncedIds = (userId: string): SyncedIds => {
  const stored = readJson<Partial<SyncedIds>>(
    userKey(SYNCED_IDS_KEY, userId),
    {},
  );
  return {
    subjects: Array.isArray(stored.subjects) ? stored.subjects : [],
    questions: Array.isArray(stored.questions) ? stored.questions : [],
    attempts: Array.isArray(stored.attempts) ? stored.attempts : [],
  };
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const overviewSnapshot = (snapshot: StudySnapshot): StudySnapshot => ({
  subjects: snapshot.subjects.map((subject) => ({
    ...subject,
    questionCount: subject.questionCount ?? subject.questions.length,
    questionsLoaded: false,
    questions: [],
  })),
  attempts: snapshot.attempts.map((attempt) => ({
    ...attempt,
    answersLoaded: false,
    answers: [],
  })),
});

const preserveUnloadedDetails = (
  snapshot: StudySnapshot,
  stored: StudySnapshot,
): StudySnapshot => {
  const storedSubjects = new Map(stored.subjects.map((item) => [item.id, item]));
  const storedAttempts = new Map(stored.attempts.map((item) => [item.id, item]));
  return {
    subjects: snapshot.subjects.map((subject) => {
      const previous = storedSubjects.get(subject.id);
      if (subject.questionsLoaded !== false || !previous) return subject;
      return {
        ...subject,
        questionCount: subject.questionCount ?? previous.questions.length,
        questionsLoaded: true,
        questions: previous.questions,
      };
    }),
    attempts: snapshot.attempts.map((attempt) => {
      const previous = storedAttempts.get(attempt.id);
      if (attempt.answersLoaded !== false || !previous) return attempt;
      return { ...attempt, answersLoaded: true, answers: previous.answers };
    }),
  };
};

export function useStudySync({ overviewOnly = false } = {}) {
  const [ready, setReady] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(!isSupabaseConfigured);
  const [cloudReady, setCloudReady] = useState(!isSupabaseConfigured);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    isSupabaseConfigured ? "loading" : "offline",
  );
  const [syncRetry, setSyncRetry] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [remoteCounts, setRemoteCounts] = useState<{
    subjects: number;
    attempts: number;
  } | null>(null);
  const [restoredFromDevice, setRestoredFromDevice] = useState(0);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [storageModeLabel, setStorageModeLabel] = useState<
    "relational" | "legacy"
  >("legacy");
  const lastSyncedData = useRef("");
  const lastSyncedSnapshot = useRef<StudySnapshot>({
    subjects: [],
    attempts: [],
  });
  const lastRemoteUpdatedAt = useRef(0);
  const storageMode = useRef<"relational" | "legacy">("legacy");
  const subjectsRef = useRef<Subject[]>([]);
  const attemptsRef = useRef<Attempt[]>([]);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const cacheLoadedForUser = useRef<string | null>(null);
  const suppressSync = useRef(false);
  const sessionUserId = session?.user.id;

  useEffect(() => {
    subjectsRef.current = subjects;
    attemptsRef.current = attempts;
  }, [subjects, attempts]);

  /**
   * 端末へ保存する。intent="user"は利用者の操作によるもので、内容が空でも
   * そのまま保存する。intent="mirror"はクラウド読み込み結果の写しなので、
   * 中身のあるデータを空で上書きしないようにする。
   */
  const writeLocalSnapshot = useCallback(
    (
      userId: string | undefined,
      snapshot: StudySnapshot,
      intent: "user" | "mirror",
      updatedAt = Date.now(),
    ) => {
      const persistedSnapshot = overviewOnly
        ? preserveUnloadedDetails(snapshot, readCache(userId))
        : snapshot;
      const empty = isEmptySnapshot(persistedSnapshot);
      if (userId) {
        if (intent === "mirror" && empty && !isEmptySnapshot(readCache(userId)))
          return true;
        const ok =
          writeSnapshotKeys(
            userKey(SUBJECTS_KEY, userId),
            userKey(ATTEMPTS_KEY, userId),
            persistedSnapshot,
          ) && writeRaw(userKey(CACHE_UPDATED_KEY, userId), String(updatedAt));
        if (intent === "user" || !empty) writeBackup(userId, persistedSnapshot);
        return ok;
      }
      // ログインしていない状態では端末内保存のみで動かす
      if (isSupabaseConfigured) return true;
      if (intent === "mirror" && empty && !isEmptySnapshot(readCache()))
        return true;
      const ok = writeSnapshotKeys(SUBJECTS_KEY, ATTEMPTS_KEY, persistedSnapshot);
      if (intent === "user" || !empty) writeBackup(undefined, persistedSnapshot);
      return ok;
    },
    [overviewOnly],
  );

  const markDirty = useCallback((userId: string) => {
    writeRaw(userKey(CACHE_DIRTY_KEY, userId), "1");
    setPendingChanges(true);
  }, []);
  const clearDirty = useCallback((userId: string) => {
    removeRaw(userKey(CACHE_DIRTY_KEY, userId));
    setPendingChanges(false);
  }, []);

  const updateSubjects: Dispatch<SetStateAction<Subject[]>> = useCallback(
    (value) => {
      const next = dedupeSubjects(
        typeof value === "function"
          ? (value as (current: Subject[]) => Subject[])(subjectsRef.current)
          : value,
      );
      subjectsRef.current = next;
      suppressSync.current = false;
      setSubjects(next);
      writeLocalSnapshot(
        sessionUserId,
        { subjects: next, attempts: attemptsRef.current },
        "user",
      );
      if (sessionUserId) markDirty(sessionUserId);
    },
    [sessionUserId, writeLocalSnapshot, markDirty],
  );
  const updateAttempts: Dispatch<SetStateAction<Attempt[]>> = useCallback(
    (value) => {
      const next =
        typeof value === "function"
          ? (value as (current: Attempt[]) => Attempt[])(attemptsRef.current)
          : value;
      attemptsRef.current = next;
      suppressSync.current = false;
      setAttempts(next);
      writeLocalSnapshot(
        sessionUserId,
        { subjects: subjectsRef.current, attempts: next },
        "user",
      );
      if (sessionUserId) markDirty(sessionUserId);
    },
    [sessionUserId, writeLocalSnapshot, markDirty],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const cached = readCache();
      // 端末内の保存が壊れていた場合はバックアップから復旧する
      const snapshot = isEmptySnapshot(cached)
        ? (readBackup() ?? cached)
        : cached;
      const visible = overviewOnly ? overviewSnapshot(snapshot) : snapshot;
      setSubjects(dedupeSubjects(visible.subjects));
      setAttempts(visible.attempts);
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [overviewOnly]);

  useEffect(() => {
    if (!ready) return;
    if (sessionUserId && !cloudReady) return;
    const serialized = serialize(subjects, attempts);
    const cacheUpdatedAt =
      serialized === lastSyncedData.current && lastRemoteUpdatedAt.current
        ? lastRemoteUpdatedAt.current
        : Date.now();
    writeLocalSnapshot(
      sessionUserId,
      { subjects, attempts },
      "mirror",
      cacheUpdatedAt,
    );
  }, [
    subjects,
    attempts,
    ready,
    sessionUserId,
    cloudReady,
    writeLocalSnapshot,
  ]);

  useEffect(() => {
    if (!ready || !supabase) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setAuthChecked(true);
        if (!data.session) setSyncStatus("offline");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAuthChecked(true);
        setLastError(errorMessage(error));
        setSyncStatus("error");
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthChecked(true);
      if (nextSession && event === "SIGNED_IN") {
        suppressSync.current = false;
        setCloudReady(false);
        setSyncStatus("loading");
      } else if (!nextSession) {
        cacheLoadedForUser.current = null;
        lastSyncedData.current = "";
        lastRemoteUpdatedAt.current = 0;
        setCloudReady(false);
        setSyncStatus("offline");
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [ready]);

  useEffect(() => {
    if (!ready || !supabase || !sessionUserId) return;
    let active = true;
    const userId = sessionUserId;

    async function loadCloudData() {
      const client = supabase!;
      const firstLoadForUser = cacheLoadedForUser.current !== userId;
      let cached: StudySnapshot;
      if (firstLoadForUser) {
        const userCache = readCache(userId);
        // 初回ログイン時のみ、ログイン前に端末へ保存されていた分を引き継ぐ
        cached = normalize(
          isEmptySnapshot(userCache) ? readCache() : userCache,
        );
        if (isEmptySnapshot(cached))
          cached = normalize(readBackup(userId) ?? cached);
        if (overviewOnly) cached = overviewSnapshot(cached);
        cacheLoadedForUser.current = userId;
        subjectsRef.current = cached.subjects;
        attemptsRef.current = cached.attempts;
        setSubjects(cached.subjects);
        setAttempts(cached.attempts);
      } else {
        cached = normalize({
          subjects: subjectsRef.current,
          attempts: attemptsRef.current,
        });
      }
      const cachedSerialized = serialize(cached.subjects, cached.attempts);
      const hasUnsyncedCache =
        readRaw(userKey(CACHE_DIRTY_KEY, userId)) === "1";

      const unavailableRelational = {
        available: false,
        subjects: [] as Subject[],
        attempts: [] as Attempt[],
        updatedAt: 0,
        error: undefined as string | undefined,
        deletions: null as Deletions | null,
      };
      const relational = forceLegacyStorage
        ? unavailableRelational
        : await (overviewOnly
            ? loadRelationalOverview(client, userId)
            : loadRelationalData(client, userId));
      // 正規化テーブルが利用できる場合、巨大なuser_dataバックアップは読まない。
      const legacy = relational.available
        ? unavailableRelational
        : await loadLegacyData(client, userId);
      if (!active) return;

      if (!legacy.available && !relational.available) {
        // 読み込めなかったときに端末のデータを空で置き換えない
        throw new Error(
          legacy.error ||
            relational.error ||
            "クラウドから読み込めませんでした",
        );
      }

      const useRelational =
        relational.available &&
        (!legacy.available || relational.updatedAt >= legacy.updatedAt);
      storageMode.current = relational.available ? "relational" : "legacy";
      setStorageModeLabel(storageMode.current);
      let remote: StudySnapshot = normalize(
        useRelational
          ? { subjects: relational.subjects, attempts: relational.attempts }
          : { subjects: legacy.subjects, attempts: legacy.attempts },
      );
      if (overviewOnly && useRelational) remote = overviewSnapshot(remote);
      let remoteUpdatedAt = useRelational
        ? relational.updatedAt
        : legacy.updatedAt;
      setRemoteCounts({
        subjects: remote.subjects.length,
        attempts: remote.attempts.length,
      });

      const latest = normalize({
        subjects: subjectsRef.current,
        attempts: attemptsRef.current,
      });
      const changedDuringLoad =
        serialize(latest.subjects, latest.attempts) !== cachedSerialized;
      const local = changedDuringLoad ? latest : cached;
      const syncedIds = firstLoadForUser
        ? readSyncedIds(userId)
        : snapshotIds(lastSyncedSnapshot.current);
      const { snapshot: merged, restored } = mergeSnapshots(
        remote,
        local,
        syncedIds,
        useRelational ? (relational.deletions ?? null) : null,
      );
      if (restored) setRestoredFromDevice((count) => count + restored);

      let next = merged;
      if (isEmptySnapshot(next)) {
        // クラウドも端末も空に見えるときは、端末内バックアップから戻す
        const backup = readBackup(userId) ?? readBackup();
        if (backup && !isEmptySnapshot(backup)) {
          next = normalize(backup);
          setRestoredFromDevice(
            (count) => count + next.subjects.length + next.attempts.length,
          );
        }
      }

      const mustUpload =
        serialize(next.subjects, next.attempts) !==
          serialize(remote.subjects, remote.attempts) || hasUnsyncedCache;
      if (mustUpload) {
        const uploadedAt = await uploadSnapshot(
          client,
          userId,
          remote,
          next,
          storageMode.current === "relational",
          !overviewOnly,
        );
        if (!active) return;
        remote = next;
        remoteUpdatedAt = uploadedAt;
        clearDirty(userId);
      }

      lastSyncedData.current = serialize(next.subjects, next.attempts);
      lastSyncedSnapshot.current = next;
      lastRemoteUpdatedAt.current = remoteUpdatedAt;
      subjectsRef.current = next.subjects;
      attemptsRef.current = next.attempts;
      setSubjects(next.subjects);
      setAttempts(next.attempts);
      setRemoteCounts({
        subjects: remote.subjects.length,
        attempts: remote.attempts.length,
      });

      const stored = writeLocalSnapshot(userId, next, "user", remoteUpdatedAt);
      writeJson(userKey(SYNCED_IDS_KEY, userId), snapshotIds(next));
      if (stored) {
        // 引き継ぎ済みのログイン前データを片付ける（保存できたときだけ）
        removeRaw(SUBJECTS_KEY);
        removeRaw(ATTEMPTS_KEY);
      }
      setLastError(null);
      setLastSyncedAt(Date.now());
      setSyncStatus("saved");
      setCloudReady(true);
    }

    loadCloudData().catch((error: unknown) => {
      if (!active) return;
      setLastError(errorMessage(error));
      setSyncStatus("error");
      setCloudReady(false);
    });
    return () => {
      active = false;
    };
  }, [
    ready,
    sessionUserId,
    syncRetry,
    clearDirty,
    writeLocalSnapshot,
    overviewOnly,
  ]);

  const persistSnapshot = useCallback(
    (nextSnapshot: StudySnapshot) => {
      if (!supabase || !sessionUserId || !cloudReady)
        return Promise.reject(new Error("クラウド同期の準備ができていません"));
      const client = supabase;
      const userId = sessionUserId;
      const serialized = serialize(
        nextSnapshot.subjects,
        nextSnapshot.attempts,
      );
      setSyncStatus("saving");
      const operation = saveQueue.current.then(async () => {
        const previousSnapshot = lastSyncedSnapshot.current;
        let updatedAt: number;
        try {
          updatedAt = await uploadSnapshot(
            client,
            userId,
            previousSnapshot,
            nextSnapshot,
            storageMode.current === "relational",
            !overviewOnly,
          );
        } catch (error) {
          setLastError(errorMessage(error));
          setSyncStatus("error");
          throw error;
        }
        lastSyncedData.current = serialized;
        lastSyncedSnapshot.current = nextSnapshot;
        lastRemoteUpdatedAt.current = updatedAt;
        writeJson(userKey(SYNCED_IDS_KEY, userId), snapshotIds(nextSnapshot));
        setRemoteCounts({
          subjects: nextSnapshot.subjects.length,
          attempts: nextSnapshot.attempts.length,
        });
        setLastError(null);
        setLastSyncedAt(Date.now());
        if (
          serialize(subjectsRef.current, attemptsRef.current) === serialized
        ) {
          clearDirty(userId);
          setSyncStatus("saved");
        }
      });
      saveQueue.current = operation.catch(() => undefined);
      return operation;
    },
    [sessionUserId, cloudReady, clearDirty, overviewOnly],
  );

  useEffect(() => {
    if (!supabase || !sessionUserId || !cloudReady) return;
    if (suppressSync.current) return;
    const serialized = serialize(subjects, attempts);
    if (serialized === lastSyncedData.current) return;
    const nextSnapshot = { subjects, attempts };
    const timer = window.setTimeout(() => {
      if (serialized === lastSyncedData.current) return;
      void persistSnapshot(nextSnapshot).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [subjects, attempts, sessionUserId, cloudReady, persistSnapshot]);

  const saveNow = useCallback(
    (nextSnapshot?: StudySnapshot) =>
      persistSnapshot(
        nextSnapshot || {
          subjects: subjectsRef.current,
          attempts: attemptsRef.current,
        },
      ),
    [persistSnapshot],
  );

  const ensureSubjectQuestions = useCallback(
    async (subjectId: string) => {
      const current = subjectsRef.current.find((item) => item.id === subjectId);
      if (!current || current.questionsLoaded !== false) return current?.questions || [];
      if (!supabase || !sessionUserId)
        throw new Error("クラウドから問題を取得できません");
      const questions = await loadSubjectQuestions(supabase, sessionUserId, subjectId);
      const nextSubjects = subjectsRef.current.map((item) =>
        item.id === subjectId
          ? {
              ...item,
              questions,
              questionCount: questions.length,
              questionsLoaded: true,
            }
          : item,
      );
      subjectsRef.current = nextSubjects;
      lastSyncedSnapshot.current = {
        subjects: nextSubjects,
        attempts: attemptsRef.current,
      };
      lastSyncedData.current = serialize(nextSubjects, attemptsRef.current);
      setSubjects(nextSubjects);
      writeLocalSnapshot(
        sessionUserId,
        { subjects: nextSubjects, attempts: attemptsRef.current },
        "mirror",
      );
      return questions;
    },
    [sessionUserId, writeLocalSnapshot],
  );

  const ensureAttemptAnswers = useCallback(
    async (attemptId: string) => {
      const current = attemptsRef.current.find((item) => item.id === attemptId);
      if (!current || current.answersLoaded !== false) return current?.answers || [];
      if (!supabase || !sessionUserId)
        throw new Error("クラウドから解答詳細を取得できません");
      const answers = await loadAttemptAnswers(supabase, sessionUserId, attemptId);
      const nextAttempts = attemptsRef.current.map((item) =>
        item.id === attemptId ? { ...item, answers, answersLoaded: true } : item,
      );
      attemptsRef.current = nextAttempts;
      lastSyncedSnapshot.current = {
        subjects: subjectsRef.current,
        attempts: nextAttempts,
      };
      lastSyncedData.current = serialize(subjectsRef.current, nextAttempts);
      setAttempts(nextAttempts);
      writeLocalSnapshot(
        sessionUserId,
        { subjects: subjectsRef.current, attempts: nextAttempts },
        "mirror",
      );
      return answers;
    },
    [sessionUserId, writeLocalSnapshot],
  );

  const getCompleteSnapshot = useCallback(async (): Promise<StudySnapshot> => {
    if (supabase && sessionUserId && storageMode.current === "relational") {
      const complete = await loadRelationalData(supabase, sessionUserId);
      if (complete.available)
        return { subjects: complete.subjects, attempts: complete.attempts };
    }
    return readCache(sessionUserId);
  }, [sessionUserId]);

  // アプリを閉じる・タブを切り替えるときに、未送信の変更を送り出す
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const flush = () => {
      const snapshot = {
        subjects: subjectsRef.current,
        attempts: attemptsRef.current,
      };
      if (
        serialize(snapshot.subjects, snapshot.attempts) ===
        lastSyncedData.current
      )
        return;
      if (sessionUserId) writeLocalSnapshot(sessionUserId, snapshot, "user");
      void saveNow(snapshot).catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [saveNow, sessionUserId, writeLocalSnapshot]);

  async function signOut() {
    if (!supabase) return;
    // 同期を止めてから状態を空にする（空の内容がクラウドへ送られないように）
    suppressSync.current = true;
    setCloudReady(false);
    await supabase.auth.signOut();
    cacheLoadedForUser.current = null;
    subjectsRef.current = [];
    attemptsRef.current = [];
    lastSyncedData.current = "";
    lastSyncedSnapshot.current = { subjects: [], attempts: [] };
    lastRemoteUpdatedAt.current = 0;
    setSubjects([]);
    setAttempts([]);
  }

  function retrySync() {
    setSyncStatus("loading");
    setSyncRetry((value) => value + 1);
  }

  /** バックアップファイルの内容を取り込む（現在のデータへ足し込む） */
  const restoreSnapshot = useCallback(
    async (snapshot: StudySnapshot) => {
      const merged = mergeSnapshots(
        normalize({
          subjects: subjectsRef.current,
          attempts: attemptsRef.current,
        }),
        normalize(snapshot),
        emptySyncedIds,
      ).snapshot;
      subjectsRef.current = merged.subjects;
      attemptsRef.current = merged.attempts;
      setSubjects(merged.subjects);
      setAttempts(merged.attempts);
      writeLocalSnapshot(sessionUserId, merged, "user");
      if (sessionUserId) markDirty(sessionUserId);
      if (supabase && sessionUserId && cloudReady) await saveNow(merged);
      return merged;
    },
    [sessionUserId, cloudReady, saveNow, writeLocalSnapshot, markDirty],
  );

  const diagnostics: SyncDiagnostics = {
    supabaseConfigured: isSupabaseConfigured,
    signedIn: !!sessionUserId,
    email: session?.user.email ?? null,
    status: syncStatus,
    storageMode: isSupabaseConfigured ? storageModeLabel : "local",
    storageHealthy: isStorageHealthy() && !isStorageDegraded(),
    storageError: getStorageError(),
    lastError,
    lastSyncedAt,
    pendingChanges,
    restoredFromDevice,
    local: {
      subjects: subjects.length,
      questions: countQuestions(subjects),
      attempts: attempts.length,
    },
    remote: remoteCounts,
  };

  return {
    ready,
    subjects,
    setSubjects: updateSubjects,
    attempts,
    setAttempts: updateAttempts,
    session,
    authChecked,
    syncStatus,
    saveNow,
    retrySync,
    signOut,
    restoreSnapshot,
    ensureSubjectQuestions,
    ensureAttemptAnswers,
    getCompleteSnapshot,
    diagnostics,
  };
}

/**
 * クラウドへ書き込む。分割テーブルへの保存が一部でも失敗した場合は、
 * 完全な内容を持つuser_dataを必ず新しい時刻で保存し、次回読み込みで
 * 欠けたデータが正になるのを防ぐ。
 */
async function uploadSnapshot(
  client: NonNullable<typeof supabase>,
  userId: string,
  previous: StudySnapshot,
  next: StudySnapshot,
  useRelational: boolean,
  updateLegacyBackup = true,
) {
  const updatedAt = new Date().toISOString();
  let relationalError: unknown = null;
  if (useRelational && !forceLegacyStorage) {
    try {
      await saveRelationalChanges(client, previous, next, updatedAt);
    } catch (error) {
      relationalError = error;
    }
  }
  const legacyAt = relationalError
    ? new Date(Date.now() + 1000).toISOString()
    : updatedAt;
  // 部分読み込み中のsnapshotを完全バックアップへ書くと、未取得の詳細が
  // 空データとして保存される。RPC未適用時は端末側を保持して同期エラーにする。
  if (relationalError && !updateLegacyBackup) throw relationalError;
  if (updateLegacyBackup || relationalError)
    await saveLegacyBackup(client, userId, next, legacyAt);
  return Date.parse(legacyAt);
}
