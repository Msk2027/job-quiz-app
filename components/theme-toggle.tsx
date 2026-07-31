"use client";

import { useEffect, useState } from "react";

const THEME_KEY = "study_theme_v1";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDark(document.documentElement.classList.contains("dark")),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "ライトモードに切り替え" : "ダークモードに切り替え"}
      title={dark ? "ライトモード" : "ダークモード"}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/30 text-lg"
    >
      {dark ? "☀︎" : "☾"}
    </button>
  );
}
