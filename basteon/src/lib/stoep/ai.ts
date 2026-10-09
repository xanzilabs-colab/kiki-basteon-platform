// Client helper for optional AI fallback. It must never break local flow.
export type KikiAiClueResponse = {
  intent?: "YES" | "NO" | "UNSURE" | "PARTIAL" | "CHOICE" | "DIRECT_ANSWER" | "DESCRIPTOR" | "CHALLENGE" | "CORRECTION" | "META" | "FRUSTRATION" | "DISTRESS";
  extractedFacts?: { descriptors?: string[]; colors?: string[]; setting?: string; directAnswer?: string };
  nextQuestion?: string;
  guess?: string;
  reply?: string;
};

export type KikiInterpretResponse = {
  intent: "YES" | "NO" | "UNSURE" | "PARTIAL" | "CHOICE" | "DIRECT_ANSWER" | "DESCRIPTOR" | "CHALLENGE" | "CORRECTION" | "META" | "FRUSTRATION" | "DISTRESS";
  choice?: string;
  object?: string;
  descriptors?: string[];
  colors?: string[];
  setting?: string | null;
  confidence?: number;
};

export async function askAi<T>(body: Record<string, unknown>, ms = 9000): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch("/api/stoep/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}