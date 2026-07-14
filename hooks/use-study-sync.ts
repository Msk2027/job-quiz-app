"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Attempt, Subject, SyncStatus } from "@/lib/study-types";

const SUBJECTS_KEY = "study_subjects_v2";
const ATTEMPTS_KEY = "study_attempts_v2";
const userCacheKey = (key: string, userId: string) => `${key}:${userId}`;
const serialize = (subjects: Subject[], attempts: Attempt[]) =>
  JSON.stringify({ subjects, attempts });
const readJson = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

export function useStudySync() {
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
  const lastSyncedData = useRef("");
  const sessionUserId = session?.user.id;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSubjects(readJson(SUBJECTS_KEY, []));
      setAttempts(readJson(ATTEMPTS_KEY, []));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (sessionUserId) {
      localStorage.setItem(
        userCacheKey(SUBJECTS_KEY, sessionUserId),
        JSON.stringify(subjects),
      );
    } else if (!isSupabaseConfigured) {
      localStorage.setItem(SUBJECTS_KEY, JSON.stringify(subjects));
    }
  }, [subjects, ready, sessionUserId]);

  useEffect(() => {
    if (!ready) return;
    if (sessionUserId) {
      localStorage.setItem(
        userCacheKey(ATTEMPTS_KEY, sessionUserId),
        JSON.stringify(attempts),
      );
    } else if (!isSupabaseConfigured) {
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
    }
  }, [attempts, ready, sessionUserId]);

  useEffect(() => {
    if (!ready || !supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthChecked(true);
      if (!data.session) setSyncStatus("offline");
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthChecked(true);
      if (nextSession && event === "SIGNED_IN") {
        setCloudReady(false);
        setSyncStatus("loading");
      } else if (!nextSession) {
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
      const userSubjects = readJson<Subject[]>(
        userCacheKey(SUBJECTS_KEY, userId),
        [],
      );
      const legacySubjects = readJson<Subject[]>(SUBJECTS_KEY, []);
      const cachedSubjects = userSubjects.length
        ? userSubjects
        : legacySubjects;
      const userAttempts = readJson<Attempt[]>(
        userCacheKey(ATTEMPTS_KEY, userId),
        [],
      );
      const legacyAttempts = readJson<Attempt[]>(ATTEMPTS_KEY, []);
      const cachedAttempts = userAttempts.length
        ? userAttempts
        : legacyAttempts;

      await Promise.resolve();
      if (cachedSubjects.length || cachedAttempts.length) {
        setSubjects(cachedSubjects);
        setAttempts(cachedAttempts);
      }

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      const { data, error } = await supabase!
        .from("user_data")
        .select("subjects, attempts")
        .eq("user_id", userId)
        .abortSignal(controller.signal)
        .maybeSingle();
      window.clearTimeout(timeout);
      if (!active) return;
      if (error) {
        setSyncStatus("error");
        setCloudReady(false);
        return;
      }

      const remoteSubjects: Subject[] =
        data && Array.isArray(data.subjects) ? data.subjects : [];
      const remoteAttempts: Attempt[] =
        data && Array.isArray(data.attempts) ? data.attempts : [];
      const shouldMigrate =
        cachedSubjects.length + cachedAttempts.length > 0 &&
        remoteSubjects.length + remoteAttempts.length === 0;

      if (!data || shouldMigrate) {
        const { error: migrationError } = await supabase!
          .from("user_data")
          .upsert({
            user_id: userId,
            subjects: cachedSubjects,
            attempts: cachedAttempts,
            updated_at: new Date().toISOString(),
          });
        if (!active) return;
        if (migrationError) {
          setSyncStatus("error");
          setCloudReady(false);
          return;
        }
        lastSyncedData.current = serialize(cachedSubjects, cachedAttempts);
        setSubjects(cachedSubjects);
        setAttempts(cachedAttempts);
      } else {
        lastSyncedData.current = serialize(remoteSubjects, remoteAttempts);
        setSubjects(remoteSubjects);
        setAttempts(remoteAttempts);
      }

      localStorage.removeItem(SUBJECTS_KEY);
      localStorage.removeItem(ATTEMPTS_KEY);
      setSyncStatus("saved");
      setCloudReady(true);
    }

    loadCloudData().catch(() => {
      if (active) {
        setSyncStatus("error");
        setCloudReady(false);
      }
    });
    return () => {
      active = false;
    };
  }, [ready, sessionUserId, syncRetry]);

  useEffect(() => {
    if (!supabase || !sessionUserId || !cloudReady) return;
    const serialized = serialize(subjects, attempts);
    if (serialized === lastSyncedData.current) return;
    const client = supabase;
    const timer = window.setTimeout(async () => {
      setSyncStatus("saving");
      const { error } = await client.from("user_data").upsert({
        user_id: sessionUserId,
        subjects,
        attempts,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        setSyncStatus("error");
      } else {
        lastSyncedData.current = serialized;
        setSyncStatus("saved");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [subjects, attempts, sessionUserId, cloudReady]);

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSubjects([]);
    setAttempts([]);
  }

  function retrySync() {
    setSyncStatus("loading");
    setSyncRetry((value) => value + 1);
  }

  return {
    ready,
    subjects,
    setSubjects,
    attempts,
    setAttempts,
    session,
    authChecked,
    syncStatus,
    retrySync,
    signOut,
  };
}
