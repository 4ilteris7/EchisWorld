import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export type ExtractedArticle = {
  title: string | null;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  text: string;
  wordCount: number;
};

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function extractReadableArticle(
  html: string,
  url: string,
): ExtractedArticle | null {
  const dom = new JSDOM(html, { url });
  try {
    const parsed = new Readability(dom.window.document, {
      charThreshold: 80,
      keepClasses: false,
    }).parse();
    const text = cleanText(parsed?.textContent ?? "");
    if (text.length < 80) return null;

    return {
      title: parsed?.title?.trim() || null,
      byline: parsed?.byline?.trim() || null,
      siteName: parsed?.siteName?.trim() || null,
      excerpt: parsed?.excerpt?.trim() || null,
      text,
      wordCount: text.split(/\s+/u).filter(Boolean).length,
    };
  } finally {
    dom.window.close();
  }
}
