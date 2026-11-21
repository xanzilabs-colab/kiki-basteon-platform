"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell, ChevronLeft, ChevronRight, Footprints, Heart, HeartHandshake, Info,
  LockKeyhole, MapPinned, MessageCircle, RefreshCw, ShieldCheck, ThumbsUp, Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { evaluateInteractiveCommunityText } from "@/lib/communities/guardrails";

type Community = {
  id: string; slug: string; name: string; description: string; scope: string; iconKey: string;
  isSystem: boolean; memberCount?: number; joinedRecently?: number; openToJoin?: boolean;
  isMember: boolean; pseudonym: string | null; welcomeReadAt: string | null; mutedUntil?: string | null;
};
type CommunityView = Pick<Community, "id" | "slug" | "name" | "description" | "scope" | "iconKey" | "isSystem">;
type Option = { id?: string; position?: number; label: string; subLabel?: string | null; count?: number; percent?: number; mine?: boolean; correct?: boolean };
type Media = { id: string; position: number; url: string | null; storagePath?: string; width: number; height: number; caption: string; altText: string };
type FeedComment = {
  id: string; postId?: string; parentId?: string | null; commentKind?: "reply" | "answer" | "question" | "host_answer"; kind?: "reply" | "answer" | "question" | "host_answer";
  stance?: "agree" | "disagree" | null; authorAlias: string; emoji?: string | null; isKiki: boolean; body: string; likeCount?: number; likes?: number; liked?: boolean; createdAt: string; replies?: FeedComment[];
};
type Post = {
  id: string; type: string; categoryGroup: string; authorAlias: string; authorEmoji?: string | null; isKiki: boolean;
  title?: string | null; body: string; config: Record<string, any>; createdAt: string; endsAt?: string | null; closed?: boolean;
  comments?: FeedComment[]; topAnswers?: FeedComment[]; recentReplies?: FeedComment[]; myComment?: FeedComment | null;
  reactions: { support: number; thanks: number; care: number; mine: string[] };
  likes?: { count: number; mine: boolean }; helpful?: { count: number; mine: boolean };
  likeCount?: number; helpfulCount?: number; iLiked?: boolean; iHelpful?: boolean;
  media?: Media[]; options?: Option[]; results?: any; my?: any;
};
type Story = { id: string; title: string; emoji?: string | null; byline: string; body: string; communityId?: string | null; expiresAt?: string };
type Feed = { community: CommunityView & { memberCount?: number }; isMember: boolean; pseudonym?: string; welcomeRequired?: boolean; welcomeBody?: string; posts?: Post[]; stories?: Story[]; nextCursor?: string | null };
type GuardEvent = { id: string; reason: string; action: string; contextType: string; details?: string; createdAt: string };
type GuardPreview = { placeholder?: string; redacted: boolean; refused: boolean; removed: string[] };

const iconFor: Record<string, LucideIcon> = {
  shield: ShieldCheck, "heart-handshake": HeartHandshake, users: Users, footprints: Footprints, "map-pin": MapPinned,
};
const typeMeta: Record<string, { label: string; emoji: string; group: string }> = {
  post: { label: "Post", emoji: "💬", group: "general" },
  carousel: { label: "Carousel", emoji: "🖼️", group: "carousel" },
  poll: { label: "Poll", emoji: "📊", group: "vote" },
  tt: { label: "This/That", emoji: "⚖️", group: "vote" },
  slider: { label: "Slider", emoji: "🎚️", group: "vote" },
  fill: { label: "Fill blank", emoji: "✍️", group: "prompts" },
  cap: { label: "Caption", emoji: "📸", group: "prompts" },
  hot: { label: "Hot take", emoji: "🔥", group: "prompts" },
  quiz: { label: "Quiz", emoji: "🧠", group: "games" },
  mf: { label: "Myth/Fact", emoji: "✅", group: "games" },
  hunt: { label: "Hunt", emoji: "🔍", group: "games" },
  chal: { label: "Challenge", emoji: "🏆", group: "games" },
  ama: { label: "AMA", emoji: "❓", group: "cocreate" },
  decide: { label: "Decide", emoji: "🗳️", group: "cocreate" },
  path: { label: "Path", emoji: "🧭", group: "cocreate" },
};
const groups = [
  { id: "", label: "All" }, { id: "general", label: "Posts" }, { id: "carousel", label: "Carousels" },
  { id: "vote", label: "Votes" }, { id: "prompts", label: "Prompts" }, { id: "games", label: "Games" }, { id: "cocreate", label: "Co-create" },
];
const createTypes = Object.keys(typeMeta);
const iconChoices = [
  { value: "shield", label: "Shield" }, { value: "heart-handshake", label: "Heart" }, { value: "users", label: "Users" },
  { value: "footprints", label: "Footsteps" }, { value: "map-pin", label: "Map pin" },
];

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((payload as any).error ?? "request_failed");
  return payload;
}
function errText(e: unknown) {
  const code = e instanceof Error ? e.message : "unknown";
  if (code === "not_a_member") return "Join this community and acknowledge the space first.";
  if (code === "not_allowed") return "You do not have permission to do that.";
  if (code === "rate_limited") return "Please wait a moment before trying again.";
  if (code === "unsafe_content" || code === "unsafe_comment") return "Kiki Guard could not make that safe to share.";
  if (code === "invalid_post" || code === "invalid_interaction" || code === "invalid_comment") return "Some details are missing or invalid.";
  return "Something went wrong. Please try again.";
}
function fmtTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso); const now = Date.now(); const diff = Math.max(0, now - d.getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
function pct(count: number, total: number) { return total > 0 ? Math.round((count / total) * 100) : 0; }
function uid() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

async function reencodeImage(file: File): Promise<File> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("image_read_failed"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_load_failed"));
    image.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("image_encode_failed")), "image/jpeg", 0.9));
  return new File([blob], `${uid()}.jpg`, { type: "image/jpeg" });
}

type DraftMedia = { file?: File; previewUrl: string; caption: string; altText: string; uploading?: boolean; storagePath?: string; width?: number; height?: number; error?: string; x?: number; y?: number; targetLabel?: string };
type DraftOption = { label: string; subLabel: string; correct?: boolean };
type PathChoice = { text: string; to: string; tip: string };
type PathNode = { id: string; text: string; end: boolean; choices: PathChoice[] };

function emptyDraft(type = "post") {
  return {
    type,
    title: "",
    body: "",
    options: [{ label: "", subLabel: "" }, { label: "", subLabel: "" }] as DraftOption[],
    sliderLo: "Not ready", sliderHi: "Very ready",
    prefix: "Before I head out, I always", suffix: "so I feel prepared.",
    challengeDays: 7,
    huntTargets: [] as { x: number; y: number; label: string }[],
    pathNodes: [
      { id: "start", text: "Your phone is low on battery…", end: false, choices: [{ text: "Send a check-in", to: "end1", tip: "A quick update can help." }, { text: "Save battery", to: "end2", tip: "" }] },
      { id: "end1", text: "You shared a quick check-in.", end: true, choices: [] as PathChoice[] },
      { id: "end2", text: "You conserved battery and stayed aware.", end: true, choices: [] as PathChoice[] },
    ] as PathNode[],
    media: [] as DraftMedia[],
    postId: uid(),
  };
}

function CommunityIcon({ iconKey, className }: { iconKey: string; className?: string }) {
  const Icon = iconFor[iconKey] ?? ShieldCheck;
  return <Icon size={18} aria-hidden className={className} />;
}

