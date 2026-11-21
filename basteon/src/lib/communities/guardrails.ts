export type CommunityIntent = "general" | "safety_guidance" | "personal_disclosure" | "third_party_disclosure";
export type CommunityGuardDecision = "allow" | "redact" | "refuse";
export type CommunityRiskCategory = "identity" | "contact" | "address" | "precise_location" | "social" | "link";

export type CommunityGuardResult = {
  decision: CommunityGuardDecision;
  intent: CommunityIntent;
  categories: CommunityRiskCategory[];
  severity: number;
  safeText: string;
  reason: string;
};

export type InteractiveGuardResult = {
  decision: CommunityGuardDecision;
  safeText: string;
  removed: string[];
  reason: string;
};

const PRIVATE_DETAIL = "[private detail removed]";
const HOTLINES = new Set(["112", "911", "999", "10111", "10177"]);
const INTERACTIVE_REDACTIONS = [
  { pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi, placeholder: "[redacted email]", label: "Email address redacted" },
  { pattern: /@\w[\w.-]{1,}/g, placeholder: "[redacted handle]", label: "Social handle redacted" },
  { pattern: /https?:\/\/[^\s<>()]+|www\.[^\s<>()]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|social|app|me|co\.?za)(?:\/[^\s<>()]*)?/gi, placeholder: "[redacted link]", label: "Link redacted" },
  { pattern: /\b\d{13}\b/g, placeholder: "[redacted ID number]", label: "ID number redacted" },
  { pattern: /\b\d{1,5}\s+(?:[\p{L}\d.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|boulevard|blvd|close|crescent|way|court|ct)\b(?:\s*(?:apt|suite|unit|#)\s*[\w-]+)?/giu, placeholder: "[general area]", label: "Exact street address redacted" },
  { pattern: /-?\d{1,2}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, placeholder: "[general area]", label: "Exact location redacted" },
];
const CATEGORY_WEIGHT: Record<CommunityRiskCategory, number> = {
  identity: 2,
  contact: 3,
  address: 5,
  precise_location: 4,
  social: 3,
  link: 1,
};

function classifyIntent(input: string): CommunityIntent {
  if (/\b(?:someone else'?s|their|his|her|my (?:friend|sister|brother|child|coworker|neighbou?r)'?s?)\s+(?:name|address|phone|number|email|location)\b/i.test(input)
    || /\b(?:my friend|my sister|my brother|my child|my coworker|my neighbour|my neighbor)\s+(?:is called|is named|named|called)\b/i.test(input)) {
    return "third_party_disclosure";
  }
  if (/\b(?:my name(?: is|'s)|my (?:street|postal|zip|home)\s+(?:address\s+)?(?:is|:)|my (?:phone|mobile|number|email)(?: number| address)?\s+(?:is|:)|i live (?:at|in)|i am from|i'm from|im from|meet me at|contact me|message me)\b/i.test(input)) {
    return "personal_disclosure";
  }
  if (/\b(?:safety tip|if you need|to stay safe|consider|avoid|emergency services|call|dial|police|ambulance|in general)\b/i.test(input)) {
    return "safety_guidance";
  }
  return "general";
}

function hasMeaningfulRemainder(text: string) {
  const remainder = text.replaceAll(PRIVATE_DETAIL, "").replace(/\s+/g, " ").trim();
  const words = remainder.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return remainder.length >= 28 && words.length >= 5;
}

export function evaluateInteractiveCommunityText(input: string, realName?: string | null): InteractiveGuardResult {
  let safeText = input.normalize("NFKC").replace(/\s+/g, " ").trim();
  const removed = new Set<string>();

  for (const rule of INTERACTIVE_REDACTIONS) {
    let matched = false;
    safeText = safeText.replace(rule.pattern, () => {
      matched = true;
      return rule.placeholder;
    });
    if (matched) removed.add(rule.label);
  }

  let phoneMatched = false;
  safeText = safeText.replace(/(?<![\p{L}\p{N}])\+?\d(?:[\d\s().-]{5,}\d)(?![\p{L}\p{N}])/gu, (match) => {
    const digits = match.replace(/\D/g, "");
    if (HOTLINES.has(digits) || /^\d{4}-\d{2}-\d{2}$/.test(match.trim()) || digits.length < 7 || digits.length > 15) return match;
    phoneMatched = true;
    return "[redacted phone]";
  });
  if (phoneMatched) removed.add("Phone number redacted");

  if (realName?.trim()) {
    const nameTokens = realName.trim().split(/\s+/).filter((token) => token.replace(/[^\p{L}\p{N}]/gu, "").length >= 3);
    for (const token of nameTokens) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const namePattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
      if (namePattern.test(safeText)) {
        namePattern.lastIndex = 0;
        safeText = safeText.replace(namePattern, "[community member]");
        removed.add("Real name cloaked");
      }
    }
  }

  const remainingWords = safeText.replace(/\[[^\]]+\]/g, " ").match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  if (removed.size > 0 && remainingWords.length < 4) {
    return {
      decision: "refuse",
      safeText,
      removed: [...removed],
      reason: "This could identify or locate someone, and Kiki Guard couldn’t remove the details without making the message unsafe or unclear. Edit it and try again.",
    };
  }
  return {
    decision: removed.size > 0 ? "redact" : "allow",
    safeText,
    removed: [...removed],
    reason: removed.size ? "Kiki Guard removed possible private or identifying details." : "",
  };
}

export function evaluateCommunityText(input: string): CommunityGuardResult {
  let safeText = input.normalize("NFKC").replace(/\s+/g, " ").trim();
  let intent = classifyIntent(safeText);
  const categories = new Set<CommunityRiskCategory>();
  const redact = (pattern: RegExp, category: CommunityRiskCategory) => {
    let found = false;
    safeText = safeText.replace(pattern, () => {
      found = true;
      return PRIVATE_DETAIL;
    });
    if (found) categories.add(category);
  };

  redact(/https?:\/\/[^\s<>()]+|www\.[^\s<>()]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|social|app|me|co\.?za)(?:\/[^\s<>()]*)?/gi, "link");
  redact(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi, "contact");
  redact(/@\w[\w.-]{1,}/g, "social");
  redact(/\b(?:instagram|snapchat|tiktok|facebook|telegram|whatsapp|x|twitter)\s*(?:handle|username|account)?\s*(?:is|:)?\s*@?[a-z0-9_.-]{2,}/gi, "social");
  redact(/\b(?:my|our|their|his|her|someone else'?s|my (?:friend|sister|brother|child|coworker|neighbou?r)'?s)\s+(?:home\s+)?address\s*(?:is|:)\s*[^.!?;\n]{2,120}/gi, "address");
  redact(/\b(?:my|our|their|his|her|someone else'?s|my (?:friend|sister|brother|child|coworker|neighbou?r)'?s)\s+(?:postal|post|zip)\s*code\s*(?:is|:)\s*[A-Z0-9][A-Z0-9 -]{2,12}/giu, "address");
  redact(/\b\d{1,5}\s+(?:[\p{L}\d.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|boulevard|blvd|close|crescent|way|court|ct)\b(?:\s*(?:apt|suite|unit|#)\s*[\w-]+)?/giu, "address");
  redact(/-?\d{1,2}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, "precise_location");
  redact(/\b(?:i live (?:at|in)|i am from|i'm from|im from|i am currently at|i'm currently at|meet me at|my (?:home|school|work|study|office)\s+(?:is|at))\s+[^.!?;\n]{2,100}/gi, "precise_location");
  redact(/\b(?:my|our|their|his|her|someone else'?s|my (?:friend|sister|brother|child|coworker|neighbou?r)'?s)\s+names?(?:'s)?\s*(?:(?:is|are|:)\s*)?[\p{L}'-]+(?:\s+(?!(?:and|but|because|so)\b)[\p{L}'-]+){0,2}/giu, "identity");
  redact(/\b(?:[cC]all me|I am|i am|I'm|i'm)\s+[A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*){0,2}\b/gu, "identity");
  redact(/\b(?:my friend|my sister|my brother|my child|my coworker|my neighbour|my neighbor)\s+(?:is called|is named|named|called)\s+[\p{L}'-]+(?:\s+[\p{L}'-]+){0,2}\b/giu, "identity");

  const phonePattern = /\+?\d[\d\s().-]{5,}\d/g;
  let foundPhone = false;
  safeText = safeText.replace(phonePattern, (match) => {
    const digits = match.replace(/\D/g, "");
    if (HOTLINES.has(digits) || /^\d{4}-\d{2}-\d{2}$/.test(match.trim())) return match;
    foundPhone = true;
    return PRIVATE_DETAIL;
  });
  if (foundPhone) categories.add("contact");

  const categoryList = [...categories];
  if (intent === "general" && categoryList.some((category) => category !== "link")) {
    intent = "personal_disclosure";
  }
  if (categoryList.length === 0) {
    return { decision: "allow", intent, categories: [], severity: 0, safeText, reason: "" };
  }

  const severity = Math.min(5, categoryList.reduce((total, category) => total + CATEGORY_WEIGHT[category], 0));
  const tooMuchToRedact = !hasMeaningfulRemainder(safeText);
  const highRiskCombination = severity >= 5 && (categories.has("address") || categories.has("precise_location"))
    && (categories.has("contact") || categories.has("social") || categories.has("identity"));
  const decision: CommunityGuardDecision = tooMuchToRedact || highRiskCombination ? "refuse" : "redact";
  const reason = decision === "refuse"
    ? "This could identify or locate you or someone else. Kiki Guard couldn't remove the risky details without making the message unsafe or unclear. Edit it and try again."
    : "Kiki Guard removed possible identifying, contact, or location details. Review the safe version before sharing.";
  return { decision, intent, categories: categoryList, severity, safeText, reason };
}
