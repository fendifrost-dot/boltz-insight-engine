import { useSyncExternalStore } from "react";

type DeskTheme = "light" | "dark";
const storageKey = "boltz:desk-theme";
const changeEvent = "boltz:desk-theme-change";
let fallbackTheme: DeskTheme = "light";
let useFallback = false;

function getTheme(): DeskTheme {
  if (useFallback) return fallbackTheme;
  try {
    return window.localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
  } catch {
    // The toggle still works if this browser blocks local storage.
    return fallbackTheme;
  }
}

function getServerTheme(): DeskTheme {
  return "light";
}

function subscribe(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === storageKey || event.key === null) onChange();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, onChange);
  };
}

export function useDeskTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);

  function toggleTheme() {
    fallbackTheme = theme === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem(storageKey, fallbackTheme);
      useFallback = false;
    } catch {
      // Keep the in-memory preference for this visit when persistence is unavailable.
      useFallback = true;
    }
    window.dispatchEvent(new Event(changeEvent));
  }

  return { theme, toggleTheme };
}
