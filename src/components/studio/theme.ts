export const THEME_STORAGE_KEY = "aigen-theme";

export type StudioTheme = "light" | "dark";

export function isStudioTheme(value: unknown): value is StudioTheme {
  return value === "light" || value === "dark";
}

/** Default light for outdoor / iPhone readability; last choice wins via localStorage. */
export function resolveStudioTheme(stored: string | null): StudioTheme {
  return isStudioTheme(stored) ? stored : "light";
}

export function applyStudioTheme(theme: StudioTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}