export default function CommunitiesHub({ initialSlug = null as string | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<"feed" | "discover" | "guard" | "create">("feed");
  const [communities, setCommunities] = useState<Community[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(initialSlug);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedLoading, setFeedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [group, setGroup] = useState("");
  const [guardHistory, setGuardHistory] = useState<GuardEvent[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraft("post"));
  const [submitting, setSubmitting] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [createDraft, setCreateDraft] = useState({ name: "", description: "", scope: "", iconKey: "shield" });
  const [discoverQuery, setDiscoverQuery] = useState("");

  const joined = useMemo(() => communities.filter((c) => c.isMember), [communities]);
  const activeCommunity = useMemo(() => communities.find((c) => c.slug === activeSlug) ?? joined[0] ?? communities[0] ?? null, [communities, joined, activeSlug]);
  const discoverList = useMemo(() => {
    const q = discoverQuery.trim().toLowerCase();
    return communities.filter((c) => !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
  }, [communities, discoverQuery]);

  useEffect(() => { if (initialSlug) setActiveSlug(initialSlug); }, [initialSlug]);

  const loadCommunities = useCallback(async () => {
    const data = await json<{ communities: Community[] }>("/api/communities");
    setCommunities(data.communities ?? []);
    return data.communities ?? [];
  }, []);

  const loadFeed = useCallback(async (slug: string, nextGroup = group) => {
    setFeedLoading(true);
    try {
      const qs = nextGroup ? `?group=${encodeURIComponent(nextGroup)}` : "";
      const data = await json<Feed>(`/api/communities/${slug}/feed${qs}`);
      setFeed(data);
      if (data.pseudonym) setCommunities((prev) => prev.map((c) => c.slug === slug ? { ...c, pseudonym: data.pseudonym ?? c.pseudonym } : c));
    } finally { setFeedLoading(false); }
  }, [group]);

  const loadGuard = useCallback(async () => {
    try {
      const data = await json<{ history: GuardEvent[] }>("/api/communities/guard");
      setGuardHistory(data.history ?? []);
    } catch { /* best effort */ }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const list = await loadCommunities();
        const chosen = (initialSlug && list.find((c) => c.slug === initialSlug)?.slug) || list.find((c) => c.isMember)?.slug || list[0]?.slug || null;
        if (chosen) { setActiveSlug(chosen); await loadFeed(chosen, ""); }
        await loadGuard();
      } catch (e) { setError(errText(e)); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAll() {
    setError(null);
    try {
      const list = await loadCommunities();
      const slug = activeSlug ?? list.find((c) => c.isMember)?.slug ?? list[0]?.slug ?? null;
      if (slug) await loadFeed(slug, group);
      await loadGuard();
      setNotice("Community feed refreshed.");
    } catch (e) { setError(errText(e)); }
  }

  async function openCommunity(slug: string) {
    setActiveSlug(slug); setGroup(""); setError(null);
    router.replace(`/account/communities/${slug}`);
    try { await loadFeed(slug, ""); } catch (e) { setError(errText(e)); }
  }

  async function joinCommunity(slug: string, id: string) {
    setError(null);
    try {
      const data = await json<{ joined: boolean; pseudonym: string }>(`/api/communities/${id}/join`, { method: "POST" });
      setCommunities((prev) => prev.map((c) => c.id === id ? { ...c, isMember: true, pseudonym: data.pseudonym } : c));
      await openCommunity(slug);
      setNotice("You joined with an anonymous alias.");
    } catch (e) { setError(errText(e)); }
  }

  async function acknowledgeWelcome() {
    if (!activeCommunity) return;
    setError(null);
    try {
      await json(`/api/communities/${activeCommunity.id}/welcome`, { method: "POST" });
      setCommunities((prev) => prev.map((c) => c.id === activeCommunity.id ? { ...c, welcomeReadAt: new Date().toISOString() } : c));
      await loadFeed(activeCommunity.slug, group);
    } catch (e) { setError(errText(e)); }
  }

  function updateDraft(patch: Partial<ReturnType<typeof emptyDraft>>) { setDraft((d) => ({ ...d, ...patch })); }

  const liveGuard = useMemo(() => {
    if (!composerOpen) return null;
    const texts: string[] = [draft.title, draft.body, draft.prefix, draft.suffix, draft.sliderLo, draft.sliderHi];
    for (const o of draft.options) { texts.push(o.label, o.subLabel); }
    for (const m of draft.media) { texts.push(m.caption, m.altText); }
    if (draft.type === "hunt") for (const t of (draft.huntTargets ?? [])) texts.push(t.label);
    if (draft.type === "path") for (const n of draft.pathNodes) { texts.push(n.text); for (const c of n.choices) texts.push(c.text, c.tip, c.to); }
    if (draft.type === "hot") { texts.push("Agree", "Disagree"); }
    if (draft.type === "mf") { texts.push("Myth", "Fact"); }
    const removed = new Set<string>();
    let redacted = false;
    let refused = false;
    for (const value of texts.filter((t): t is string => Boolean(t && String(t).trim()))) {
      const result = evaluateInteractiveCommunityText(value);
      for (const item of result.removed ?? []) removed.add(item);
      if (result.decision === "redact") redacted = true;
      if (result.decision === "refuse") refused = true;
    }
    return { redacted, refused, removed: [...removed] } as GuardPreview;
  }, [composerOpen, draft]);

  async function onSelectImages(files: FileList | null) {
    if (!files?.length) return;
    const max = 10 - draft.media.length;
    const chosen = Array.from(files).slice(0, Math.max(0, max));
    const accepted: DraftMedia[] = [];
    for (const file of chosen) {
      try {
        if (!/image\/(jpeg|png|webp|avif)/i.test(file.type) && !/\.(jpe?g|png|webp|avif)$/i.test(file.name)) throw new Error("bad_type");
        const processed = await reencodeImage(file);
        const previewUrl = URL.createObjectURL(processed);
        accepted.push({ file: processed, previewUrl, caption: "", altText: "", width: 0, height: 0 });
      } catch {
        setError("Some images could not be processed. Use JPEG, PNG, WebP, or AVIF images.");
      }
    }
    updateDraft({ media: [...draft.media, ...accepted] });
  }
  function updateMedia(index: number, patch: Partial<DraftMedia>) { updateDraft({ media: draft.media.map((m, i) => i === index ? { ...m, ...patch } : m) }); }
  function removeMedia(index: number) {
    const item = draft.media[index];
    if (item?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    updateDraft({ media: draft.media.filter((_, i) => i !== index) });
  }
  function moveMedia(index: number, dir: -1 | 1) {
    const next = [...draft.media];
    const j = index + dir; if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    updateDraft({ media: next });
  }

  function buildPayload(uploadedMedia?: DraftMedia[]) {
    const source = uploadedMedia ?? draft.media;
    const media = source.filter((m) => m.storagePath).map((m) => ({ storagePath: m.storagePath, width: m.width || 1, height: m.height || 1, caption: m.caption || "", altText: m.altText || "" }));
    const base: any = {
      id: draft.postId,
      communityId: activeCommunity?.id,
      type: draft.type,
      title: draft.title.trim() || undefined,
      body: draft.body.trim(),
      media,
      config: {},
    };
    if (["poll", "decide"].includes(draft.type)) base.options = draft.options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), subLabel: o.subLabel.trim() || undefined }));
    if (draft.type === "tt") base.options = draft.options.slice(0, 2).map((o) => ({ label: o.label.trim(), subLabel: o.subLabel.trim() || undefined }));
    if (draft.type === "quiz") base.options = draft.options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), correct: Boolean(o.correct) }));
    if (draft.type === "slider") base.config = { lo: draft.sliderLo, hi: draft.sliderHi };
    if (draft.type === "fill") base.config = { prefix: draft.prefix, suffix: draft.suffix };
    if (draft.type === "chal") base.config = { days: Math.max(1, Math.min(30, Number(draft.challengeDays) || 7)) };
    if (draft.type === "hunt") base.config = { targets: (draft.huntTargets ?? []).map((t, i) => ({ x: Number(t.x), y: Number(t.y), label: (t.label || `Spot ${i + 1}`).trim() })) };
    if (draft.type === "path") base.config = { nodes: draft.pathNodes.map((n) => n.end ? { id: n.id, t: n.text, end: true } : { id: n.id, t: n.text, ch: n.choices.filter((c) => c.to).map((c) => ({ t: c.text, to: c.to, ...(c.tip ? { tip: c.tip } : {}) })) }) };
    if (draft.type === "hot" || draft.type === "mf") delete base.options;
    return base;
  }

  async function publishPost() {
    if (!activeCommunity) return;
    setSubmitting(true); setError(null); setNotice(null);
    try {
      const media = [...draft.media];
      for (let i = 0; i < media.length; i += 3) {
        const batch = media.slice(i, i + 3);
        const uploaded = await Promise.all(batch.map(async (m) => {
          if (m.storagePath || !m.file) return m;
          const fd = new FormData();
          fd.append("communityId", activeCommunity.id);
          fd.append("postId", draft.postId);
          fd.append("image", m.file);
          const res = await fetch("/api/communities/media", { method: "POST", body: fd });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(payload.error || "media_upload_failed");
          return { ...m, storagePath: payload.storagePath as string, width: payload.width as number, height: payload.height as number, uploading: false };
        }));
        for (let j = 0; j < uploaded.length; j++) media[i + j] = uploaded[j]!;
        updateDraft({ media: [...media] });
      }
      const payload = buildPayload(media);
      await json("/api/communities/interactive-posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      for (const m of draft.media) if (m.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(m.previewUrl);
      setDraft(emptyDraft(draft.type));
      setComposerOpen(false);
      await loadFeed(activeCommunity.slug, group);
      await loadGuard();
      setNotice("Your post was shared safely.");
    } catch (e) { setError(errText(e)); }
    finally { setSubmitting(false); }
  }

  async function actOnPost(postId: string, body: any, optimistic?: (post: Post) => Post) {
    if (!activeCommunity || !feed?.posts) return;
    const prev = feed.posts;
    if (optimistic) setFeed({ ...feed, posts: prev.map((p) => p.id === postId ? optimistic(p) : p) });
    try {
      const result = await json<any>("/api/communities/interactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, ...body }) });
      if (result?.post) setFeed((f) => f ? { ...f, posts: (f.posts ?? []).map((p) => p.id === postId ? result.post : p) } : f);
      else await loadFeed(activeCommunity.slug, group);
    } catch (e) {
      setFeed((f) => f ? { ...f, posts: prev } : f);
      setError(errText(e));
    }
  }

  async function toggleLike(postId: string, reaction: "like" | "helpful") {
    if (!activeCommunity || !feed?.posts) return;
    const prev = feed.posts;
    setFeed({ ...feed, posts: prev.map((p) => {
      if (p.id !== postId) return p;
      if (reaction === "like") { const mine = !p.likes?.mine; return { ...p, likes: { count: Math.max(0, (p.likes?.count ?? 0) + (mine ? 1 : -1)), mine } }; }
      const mine = !p.helpful?.mine; return { ...p, helpful: { count: Math.max(0, (p.helpful?.count ?? 0) + (mine ? 1 : -1)), mine } };
    }) });
    try {
      const res = await json<{ active: boolean; count?: number }>("/api/communities/reactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, reaction }) });
      setFeed((f) => f ? { ...f, posts: (f.posts ?? []).map((p) => {
        if (p.id !== postId) return p;
        if (reaction === "like") return { ...p, likes: { count: res.count ?? p.likes?.count ?? 0, mine: res.active } };
        return { ...p, helpful: { count: res.count ?? p.helpful?.count ?? 0, mine: res.active } };
      }) } : f);
    } catch (e) { setFeed((f) => f ? { ...f, posts: prev } : f); setError(errText(e)); }
  }

  async function submitComment(postId: string, body: string, opts?: { commentKind?: string; stance?: string; parentId?: string }) {
    if (!activeCommunity) return;
    setError(null);
    try {
      await json("/api/communities/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, body, commentKind: opts?.commentKind ?? "reply", stance: opts?.stance, parentId: opts?.parentId }) });
      await loadFeed(activeCommunity.slug, group);
      await loadGuard();
      setNotice("Shared safely.");
    } catch (e) { setError(errText(e)); }
  }

  async function createCommunity() {
    setError(null);
    try {
      const nameGuard = evaluateInteractiveCommunityText(createDraft.name);
      const descriptionGuard = evaluateInteractiveCommunityText(createDraft.description);
      const scopeGuard = evaluateInteractiveCommunityText(createDraft.scope);
      if ([nameGuard, descriptionGuard, scopeGuard].some((g) => g.decision === "refuse")) throw new Error("unsafe_content");
      const result = await json<{ id: string; slug: string }>("/api/communities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createDraft,
          name: nameGuard.safeText,
          description: descriptionGuard.safeText,
          scope: scopeGuard.safeText,
        }),
      });
      setCreateDraft({ name: "", description: "", scope: "", iconKey: "shield" });
      await loadCommunities();
      await openCommunity(result.slug);
      setTab("feed");
      setNotice("Community created.");
    } catch (e) { setError(errText(e)); }
  }

  const headerAlias = feed?.pseudonym ?? activeCommunity?.pseudonym ?? "Your alias";

  return (
    <section className="kiki-communities-page" aria-label="Communities">
      {showPrivacy && (
        <div className="kiki-communities-alert" role="dialog" aria-label="Privacy">
          <p><strong>Your identity is protected.</strong> Communities use per-community aliases and Kiki Guard to remove identifying details before anything is shared.</p>
          {activeCommunity ? <p style={{ marginTop: 8 }}>You appear as <strong>{headerAlias}</strong> in this community.</p> : null}
          <button type="button" onClick={() => setShowPrivacy(false)}>Close</button>
        </div>
      )}

      <nav className="kiki-communities-tabs" aria-label="Community tabs">
        {(["feed", "discover", "guard", "create"] as const).map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t === "feed" ? "Feed" : t === "discover" ? "Discover" : t === "guard" ? "Kiki Guard" : "Create"}</button>
        ))}
      </nav>

      {error ? <p className="kiki-communities-alert" role="alert">{error}</p> : null}
      {notice ? <p className="kiki-communities-notice">{notice}</p> : null}
      {loading ? <p className="kiki-communities-loading">Loading communities…</p> : null}

      {tab === "feed" && (
        <>
          <div className="kiki-communities-switcher" role="tablist" aria-label="Joined communities">
            {joined.map((c) => (
              <button key={c.id} type="button" aria-pressed={c.slug === activeCommunity?.slug} onClick={() => void openCommunity(c.slug)}>
                <CommunityIcon iconKey={c.iconKey} /> {c.name}
              </button>
            ))}
          </div>

          {(feed?.stories ?? []).length ? (
            <div aria-label="Stories" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
              {(feed?.stories ?? []).map((s) => (
                <button key={s.id} type="button" onClick={() => setActiveStory(s)} style={{ minWidth: 92, border: "1px solid var(--divider)", borderRadius: 14, padding: 10, background: "var(--surface-1)", textAlign: "left" }}>
                  <div style={{ fontSize: 20 }}>{s.emoji ?? "✨"}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>{s.title}</div>
                </button>
              ))}
            </div>
          ) : null}

          {activeStory && (
            <div className="kiki-community-scope-card" role="dialog" aria-label="Story">
              <h2>{activeStory.emoji} {activeStory.title}</h2>
              <p className="kiki-community-scope-note"><strong>{activeStory.byline}</strong></p>
              <p>{activeStory.body}</p>
              <button type="button" onClick={() => setActiveStory(null)}>Close</button>
            </div>
          )}

          {activeCommunity && feed ? (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  aria-label="Community info"
                  onClick={() => setShowPrivacy((v) => !v)}
                  className="kiki-community-icon-btn"
                  title="Community info"
                  style={{ minHeight: 34, minWidth: 34, borderRadius: 10, border: "1px solid var(--divider)", background: "var(--surface-1)", padding: 0, display: "inline-grid", placeItems: "center", color: "var(--text-2)" }}
                >
                  <Info size={15} />
                </button>
              </div>

              {feed.welcomeRequired ? (
                <section className="kiki-community-scope-card kiki-community-welcome">
                  <h2>Welcome to {feed.community.name}</h2>
                  <p>{feed.welcomeBody ?? "Please read the community space before participating."}</p>
                  <button type="button" onClick={() => void acknowledgeWelcome()}>I understand, continue</button>
                </section>
              ) : (
                <>
                  <div style={{ display: "grid", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => { setDraft(emptyDraft("post")); setComposerOpen(true); }}
                      style={{ width: "100%", minHeight: 44, borderRadius: 14, border: "1px solid var(--divider)", background: "var(--surface-1)", color: "var(--muted)", textAlign: "left", padding: "10px 14px", font: "inherit", lineHeight: 1.4, whiteSpace: "normal", overflowWrap: "anywhere" }}
                    >
                      Share something helpful…
                    </button>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {createTypes.filter((t) => t !== "post").slice(0, 6).map((t) => (
                        <button key={t} type="button" title={typeMeta[t].label} onClick={() => { setDraft(emptyDraft(t)); setComposerOpen(true); }} style={{ minWidth: 40, minHeight: 40, borderRadius: 12, border: "1px solid var(--divider)", background: "var(--surface-1)", flex: "0 0 auto" }}>{typeMeta[t].emoji}</button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                    {groups.map((g) => (
                      <button key={g.id || "all"} type="button" aria-pressed={group === g.id} onClick={() => { setGroup(g.id); if (activeCommunity) void loadFeed(activeCommunity.slug, g.id); }} style={{ border: "1px solid var(--divider)", borderRadius: 999, padding: "6px 10px", background: group === g.id ? "var(--accent-bg)" : "var(--surface-1)", color: group === g.id ? "var(--accent)" : "var(--text-2)", fontSize: 12, fontWeight: 700 }}>{g.label}</button>
                    ))}
                  </div>

                  {composerOpen && (
                    <Composer
                      draft={draft}
                      setDraft={updateDraft}
                      onSelectImages={onSelectImages}
                      updateMedia={updateMedia}
                      removeMedia={removeMedia}
                      moveMedia={moveMedia}
                      liveGuard={liveGuard}
                      submitting={submitting}
                      onClose={() => setComposerOpen(false)}
                      onPublish={() => void publishPost()}
                    />
                  )}

                  {feedLoading ? <p className="kiki-communities-loading">Loading feed…</p> : null}
                  <div className="kiki-community-post-list">
                    {(feed.posts ?? []).map((post) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        onVote={(optionId) => void actOnPost(post.id, { action: "vote", optionId })}
                        onRate={(value) => void actOnPost(post.id, { action: "rate", value })}
                        onChallenge={(mode) => void actOnPost(post.id, { action: "challenge", mode })}
                        onHunt={(x, y) => void actOnPost(post.id, { action: "hunt", x, y })}
                        onPath={(endNode) => void actOnPost(post.id, { action: "path_finish", endNode })}
                        onHelpful={() => void toggleLike(post.id, "helpful")}
                        onComment={submitComment}
                        onCommentLike={(commentId) => void actOnPost(post.id, { action: "comment_like", commentId })}
                      />
                    ))}
                    {!feedLoading && !(feed.posts ?? []).length ? <p className="kiki-communities-intro">No posts in this view yet.</p> : null}
                  </div>
                </>
              )}
            </>
          ) : (!loading ? <p className="kiki-communities-intro">Join a community to see its feed.</p> : null)}
        </>
      )}

      {tab === "discover" && (
        <section className="kiki-communities-list" aria-label="Discover communities">
          <label className="kiki-community-composer" style={{ gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>Search communities</span>
            <input value={discoverQuery} onChange={(e) => setDiscoverQuery(e.target.value)} placeholder="Search by name or description" style={{ minHeight: 44, border: "1px solid var(--divider)", borderRadius: 12, padding: "0 12px", background: "var(--surface-2)", color: "var(--text)" }} />
          </label>
          {discoverList.map((c) => (
            <article key={c.id} className="kiki-community-discovery-card">
              <span className="kiki-community-card-icon"><CommunityIcon iconKey={c.iconKey} /></span>
              <div className="kiki-community-discovery-copy">
                <h2>{c.name} {c.isSystem ? <span className="kiki-community-system-badge">Kiki</span> : null}</h2>
                <p>{c.description}</p>
                <small>{c.scope} · {c.memberCount ?? 0} members{c.joinedRecently ? ` · ${c.joinedRecently} joined recently` : ""}</small>
              </div>
              {c.isMember ? <button type="button" onClick={() => { setTab("feed"); void openCommunity(c.slug); }}>Open</button> : <button type="button" onClick={() => void joinCommunity(c.slug, c.id)}>Join</button>}
            </article>
          ))}
        </section>
      )}

      {tab === "guard" && (
        <section className="kiki-community-guard-page">
          <div className="kiki-community-guard-hero"><span><ShieldCheck size={18} /></span><div><h2>Kiki Guard</h2><p>Content is checked before it is shared. Identifying details are removed or blocked to keep communities safer.</p></div></div>
          <div className="kiki-community-guard-rules"><h3>What Guard looks for</h3><ul><li>Personal names and identifying handles</li><li>Phone numbers, emails, links, IDs, and addresses</li><li>Precise locations or details that could identify someone</li></ul></div>
          <h3 className="kiki-community-history-title">Recent checks</h3>
          <div className="kiki-communities-list">
            {guardHistory.map((item) => (
              <article key={item.id} className="kiki-community-guard-event"><ShieldCheck size={16} /><div><strong>{item.reason || item.action}</strong><p>{item.contextType} · {fmtTime(item.createdAt)}{item.details ? ` · ${item.details}` : ""}</p></div></article>
            ))}
            {!guardHistory.length ? <p className="kiki-communities-intro">No recent guard events.</p> : null}
          </div>
        </section>
      )}

      {tab === "create" && (
        <section className="kiki-community-create-form">
          <h2>Create a community</h2>
          <label>Community name<input value={createDraft.name} onChange={(e) => setCreateDraft({ ...createDraft, name: e.target.value })} maxLength={80} /></label>
          <label>Description<textarea value={createDraft.description} onChange={(e) => setCreateDraft({ ...createDraft, description: e.target.value })} maxLength={200} /></label>
          <label>Community space / scope<textarea value={createDraft.scope} onChange={(e) => setCreateDraft({ ...createDraft, scope: e.target.value })} maxLength={220} placeholder="Who this space is for and what should stay out." /></label>
          <label>Icon
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {iconChoices.map((icon) => (
                <button key={icon.value} type="button" aria-pressed={createDraft.iconKey === icon.value} onClick={() => setCreateDraft({ ...createDraft, iconKey: icon.value })} style={{ border: "1px solid var(--divider)", borderRadius: 12, padding: "8px 10px", background: createDraft.iconKey === icon.value ? "var(--accent-bg)" : "var(--surface-1)", color: "var(--text)" }}>
                  <CommunityIcon iconKey={icon.value} /> {icon.label}
                </button>
              ))}
            </div>
          </label>
          <button type="button" onClick={() => void createCommunity()} disabled={!createDraft.name.trim() || !createDraft.description.trim() || !createDraft.scope.trim()}>Run Kiki Guard & Create</button>
        </section>
      )}
    </section>
  );
}

function GuardPill({ preview }: { preview: GuardPreview | null }) {
  if (!preview) return null;
  if (preview.refused) return <p className="kiki-communities-alert" role="alert">Kiki Guard cannot make this safe to share. Please remove identifying details.</p>;
  if (preview.redacted || (preview.removed?.length ?? 0) > 0) return <p className="kiki-communities-notice">Will remove or generalize: {(preview.removed ?? []).join(", ") || "identifying details"}.</p>;
  return <p className="kiki-communities-notice">Looks good. Nothing risky found.</p>;
}

function Composer(props: {
  draft: ReturnType<typeof emptyDraft>;
  setDraft: (patch: Partial<ReturnType<typeof emptyDraft>>) => void;
  onSelectImages: (files: FileList | null) => void;
  updateMedia: (index: number, patch: Partial<DraftMedia>) => void;
  removeMedia: (index: number) => void;
  moveMedia: (index: number, dir: -1 | 1) => void;
  liveGuard: GuardPreview | null;
  submitting: boolean;
  onClose: () => void;
  onPublish: () => void;
}) {
  const { draft, setDraft, onSelectImages, updateMedia, removeMedia, moveMedia, liveGuard, submitting, onClose, onPublish } = props;
  const mediaAccept = "image/jpeg,image/png,image/webp,image/avif";
  const needsImage = draft.type === "carousel" || draft.type === "cap" || draft.type === "hunt";
  const hasRequiredOptions = !["poll", "decide", "tt", "quiz"].includes(draft.type) || (draft.type === "tt" ? draft.options.slice(0, 2).every((o) => o.label.trim()) : draft.options.filter((o) => o.label.trim()).length >= 2);
  const quizHasCorrect = draft.type !== "quiz" || draft.options.some((o) => o.correct && o.label.trim());
  const huntOk = draft.type !== "hunt" || ((draft.huntTargets?.length ?? 0) >= 1 && draft.media.length >= 1);
  const canPublish = !submitting && !liveGuard?.refused && hasRequiredOptions && quizHasCorrect && huntOk && (draft.type === "slider" || draft.type === "chal" || draft.type === "path" || draft.body.trim() || draft.title.trim() || draft.media.length) && (!needsImage || draft.media.length > 0);

  function setOption(i: number, patch: Partial<DraftOption>) { setDraft({ options: draft.options.map((o, idx) => idx === i ? { ...o, ...patch } : o) }); }
  function addOption() { if (draft.options.length < 4) setDraft({ options: [...draft.options, { label: "", subLabel: "" }] }); }
  function removeOption(i: number) { if (draft.options.length > 2) setDraft({ options: draft.options.filter((_, idx) => idx !== i) }); }

  return (
    <section className="kiki-community-composer" aria-label="Create post" style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", overflowX: "hidden", overflowY: "auto", maxHeight: "calc(100dvh - 180px)", WebkitOverflowScrolling: "touch" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Create a post</h3>
        <button type="button" onClick={onClose} aria-label="Close composer" style={{ background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--divider)", borderRadius: 10, minHeight: 36, padding: "0 12px" }}>Close</button>
      </div>
      <label>Post type
        <select value={draft.type} onChange={(e) => setDraft({ ...emptyDraft(e.target.value), postId: draft.postId })} style={{ width: "100%", minHeight: 42, borderRadius: 10, border: "1px solid var(--divider)", padding: "0 10px", background: "var(--surface-2)", color: "var(--text)", boxSizing: "border-box" }}>
          {createTypes.map((t) => <option key={t} value={t}>{typeMeta[t].emoji} {typeMeta[t].label}</option>)}
        </select>
      </label>
      {draft.type !== "post" && <label>Title<input value={draft.title} onChange={(e) => setDraft({ title: e.target.value })} placeholder="Optional title" /></label>}
      <label>{draft.type === "post" ? "Post" : "Prompt / body"}
        <textarea value={draft.body} onChange={(e) => setDraft({ body: e.target.value })} placeholder={draft.type === "post" ? "Share something helpful with the community…" : "Add context for this interactive post…"} />
      </label>

      {["poll", "decide", "tt", "quiz"].includes(draft.type) && (
        <div style={{ display: "grid", gap: 8 }}>
          <strong>Options</strong>
          {draft.options.map((opt, i) => (
            <div key={i} style={{ display: "grid", gap: 6, border: "1px solid var(--divider)", borderRadius: 12, padding: 10, minWidth: 0 }}>
              <input value={opt.label} onChange={(e) => setOption(i, { label: e.target.value })} placeholder={`Option ${i + 1}`} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", minHeight: 40, borderRadius: 10, border: "1px solid var(--divider)", padding: "0 10px", background: "var(--surface-2)" }} />
              {draft.type !== "quiz" && <input value={opt.subLabel} onChange={(e) => setOption(i, { subLabel: e.target.value })} placeholder="Sub-label (optional)" style={{ width: "100%", minWidth: 0, boxSizing: "border-box", minHeight: 36, borderRadius: 10, border: "1px solid var(--divider)", padding: "0 10px", background: "var(--surface-2)" }} />}
              {draft.type === "quiz" && <label style={{ fontSize: 12, fontWeight: 600 }}><input type="radio" name="correct" checked={Boolean(opt.correct)} onChange={() => setDraft({ options: draft.options.map((o, idx) => ({ ...o, correct: idx === i })) })} /> Correct answer</label>}
              {draft.options.length > 2 && draft.type !== "tt" && <button type="button" onClick={() => removeOption(i)} style={{ width: "fit-content" }}>Remove</button>}
            </div>
          ))}
          {draft.type !== "tt" && draft.options.length < 4 && <button type="button" onClick={addOption} style={{ width: "fit-content" }}>Add option</button>}
        </div>
      )}

      {draft.type === "slider" && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <label>Low label<input value={draft.sliderLo} onChange={(e) => setDraft({ sliderLo: e.target.value })} style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} /></label>
          <label>High label<input value={draft.sliderHi} onChange={(e) => setDraft({ sliderHi: e.target.value })} style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} /></label>
        </div>
      )}
      {draft.type === "fill" && (
        <div style={{ display: "grid", gap: 8 }}>
          <label>Prefix<input value={draft.prefix} onChange={(e) => setDraft({ prefix: e.target.value })} style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} /></label>
          <label>Suffix<input value={draft.suffix} onChange={(e) => setDraft({ suffix: e.target.value })} style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} /></label>
        </div>
      )}
      {draft.type === "chal" && <label>Days<input type="number" min={1} max={30} value={draft.challengeDays} onChange={(e) => setDraft({ challengeDays: Number(e.target.value) })} style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} /></label>}
      {draft.type === "path" && <PathEditor draft={draft} setDraft={setDraft} />}
      {draft.type === "hot" && <p className="kiki-community-scope-note">This post will include Agree/Disagree voting and answer replies with stance.</p>}
      {draft.type === "mf" && <p className="kiki-community-scope-note">This post will include Myth/Fact options and a reveal after answering.</p>}

      <div style={{ display: "grid", gap: 8 }}>
        <label>Images (JPEG/PNG/WebP/AVIF, images only){needsImage ? " — required" : " — optional"}
          <input type="file" accept={mediaAccept} multiple={draft.type !== "cap" && draft.type !== "hunt"} onChange={(e) => onSelectImages(e.target.files)} style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }} />
        </label>
        {draft.media.map((m, i) => (
          <div key={i} style={{ border: "1px solid var(--divider)", borderRadius: 12, padding: 10, display: "grid", gap: 8 }}>
            <img src={m.previewUrl} alt={m.altText || "Selected image preview"} style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 10 }} />
            <input value={m.caption} onChange={(e) => updateMedia(i, { caption: e.target.value })} placeholder="Caption (optional)" style={{ width: "100%", minWidth: 0, boxSizing: "border-box", minHeight: 40, borderRadius: 10, border: "1px solid var(--divider)", padding: "0 10px", background: "var(--surface-2)" }} />
            <input value={m.altText} onChange={(e) => updateMedia(i, { altText: e.target.value })} placeholder="Alt text (optional)" style={{ width: "100%", minWidth: 0, boxSizing: "border-box", minHeight: 40, borderRadius: 10, border: "1px solid var(--divider)", padding: "0 10px", background: "var(--surface-2)" }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => moveMedia(i, -1)} disabled={i === 0}>Up</button>
              <button type="button" onClick={() => moveMedia(i, 1)} disabled={i === draft.media.length - 1}>Down</button>
              <button type="button" onClick={() => removeMedia(i)}>Remove</button>
            </div>
          </div>
        ))}
        {draft.type === "hunt" && draft.media[0] && (
          <div style={{ border: "1px solid var(--divider)", borderRadius: 12, padding: 10, display: "grid", gap: 8 }}>
            <strong>Hunt targets</strong>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Tap the image to place targets (1–5). Labels are optional.</p>
            <div style={{ position: "relative" }}>
              <img src={draft.media[0].previewUrl} alt="Place targets" onClick={(e) => {
                if ((draft.huntTargets?.length ?? 0) >= 5) return;
                const rect = (e.currentTarget as HTMLImageElement).getBoundingClientRect();
                const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
                setDraft({ huntTargets: [...(draft.huntTargets ?? []), { x, y, label: `Spot ${(draft.huntTargets?.length ?? 0) + 1}` }] });
              }} style={{ width: "100%", borderRadius: 10, cursor: "crosshair", display: "block" }} />
              {(draft.huntTargets ?? []).map((t, i) => (
                <span key={i} style={{ position: "absolute", left: `${t.x}%`, top: `${t.y}%`, transform: "translate(-50%,-50%)", width: 22, height: 22, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
              ))}
            </div>
            {(draft.huntTargets ?? []).map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>#{i + 1}</span>
                <input value={t.label} onChange={(e) => setDraft({ huntTargets: (draft.huntTargets ?? []).map((x, xi) => xi === i ? { ...x, label: e.target.value } : x) })} placeholder="Target label" style={{ flex: "1 1 140px", minWidth: 0, boxSizing: "border-box", minHeight: 38, borderRadius: 10, border: "1px solid var(--divider)", padding: "0 10px", background: "var(--surface-2)" }} />
                <button type="button" onClick={() => setDraft({ huntTargets: (draft.huntTargets ?? []).filter((_, xi) => xi !== i) })}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <GuardPill preview={liveGuard} />
      <div className="kiki-community-composer-footer">
        <small style={{ minWidth: 0, overflowWrap: "anywhere" }}>Images are re-encoded to JPEG before upload. Kiki Guard checks text before publishing.</small>
        <button type="button" onClick={onPublish} disabled={!canPublish} style={{ maxWidth: "100%", whiteSpace: "normal" }}>{submitting ? "Publishing…" : "Run Kiki Guard & Publish"}</button>
      </div>
    </section>
  );
}

function PathEditor({ draft, setDraft }: { draft: ReturnType<typeof emptyDraft>; setDraft: (patch: Partial<ReturnType<typeof emptyDraft>>) => void }) {
  function updateNode(index: number, patch: Partial<PathNode>) {
    const nodes = draft.pathNodes.map((n, i) => i === index ? { ...n, ...patch } : n);
    setDraft({ pathNodes: nodes });
  }
  function addNode() {
    if (draft.pathNodes.length >= 7) return;
    setDraft({ pathNodes: [...draft.pathNodes, { id: `node${draft.pathNodes.length + 1}`, text: "New step", end: true, choices: [] }] });
  }
  function addChoice(nodeIndex: number) {
    const node = draft.pathNodes[nodeIndex];
    if (!node || node.choices.length >= 3) return;
    updateNode(nodeIndex, { end: false, choices: [...node.choices, { text: "Choice", to: "", tip: "" }] });
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <strong>Path nodes</strong>
      {draft.pathNodes.map((node, i) => (
        <div key={i} style={{ border: "1px solid var(--divider)", borderRadius: 12, padding: 10, display: "grid", gap: 6 }}>
          <input value={node.id} onChange={(e) => updateNode(i, { id: e.target.value })} placeholder="Node id (e.g. start)" style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} />
          <textarea value={node.text} onChange={(e) => updateNode(i, { text: e.target.value })} placeholder="Node text" style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} />
          <label style={{ fontSize: 12 }}><input type="checkbox" checked={node.end} onChange={(e) => updateNode(i, { end: e.target.checked, choices: e.target.checked ? [] : node.choices })} /> End node</label>
          {!node.end && node.choices.map((c, ci) => (
            <div key={ci} style={{ display: "grid", gap: 4, paddingLeft: 8 }}>
              <input value={c.text} onChange={(e) => updateNode(i, { choices: node.choices.map((x, xi) => xi === ci ? { ...x, text: e.target.value } : x) })} placeholder="Choice text" style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} />
              <input value={c.to} onChange={(e) => updateNode(i, { choices: node.choices.map((x, xi) => xi === ci ? { ...x, to: e.target.value } : x) })} placeholder="Go to node id" style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} />
              <input value={c.tip} onChange={(e) => updateNode(i, { choices: node.choices.map((x, xi) => xi === ci ? { ...x, tip: e.target.value } : x) })} placeholder="Tip (optional)" style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} />
            </div>
          ))}
          {!node.end && node.choices.length < 3 && <button type="button" onClick={() => addChoice(i)}>Add choice</button>}
        </div>
      ))}
      {draft.pathNodes.length < 7 && <button type="button" onClick={addNode}>Add node</button>}
      <small>Set the first node id to <code>start</code>. End nodes should have no choices.</small>
    </div>
  );
}

