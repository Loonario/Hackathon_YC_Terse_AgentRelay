// next/font gives fonts hashed family names; canvas text needs the real ones.
const read = (v: string, fallback: string) =>
  (typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(v).trim()) || fallback;

export const pixelFont = () => read("--font-pixel", "monospace");
export const bodyFont = () => read("--font-geist-sans", "system-ui, sans-serif");
