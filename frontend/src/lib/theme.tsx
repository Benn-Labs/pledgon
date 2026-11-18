"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

export type ThemePreference = "dark" | "light" | "system";

const STORAGE_KEY = "pledgon-theme";
const MOTION_KEY = "pledgon-reduce-motion";

type ResolvedTheme = "dark" | "light";

type ThemeState = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  reduceMotion: boolean;
};

// Module-level store: ThemeProvider mounts once, but the settings controls and
// anything else reading the theme subscribe through useSyncExternalStore,
// which requires a stable snapshot reference that only changes when the theme
// actually changes (plus a server snapshot for hydration — the layout ships
// the dark look, so the server snapshot is the dark default).
let state: ThemeState = { preference: "dark", resolved: "dark", reduceMotion: false };
const listeners = new Set<() => void>();
let initialized = false;

function emit(next: ThemeState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (resolved === "light") {
    root.dataset.theme = "light";
    root.classList.remove("dark");
  } else {
    delete root.dataset.theme;
    root.classList.add("dark");
  }
}

function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  const preference: ThemePreference = stored === "light" || stored === "system" ? stored : "dark";
  const resolved = preference === "system" ? systemTheme() : preference;
  const reduceMotion = window.localStorage.getItem(MOTION_KEY) === "1";

  applyResolvedTheme(resolved);
  document.documentElement.classList.toggle("force-reduced-motion", reduceMotion);
  state = { preference, resolved, reduceMotion };

  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (state.preference === "system") {
      const next = systemTheme();
      applyResolvedTheme(next);
      emit({ ...state, resolved: next });
    }
  });
}

function subscribe(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ThemeState {
  return state;
}

// Server (and the hydration pass) render the dark default shipped by
// layout.tsx; the client store takes over right after.
const SERVER_STATE: ThemeState = { preference: "dark", resolved: "dark", reduceMotion: false };
function getServerSnapshot(): ThemeState {
  return SERVER_STATE;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Subscribing at the provider level keeps the store initialized for every
  // useTheme consumer anywhere below, no matter which branch renders first.
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return children;
}

export function useTheme(): ThemeState & {
  setPreference: (next: ThemePreference) => void;
  setReduceMotion: (next: boolean) => void;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setPreference = useCallback((next: ThemePreference) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    const nextResolved = next === "system" ? systemTheme() : next;
    applyResolvedTheme(nextResolved);
    emit({ ...state, preference: next, resolved: nextResolved });
  }, []);

  const setReduceMotion = useCallback((next: boolean) => {
    window.localStorage.setItem(MOTION_KEY, next ? "1" : "0");
    document.documentElement.classList.toggle("force-reduced-motion", next);
    emit({ ...state, reduceMotion: next });
  }, []);

  return { ...snapshot, setPreference, setReduceMotion };
}