function PostCard(props: {
  post: Post;
  onVote: (optionId: string) => void;
  onRate: (value: number) => void;
  onChallenge: (mode: "join" | "leave" | "checkin") => void;
  onHunt: (x: number, y: number) => void;
  onPath: (endNode: number) => void;
  onHelpful: () => void;
  onComment: (postId: string, body: string, opts?: { commentKind?: string; stance?: string; parentId?: string }) => Promise<void> | void;
  onCommentLike: (commentId: string) => void;
}) {
  const { post, onVote, onRate, onChallenge, onHunt, onPath, onHelpful, onComment, onCommentLike } = props;
  const [reply, setReply] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [sliderValue, setSliderValue] = useState(Number(post.my?.rating ?? post.my?.value ?? 50));
  const meta = typeMeta[post.type] ?? { label: post.type, emoji: "💬", group: "general" };
  const comments = post.comments ?? [];
  const replyKind = post.type === "cap" || post.type === "fill" ? "answer" : post.type === "ama" ? "question" : "reply";
  const helpfulCount = post.helpfulCount ?? post.helpful?.count ?? 0;
  const helpfulMine = post.iHelpful ?? post.helpful?.mine ?? false;

  return (
    <article className="kiki-community-post">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <p className="kiki-community-post-author"><span className="kiki-community-author-dot" aria-hidden /> {post.authorEmoji ? `${post.authorEmoji} ` : ""}{post.authorAlias}</p>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{meta.emoji} {meta.label}{post.closed ? " · closed" : ""}</span>
      </div>
      {post.title ? <h3 style={{ margin: 0, overflowWrap: "anywhere" }}>{post.title}</h3> : null}
      {post.body ? <p className="kiki-community-post-body" style={{ overflowWrap: "anywhere" }}>{post.body}</p> : null}

      {post.media && post.media.length ? <Carousel media={post.media} onReact={onHelpful} /> : null}

      <PostInteractive post={post} onVote={onVote} onRate={onRate} onChallenge={onChallenge} onHunt={onHunt} onPath={onPath} sliderValue={sliderValue} setSliderValue={setSliderValue} onComment={onComment} onCommentLike={onCommentLike} />

      <div className="kiki-community-post-actions">
        <button type="button" aria-pressed={Boolean(helpfulMine)} onClick={onHelpful}><ThumbsUp size={14} /> Helpful {helpfulCount}</button>
        <button type="button" onClick={() => setShowReply((v) => !v)}><MessageCircle size={14} /> Reply</button>
      </div>

      {comments.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          {comments.slice(0, 8).map((c) => {
            const kind = c.kind ?? c.commentKind ?? "reply";
            const likes = c.likes ?? c.likeCount ?? 0;
            return (
              <div key={c.id} className="kiki-community-comment">
                <p className="kiki-community-post-author">{c.authorAlias} {kind === "host_answer" ? <span className="kiki-community-system-badge">Host</span> : null} {c.stance ? <span style={{ fontSize: 10, color: "var(--muted)" }}>({c.stance})</span> : null}</p>
                <p style={{ overflowWrap: "anywhere" }}>{c.body}</p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button type="button" onClick={() => onCommentLike(c.id)} style={{ minHeight: 28, fontSize: 11, background: "var(--surface-2)", color: "var(--accent)", border: 0, borderRadius: 8, padding: "0 8px" }}>❤ {likes}</button>
                  <small style={{ color: "var(--muted)" }}>{fmtTime(c.createdAt)}</small>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {showReply ? (
        <form className="kiki-community-reply" onSubmit={async (e) => { e.preventDefault(); if (!reply.trim()) return; await onComment(post.id, reply.trim(), { commentKind: replyKind }); setReply(""); setShowReply(false); }}>
          <label>{post.type === "ama" ? "Ask a question" : post.type === "cap" ? "Add a caption" : post.type === "fill" ? "Your answer" : "Reply"}
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={post.type === "ama" ? "Ask a general question…" : "Write a supportive response…"} />
          </label>
          <div><small>{fmtTime(post.createdAt)}</small><button type="submit">Send</button></div>
        </form>
      ) : null}
      <time dateTime={post.createdAt}>{fmtTime(post.createdAt)}</time>
    </article>
  );
}

function Carousel({ media, onReact }: { media: Media[]; onReact: () => void }) {
  const [index, setIndex] = useState(0);
  const lastTap = useRef(0);
  const current = media[index];
  function prev() { setIndex((i) => (i - 1 + media.length) % media.length); }
  function next() { setIndex((i) => (i + 1) % media.length); }
  function tap() {
    const now = Date.now();
    if (now - lastTap.current < 350) onReact();
    lastTap.current = now;
  }
  if (!current) return null;
  return (
    <div className="kiki-carousel" style={{ display: "grid", gap: 8 }}>
      <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", background: "var(--surface-2)" }}>
        {current.url ? <img src={current.url} alt={current.altText || current.caption || "Community image"} onClick={tap} style={{ width: "100%", display: "block", aspectRatio: "4 / 3", objectFit: "cover", cursor: "pointer" }} /> : <div style={{ aspectRatio: "4/3", display: "grid", placeItems: "center", color: "var(--muted)" }}>Image unavailable</div>}
        {media.length > 1 ? (
          <>
            <button type="button" onClick={prev} aria-label="Previous image" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", borderRadius: 999, border: 0, width: 32, height: 32 }}><ChevronLeft size={16} /></button>
            <button type="button" onClick={next} aria-label="Next image" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", borderRadius: 999, border: 0, width: 32, height: 32 }}><ChevronRight size={16} /></button>
            <span style={{ position: "absolute", right: 8, bottom: 8, background: "rgba(0,0,0,.55)", color: "#fff", borderRadius: 999, padding: "2px 8px", fontSize: 11 }}>{index + 1}/{media.length}</span>
          </>
        ) : null}
      </div>
      {current.caption ? <p style={{ margin: 0, fontSize: 12, color: "var(--text-2)", overflowWrap: "anywhere" }}>{current.caption}</p> : null}
      {media.length > 1 ? <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>{media.map((_, i) => <button key={i} type="button" onClick={() => setIndex(i)} aria-label={`Go to image ${i + 1}`} style={{ width: 8, height: 8, borderRadius: 999, border: 0, background: i === index ? "var(--accent)" : "var(--divider)", padding: 0 }} />)}</div> : null}
    </div>
  );
}

function PostInteractive(props: any) {
  const { post, onVote, onRate, onChallenge, onHunt, onPath, sliderValue, setSliderValue, onComment, onCommentLike } = props;
  const [fillText, setFillText] = useState("");
  const [caption, setCaption] = useState("");
  const [question, setQuestion] = useState("");
  const [pathNode, setPathNode] = useState("start");
  const [pathTip, setPathTip] = useState<string | null>(null);

  const myVoteId = post.my?.voteOptionId ?? post.my?.optionId ?? null;
  const hasVoted = Boolean(myVoteId || post.my?.voted);
  const tallyRows: any[] = Array.isArray(post.results?.tallies) ? post.results.tallies : [];
  const tallyMap = new Map<string, number>(tallyRows.map((t: any) => [String(t.optionId ?? ""), Number(t.votes ?? 0)]));
  const totalVotes = tallyRows.reduce((sum: number, t: any) => sum + Number(t.votes ?? 0), 0) as number;

  if (["poll", "tt", "decide", "hot", "quiz", "mf"].includes(post.type)) {
    const isQuizLike = post.type === "quiz" || post.type === "mf";
    const resultsVisible = tallyRows.length > 0 || (isQuizLike && hasVoted) || (post.type === "decide" && post.closed);
    const closed = Boolean(post.closed);
    const explanation = post.results?.quiz?.explanation ?? post.results?.explanation ?? null;
    const correctOptionId = post.results?.quiz?.correctOptionId ?? null;
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {(post.options ?? []).map((o: Option) => {
          const selected = Boolean((myVoteId && o.id === myVoteId) || o.mine);
          const correct = Boolean(o.correct || (correctOptionId && o.id === correctOptionId));
          const count = o.id && tallyMap.has(o.id) ? Number(tallyMap.get(o.id) ?? 0) : Number(o.count ?? 0);
          const p = resultsVisible ? (o.percent ?? (totalVotes > 0 ? pct(count, totalVotes) : 0)) : 0;
          const disabled = closed || (post.type !== "hot" && hasVoted && !selected ? true : hasVoted);
          return (
            <button key={o.id ?? o.position ?? o.label} type="button" onClick={() => o.id && onVote(o.id)} disabled={disabled} style={{ textAlign: "left", border: "1px solid var(--divider)", borderRadius: 12, padding: 10, background: selected ? "var(--accent-bg)" : "var(--surface-1)", color: "var(--text)", opacity: disabled && !selected && !correct ? 0.85 : 1, cursor: disabled ? "default" : "pointer", width: "100%", boxSizing: "border-box" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}><span style={{ overflowWrap: "anywhere" }}>{o.label}{o.subLabel ? <small style={{ color: "var(--muted)" }}> · {o.subLabel}</small> : null}</span>{resultsVisible ? <strong>{p}%</strong> : null}</div>
              {resultsVisible ? <div style={{ marginTop: 6, height: 6, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}><div style={{ width: `${p}%`, height: "100%", borderRadius: 999, background: correct ? "var(--ok, #2f9e44)" : "var(--accent)" }} /></div> : null}
              {isQuizLike && hasVoted && correct ? <small style={{ color: "var(--ok, #2f9e44)", fontWeight: 700 }}>Correct answer</small> : null}
              {selected ? <small style={{ color: "var(--accent)", fontWeight: 700 }}>Your choice</small> : null}
            </button>
          );
        })}
        {isQuizLike && hasVoted && explanation ? <p className="kiki-community-scope-note">{explanation}</p> : null}
        {post.type === "hot" ? <HotTakeAnswers post={post} onComment={onComment} onCommentLike={onCommentLike} /> : null}
        {post.type === "decide" && closed ? <p className="kiki-community-scope-note">Voting closed.</p> : null}
      </div>
    );
  }

  if (post.type === "slider") {
    const myRating = post.my?.rating ?? post.my?.value;
    const voted = myRating != null;
    const summary = post.results?.slider ?? post.results ?? {};
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {!voted ? (
          <>
            <input type="range" min={0} max={100} value={sliderValue} onChange={(e) => setSliderValue(Number(e.target.value))} />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--muted)" }}><span>{post.config?.lo || "Low"}</span><strong>{sliderValue}</strong><span>{post.config?.hi || "High"}</span></div>
            <button type="button" onClick={() => onRate(sliderValue)}>Submit rating</button>
          </>
        ) : (
          <p className="kiki-community-scope-note">You rated <strong>{myRating}</strong>. Average: <strong>{summary.avg ?? summary.average ?? 0}</strong> from {summary.count ?? 0} ratings.</p>
        )}
      </div>
    );
  }

  if (post.type === "fill") {
    return (
      <form style={{ display: "grid", gap: 8 }} onSubmit={async (e) => { e.preventDefault(); if (!fillText.trim()) return; await onComment(post.id, fillText.trim(), { commentKind: "answer" }); setFillText(""); }}>
        <p className="kiki-community-scope-note" style={{ overflowWrap: "anywhere" }}>{post.config?.prefix} <strong>____</strong> {post.config?.suffix}</p>
        <input value={fillText} onChange={(e) => setFillText(e.target.value)} placeholder="Your answer" style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--divider)", padding: "0 10px", background: "var(--surface-2)", width: "100%", boxSizing: "border-box" }} />
        <button type="submit">Share answer</button>
        <AnswersList post={post} onCommentLike={onCommentLike} showLikes />
      </form>
    );
  }

  if (post.type === "cap") {
    return (
      <form style={{ display: "grid", gap: 8 }} onSubmit={async (e) => { e.preventDefault(); if (!caption.trim()) return; await onComment(post.id, caption.trim(), { commentKind: "answer" }); setCaption(""); }}>
        <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption…" style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--divider)", padding: "0 10px", background: "var(--surface-2)", width: "100%", boxSizing: "border-box" }} />
        <button type="submit">Submit caption</button>
        <AnswersList post={post} onCommentLike={onCommentLike} showLikes ranked />
      </form>
    );
  }

  if (post.type === "ama") {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <form style={{ display: "grid", gap: 8 }} onSubmit={async (e) => { e.preventDefault(); if (!question.trim()) return; await onComment(post.id, question.trim(), { commentKind: "question" }); setQuestion(""); }}>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question…" style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--divider)", padding: "0 10px", background: "var(--surface-2)", width: "100%", boxSizing: "border-box" }} />
          <button type="submit">Ask</button>
        </form>
        <AnswersList post={post} onCommentLike={onCommentLike} showLikes />
      </div>
    );
  }

  if (post.type === "hunt") {
    const huntMine = post.my?.hunt ?? {};
    const found = huntMine.found ?? post.results?.hunt?.found ?? post.my?.foundTargets ?? post.results?.foundTargets ?? [];
    const total = Number(post.results?.hunt?.total ?? post.config?.targets_count ?? post.results?.targetCount ?? post.results?.total ?? 0);
    const tries = Number(huntMine.tries ?? post.my?.tries ?? 0);
    const foundCount = Array.isArray(found) ? found.length : 0;
    const allFound = total > 0 && foundCount >= total;
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <p className="kiki-community-scope-note">Found {foundCount}/{total || "?"} · Tries: {tries}</p>
        {allFound ? <p className="kiki-communities-notice">All targets found. Well done.</p> : <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Tap the image to search for hidden spots.</p>}
        {foundCount ? <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>{(Array.isArray(found) ? found : []).map((t: any, i: number) => <li key={t.id ?? i}>{t.label || `Target ${i + 1}`}</li>)}</ul> : null}
        {post.media?.[0]?.url ? <HuntImage url={post.media[0].url} found={Array.isArray(found) ? found : []} onGuess={onHunt} /> : null}
      </div>
    );
  }

  if (post.type === "chal") {
    const c = post.my?.challenge ?? {};
    const enrolled = Boolean(c.joined ?? post.my?.enrolled);
    const checked = Boolean(c.todayDone ?? post.my?.checkedInToday ?? post.my?.checked_in_today);
    const days = Number(post.config?.days ?? 7);
    const daysDone = Array.isArray(c.daysDone) ? c.daysDone.length : Number(post.my?.checkins ?? post.my?.checkinCount ?? 0);
    const streak = Number(c.streak ?? post.my?.streak ?? 0);
    const participants = Number(post.results?.challenge?.participants ?? post.results?.participants ?? 0);
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <p className="kiki-community-scope-note">Participants: {participants} · Streak: {streak} · Check-ins: {daysDone}/{days}</p>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(days, 7)}, minmax(0, 1fr))`, gap: 4 }}>
          {Array.from({ length: days }).map((_, i) => (
            <div key={i} title={`Day ${i + 1}`} style={{ height: 10, borderRadius: 999, background: i < daysDone ? "var(--accent)" : "var(--surface-2)" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!enrolled ? <button type="button" onClick={() => onChallenge("join")}>Join challenge</button> : <button type="button" onClick={() => onChallenge("leave")}>Leave</button>}
          {enrolled ? <button type="button" onClick={() => onChallenge("checkin")} disabled={checked}>{checked ? "Checked in today" : "Check in today"}</button> : null}
        </div>
      </div>
    );
  }

  if (post.type === "path") {
    const nodes: any[] = Array.isArray(post.config?.nodes) ? post.config.nodes : [];
    const nodeMap = new Map(nodes.map((n: any) => [n.id, n]));
    const current = nodeMap.get(pathNode) ?? nodeMap.get("start") ?? nodes[0];
    if (!current) return null;
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <p className="kiki-community-scope-note" style={{ overflowWrap: "anywhere" }}>{current.t || current.text}</p>
        {pathTip ? <p className="kiki-communities-notice">{pathTip}</p> : null}
        {!current.end ? (
          <div style={{ display: "grid", gap: 6 }}>
            {(current.ch ?? current.choices ?? []).map((choice: any, i: number) => (
              <button key={i} type="button" onClick={() => { const to = choice.to; setPathNode(to); setPathTip(choice.tip || null); const target = nodeMap.get(to); if (target?.end) { const idx = nodes.findIndex((n: any) => n.id === to); onPath(idx >= 0 ? idx : 0); } }} style={{ width: "100%", textAlign: "left", boxSizing: "border-box" }}>
                {choice.t || choice.text}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => { setPathNode("start"); setPathTip(null); }}>Start over</button>
          </div>
        )}
        {post.results?.completions != null ? <small style={{ color: "var(--muted)" }}>{post.results.completions} completions</small> : null}
      </div>
    );
  }

  return null;
}

function HotTakeAnswers({ post, onComment, onCommentLike }: { post: Post; onComment: (postId: string, body: string, opts?: { commentKind?: string; stance?: string }) => Promise<void> | void; onCommentLike: (id: string) => void }) {
  const [body, setBody] = useState("");
  const [stance, setStance] = useState<"agree" | "disagree">("agree");
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <form style={{ display: "grid", gap: 8 }} onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; await onComment(post.id, body.trim(), { commentKind: "answer", stance }); setBody(""); }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setStance("agree")} aria-pressed={stance === "agree"}>Agree</button>
          <button type="button" onClick={() => setStance("disagree")} aria-pressed={stance === "disagree"}>Disagree</button>
        </div>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add your view (optional detail)" style={{ minHeight: 40, borderRadius: 10, border: "1px solid var(--divider)", padding: "0 10px", background: "var(--surface-2)", width: "100%", boxSizing: "border-box" }} />
        <button type="submit" disabled={!body.trim()}>Share view</button>
      </form>
      <AnswersList post={post} onCommentLike={onCommentLike} showLikes />
    </div>
  );
}

function AnswersList({ post, onCommentLike, showLikes, ranked }: { post: Post; onCommentLike: (id: string) => void; showLikes?: boolean; ranked?: boolean }) {
  let items = [...(post.topAnswers ?? []), ...(post.recentReplies ?? []), ...(post.comments ?? [])].filter((c, i, arr) => c && arr.findIndex((x) => x.id === c.id) === i);
  if (ranked) items = items.sort((a, b) => ((b.likes ?? b.likeCount ?? 0) - (a.likes ?? a.likeCount ?? 0)));
  if (!items.length) return null;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {items.slice(0, 6).map((c, i) => {
        const likes = c.likes ?? c.likeCount ?? 0;
        return (
          <div key={c.id} className="kiki-community-comment">
            <p className="kiki-community-post-author">{ranked && i === 0 ? "🏆 " : ""}{c.authorAlias} {c.stance ? <span style={{ fontSize: 10, color: "var(--muted)" }}>({c.stance})</span> : null}</p>
            <p style={{ overflowWrap: "anywhere" }}>{c.body}</p>
            {showLikes ? <button type="button" onClick={() => onCommentLike(c.id)} style={{ minHeight: 28, fontSize: 11, background: "var(--surface-2)", color: "var(--accent)", border: 0, borderRadius: 8, padding: "0 8px", width: "fit-content" }}>❤ {likes}</button> : null}
          </div>
        );
      })}
    </div>
  );
}

function HuntImage({ url, found, onGuess }: { url: string; found: any[]; onGuess: (x: number, y: number) => void }) {
  return (
    <div style={{ position: "relative", borderRadius: 14, overflow: "hidden" }}>
      <img src={url} alt="Hunt image" onClick={(e) => {
        const rect = (e.currentTarget as HTMLImageElement).getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        onGuess(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
      }} style={{ width: "100%", display: "block", cursor: "crosshair" }} />
      {found.map((t, i) => (
        <span key={t.id ?? i} title={t.label} style={{ position: "absolute", left: `${Number(t.x)}%`, top: `${Number(t.y)}%`, transform: "translate(-50%,-50%)", minWidth: 22, height: 22, borderRadius: 999, background: "var(--ok, #2f9e44)", color: "#fff", fontSize: 10, display: "grid", placeItems: "center", padding: "0 4px" }}>✓</span>
      ))}
    </div>
  );
}
