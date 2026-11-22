"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell, ChevronLeft, ChevronRight, Footprints, Heart, HeartHandshake, Info,
  LockKeyhole, MapPinned, MessageCircle, RefreshCw, ShieldCheck, ThumbsUp, Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { evaluateInteractiveCommunityText } from "@/lib/communities/guardrails";
import "./communities-looply.css";

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
  const [toast, setToast] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<Post | null>(null);
  const [replyText, setReplyText] = useState("");
  const [guardTest, setGuardTest] = useState("");
  const toastTimer = useRef<number | null>(null);

  const joined = useMemo(() => communities.filter((c) => c.isMember), [communities]);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }
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
      showToast("Feed refreshed · All posts Kiki Guard verified");
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
      showToast("Joined community");
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
      showToast("Post published with Kiki Guard check");
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
      showToast("Reply posted safely");
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
      showToast("Community created");
    } catch (e) { setError(errText(e)); }
  }

  const headerAlias = feed?.pseudonym ?? activeCommunity?.pseudonym ?? "Your alias";
  const showSmartStrips = tab === "feed";

  return (
    <div className="communities-looply">
      <div className="app-viewport">
        <div className="app-shell">
          <div className={`toast-banner${toast ? " show" : ""}`}>{toast || "Action saved"}</div><div className="looply-nav-section">
            <div className="primary-pills no-scrollbar" role="tablist">
              {(["feed", "discover", "guard", "create"] as const).map((t) => (
                <button key={t} className={`primary-pill${tab === t ? " active" : ""}`} data-tab={t} onClick={() => setTab(t)}>{t === "feed" ? "Feed" : t === "discover" ? "Discover" : t === "guard" ? "Kiki Guard" : "Create"}</button>
              ))}
            </div>

            {showSmartStrips && (
              <div id="feedSmartStrips">
                <div className="secondary-strip no-scrollbar">
                  {joined.map((c) => (
                    <button key={c.id} className={`space-pill${c.slug === activeSlug ? " active" : ""}`} onClick={() => void openCommunity(c.slug)}>{c.isSystem ? "🛡️" : "💠"} {c.name}</button>
                  ))}
                  {!joined.length && communities.slice(0, 1).map((c) => (
                    <button key={c.id} className={`space-pill${c.slug === activeSlug ? " active" : ""}`} onClick={() => void openCommunity(c.slug)}>🛡️ {c.name}</button>
                  ))}
                </div>
                <div className="category-strip no-scrollbar">
                  {groups.map((g) => (
                    <button key={g.id || "all"} className={`filter-chip${group === g.id ? " active" : ""}`} onClick={() => { setGroup(g.id); if (activeCommunity) void loadFeed(activeCommunity.slug, g.id); }}>{g.label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <main className="app-content" id="mainScroll">
            {error ? <div className="section-pad"><div className="guard-status-banner warning" role="alert">{error}</div></div> : null}
            {notice ? <div className="section-pad" style={{ paddingBottom: 0 }}><div className="guard-status-banner">{notice}</div></div> : null}
            {loading ? <div className="section-pad"><div className="community-desc">Loading communities…</div></div> : null}

            {tab === "feed" && (
              <section id="tab-feed" className="tab-panel active">
                {activeCommunity && feed ? (
                  <>
                    {feed.welcomeRequired ? (
                      <div className="section-pad">
                        <div className="widget-box">
                          <h3 className="post-title">Welcome to {feed.community.name}</h3>
                          <p className="post-text" style={{ marginTop: 6 }}>{feed.welcomeBody ?? "Please read the community space before participating."}</p>
                          <button type="button" className="pill-btn-primary full-width" onClick={() => void acknowledgeWelcome()}>I understand, continue</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="inline-composer-wrap">
                          <div className="inline-composer-trigger" onClick={() => { if (!composerOpen) setDraft(emptyDraft("post")); setComposerOpen((v) => !v); }}>
                            <div className="composer-placeholder-left">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                              <span>Share something helpful...</span>
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kiki-purple)" }}>Create</span>
                          </div>
                          <div className="composer-type-shortcuts no-scrollbar">
                            {[["post","🖼️ Post"],["poll","📊 Poll"],["tt","⚖️ This/That"],["slider","🎚️ Slider"],["fill","✍️ Fill Blank"],["cap","📸 Caption"],["carousel","🖼️ Carousel"]].map(([t,l]) => (
                              <button key={t} className="type-shortcut-btn" onClick={() => { setDraft(emptyDraft(t)); setComposerOpen(true); }}>{l}</button>
                            ))}
                          </div>

                          {composerOpen && (
                            <div className="create-post-drawer open">
                              <div className="drawer-top-row">
                                <span className="drawer-title">Create a post</span>
                                <button type="button" className="close-pill-btn" onClick={() => setComposerOpen(false)}>Close</button>
                              </div>
                              <div className="composer-field-row">
                                <label className="composer-field-label" htmlFor="postTypeSelect">Post type</label>
                                <select id="postTypeSelect" className="post-type-select" value={draft.type} onChange={(e) => setDraft((d) => ({ ...emptyDraft(e.target.value), postId: d.postId }))}>
                                  {createTypes.map((t) => <option key={t} value={t}>{typeMeta[t].emoji} {typeMeta[t].label}</option>)}
                                </select>
                              </div>
                              {draft.type !== "post" && (
                                <div className="composer-field-row"><label className="composer-field-label">Title</label><input className="form-input" value={draft.title} onChange={(e) => updateDraft({ title: e.target.value })} placeholder="Optional title" /></div>
                              )}
                              <div className="composer-field-row">
                                <label className="composer-field-label" htmlFor="postBodyTextarea">{draft.type === "post" ? "Post" : "Prompt / body"}</label>
                                <textarea id="postBodyTextarea" className="composer-textarea" placeholder={draft.type === "post" ? "Share something helpful with the community..." : "Add context for this interactive post..."} value={draft.body} onChange={(e) => updateDraft({ body: e.target.value })} />
                              </div>

                              {["poll","decide","tt","quiz"].includes(draft.type) && (
                                <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                                  {draft.options.map((opt, i) => (
                                    <div key={i} style={{ display: "grid", gap: 6 }}>
                                      <input className="form-input" value={opt.label} onChange={(e) => updateDraft({ options: draft.options.map((o, idx) => idx === i ? { ...o, label: e.target.value } : o) })} placeholder={`Option ${i + 1}`} />
                                      {draft.type !== "quiz" && <input className="form-input" value={opt.subLabel} onChange={(e) => updateDraft({ options: draft.options.map((o, idx) => idx === i ? { ...o, subLabel: e.target.value } : o) })} placeholder="Sub-label (optional)" />}
                                      {draft.type === "quiz" && <label style={{ fontSize: 12 }}><input type="radio" name="correct" checked={Boolean(opt.correct)} onChange={() => updateDraft({ options: draft.options.map((o, idx) => ({ ...o, correct: idx === i })) })} /> Correct answer</label>}
                                      {draft.options.length > 2 && draft.type !== "tt" && <button type="button" className="close-pill-btn" onClick={() => updateDraft({ options: draft.options.filter((_, idx) => idx !== i) })}>Remove</button>}
                                    </div>
                                  ))}
                                  {draft.type !== "tt" && draft.options.length < 4 && <button type="button" className="close-pill-btn" onClick={() => updateDraft({ options: [...draft.options, { label: "", subLabel: "" }] })}>Add option</button>}
                                </div>
                              )}
                              {draft.type === "slider" && (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                                  <input className="form-input" value={draft.sliderLo} onChange={(e) => updateDraft({ sliderLo: e.target.value })} placeholder="Low label" />
                                  <input className="form-input" value={draft.sliderHi} onChange={(e) => updateDraft({ sliderHi: e.target.value })} placeholder="High label" />
                                </div>
                              )}
                              {draft.type === "fill" && (
                                <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                                  <input className="form-input" value={draft.prefix} onChange={(e) => updateDraft({ prefix: e.target.value })} placeholder="Prefix" />
                                  <input className="form-input" value={draft.suffix} onChange={(e) => updateDraft({ suffix: e.target.value })} placeholder="Suffix" />
                                </div>
                              )}
                              {draft.type === "chal" && (
                                <div className="composer-field-row"><label className="composer-field-label">Days</label><input className="form-input" type="number" min={1} max={30} value={draft.challengeDays} onChange={(e) => updateDraft({ challengeDays: Number(e.target.value) })} /></div>
                              )}

                              <div className="file-upload-row">
                                <div className="file-upload-meta"><strong>Images</strong> (JPEG/PNG/WebP/AVIF, images only){draft.type === "carousel" || draft.type === "cap" || draft.type === "hunt" ? " — required" : " — optional"}</div>
                                <label className="file-picker-btn">
                                  <span>{draft.media.length ? `${draft.media.length} selected` : "Choose files"}</span>
                                  <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple={draft.type !== "cap" && draft.type !== "hunt"} style={{ display: "none" }} onChange={(e) => void onSelectImages(e.target.files)} />
                                </label>
                              </div>
                              {draft.media.length ? (
                                <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                                  {draft.media.map((m, i) => (
                                    <div key={i} style={{ border: "1px solid var(--border-input)", borderRadius: 14, padding: 8 }}>
                                      <img src={m.previewUrl} alt={m.altText || "Selected image preview"} style={{ width: "100%", maxHeight: 170, objectFit: "cover", borderRadius: 10 }} />
                                      <input className="form-input" style={{ marginTop: 8 }} value={m.caption} onChange={(e) => updateMedia(i, { caption: e.target.value })} placeholder="Caption (optional)" />
                                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                                        <button type="button" className="close-pill-btn" onClick={() => moveMedia(i, -1)} disabled={i === 0}>Up</button>
                                        <button type="button" className="close-pill-btn" onClick={() => moveMedia(i, 1)} disabled={i === draft.media.length - 1}>Down</button>
                                        <button type="button" className="close-pill-btn" onClick={() => removeMedia(i)}>Remove</button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              <div className={`guard-status-banner${liveGuard?.refused || liveGuard?.redacted ? " warning" : ""}`}>
                                {liveGuard?.refused ? "Kiki Guard cannot make this safe to share. Please remove identifying details." : liveGuard?.redacted ? `Will remove or generalize: ${(liveGuard.removed || []).join(", ") || "identifying details"}.` : "Looks good. Nothing risky found."}
                              </div>
                              <p className="guard-helper-note">Images are re-encoded to JPEG before upload. Kiki Guard checks text before publishing.</p>
                              <button type="button" className="pill-btn-primary full-width" onClick={() => void publishPost()} disabled={submitting || Boolean(liveGuard?.refused)}>{submitting ? "Publishing…" : "Run Kiki Guard & Publish"}</button>
                            </div>
                          )}
                        </div>

                        <div id="feedList">
                          {feedLoading ? <div className="section-pad"><div className="community-desc">Loading feed…</div></div> : null}
                          {(feed.posts ?? []).map((post) => (
                            <LooplyPostCard
                              key={post.id}
                              post={post}
                              onVote={(optionId) => void actOnPost(post.id, { action: "vote", optionId })}
                              onRate={(value) => void actOnPost(post.id, { action: "rate", value })}
                              onChallenge={(mode) => void actOnPost(post.id, { action: "challenge", mode })}
                              onHunt={(x, y) => void actOnPost(post.id, { action: "hunt", x, y })}
                              onPath={(endNode) => void actOnPost(post.id, { action: "path_finish", endNode })}
                              onHelpful={() => void toggleLike(post.id, "helpful")}
                              onOpenReply={() => { setReplyFor(post); setReplyText(""); }}
                            />
                          ))}
                          {!feedLoading && !(feed.posts ?? []).length ? <div className="section-pad"><p className="community-desc">No posts in this view yet.</p></div> : null}
                        </div>
                      </>
                    )}
                  </>
                ) : (!loading ? <div className="section-pad"><p className="community-desc">Join a community to see its feed.</p></div> : null)}
              </section>
            )}

            {tab === "discover" && (
              <section id="tab-discover" className="tab-panel active section-pad">
                <div className="search-input-wrap">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  <input className="search-input" value={discoverQuery} onChange={(e) => setDiscoverQuery(e.target.value)} placeholder="Search communities..." />
                </div>
                <div id="communityList">
                  {discoverList.map((c) => (
                    <div key={c.id} className="community-row">
                      <div className="community-row-left">
                        <div className="community-icon-badge"><CommunityIcon iconKey={c.iconKey} /></div>
                        <div>
                          <div className="community-title-line">
                            <span className="community-title">{c.name}</span>
                            {c.isSystem ? <span className="kiki-tag">Kiki</span> : null}
                          </div>
                          <p className="community-subtitle">{c.description}</p>
                          <p className="community-desc">{c.scope} · {c.memberCount ?? 0} members</p>
                        </div>
                      </div>
                      {c.isMember ? (
                        <button type="button" className="join-pill-btn joined" onClick={() => { setTab("feed"); void openCommunity(c.slug); }}>Open</button>
                      ) : (
                        <button type="button" className="join-pill-btn" onClick={() => void joinCommunity(c.slug, c.id)}>Join</button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {tab === "guard" && (
              <section id="tab-guard" className="tab-panel active section-pad">
                <div className="guard-hero">
                  <div className="guard-shield-icon"><ShieldCheck size={22} /></div>
                  <div>
                    <h3 className="post-title" style={{ marginBottom: 4 }}>Kiki Guard</h3>
                    <p className="post-text" style={{ fontSize: 13, color: "var(--text-secondary)" }}>Content is checked before it is shared. Identifying details are removed or blocked to keep communities safer.</p>
                  </div>
                </div>
                <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>What Guard looks for</h4>
                <ul className="guard-list" style={{ marginBottom: 20 }}>
                  <li><span>•</span> Personal names and identifying handles</li>
                  <li><span>•</span> Phone numbers, emails, links, IDs, and addresses</li>
                  <li><span>•</span> Precise locations or details that could identify someone</li>
                </ul>
                <div className="form-group">
                  <label className="form-label" htmlFor="guardTestInput">Try a safety check (Sandbox)</label>
                  <textarea id="guardTestInput" className="form-textarea" value={guardTest} onChange={(e) => setGuardTest(e.target.value)} placeholder="Type something to see how Kiki Guard redacts it..." />
                  <div className="guard-preview-box">
                    {(() => {
                      if (!guardTest.trim()) return "Guard preview will appear here...";
                      const r = evaluateInteractiveCommunityText(guardTest);
                      if (r.decision === "refuse") return <strong>Unsafe to share as written.</strong>;
                      if (r.decision === "redact") return <><strong>Safe Output:</strong> {r.safeText}</>;
                      return <><strong>Looks good:</strong> {guardTest}</>;
                    })()}
                  </div>
                </div>
                <h4 style={{ fontSize: 14, fontWeight: 600, margin: "20px 0 8px" }}>Recent checks</h4>
                <div id="recentGuardLog" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, color: "var(--text-secondary)" }}>
                  {guardHistory.length ? guardHistory.map((item) => (
                    <div key={item.id} style={{ padding: "8px 12px", borderRadius: 10, background: "var(--bg-subtle)", color: "var(--text-body)" }}>
                      <strong>{item.reason || item.action}</strong><div>{item.contextType} · {fmtTime(item.createdAt)}{item.details ? ` · ${item.details}` : ""}</div>
                    </div>
                  )) : <div style={{ padding: "8px 12px", borderRadius: 10, background: "var(--bg-subtle)" }}>No recent guard events.</div>}
                </div>
              </section>
            )}

            {tab === "create" && (
              <section id="tab-create" className="tab-panel active section-pad">
                <h3 className="post-title" style={{ marginBottom: 16, fontSize: 18 }}>Create a community</h3>
                <div className="form-group">
                  <label className="form-label">Community name</label>
                  <input type="text" className="form-input" value={createDraft.name} onChange={(e) => setCreateDraft({ ...createDraft, name: e.target.value })} placeholder="e.g. Late Commute Crew" maxLength={80} />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea className="form-textarea" value={createDraft.description} onChange={(e) => setCreateDraft({ ...createDraft, description: e.target.value })} placeholder="What this space is for..." maxLength={200} />
                </div>
                <div className="form-group">
                  <label className="form-label">Community space / scope</label>
                  <input type="text" className="form-input" value={createDraft.scope} onChange={(e) => setCreateDraft({ ...createDraft, scope: e.target.value })} placeholder="Who this space helps and what belongs here..." maxLength={220} />
                </div>
                <div className="form-group">
                  <label className="form-label">Choose an icon</label>
                  <div className="icon-picker-grid">
                    {iconChoices.map((icon) => (
                      <button key={icon.value} type="button" className={`icon-choice${createDraft.iconKey === icon.value ? " selected" : ""}`} onClick={() => setCreateDraft({ ...createDraft, iconKey: icon.value })}>
                        <CommunityIcon iconKey={icon.value} />
                        <span>{icon.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="guard-helper-note" style={{ marginTop: 4 }}>Kiki Guard checks names and descriptions before the community is created.</p>
                <button type="button" className="pill-btn-primary full-width" onClick={() => void createCommunity()} disabled={!createDraft.name.trim() || !createDraft.description.trim() || !createDraft.scope.trim()}>Run Kiki Guard &amp; Create</button>
              </section>
            )}
          </main><div className={`drawer-backdrop${replyFor ? " open" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) setReplyFor(null); }}>
            <div className="reply-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-handle"></div>
              <div className="drawer-header">
                <span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{replyFor?.title || "Community Replies"}</span>
                <button type="button" className="post-more-btn" onClick={() => setReplyFor(null)}>✕</button>
              </div>
              <div className="drawer-replies-list">
                {(replyFor?.comments ?? []).length ? (replyFor?.comments ?? []).map((c) => (
                  <div key={c.id} className="reply-item">
                    <div className="post-avatar" style={{ width: 32, height: 32, fontSize: 14 }}>🛡️</div>
                    <div className="reply-bubble">
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{c.authorAlias} · {fmtTime(c.createdAt)}</div>
                      <div>{c.body}</div>
                    </div>
                  </div>
                )) : <div className="community-desc">No replies yet.</div>}
              </div>
              <div className="widget-input-row" style={{ marginTop: 8 }}>
                <input type="text" className="clean-input" placeholder="Add a kind, anonymous reply..." value={replyText} onChange={(e) => setReplyText(e.target.value)} />
                <button type="button" className="pill-btn-primary" onClick={async () => { if (!replyFor || !replyText.trim()) return; await submitComment(replyFor.id, replyText.trim(), { commentKind: replyFor.type === "cap" || replyFor.type === "fill" ? "answer" : replyFor.type === "ama" ? "question" : "reply" }); setReplyText(""); }}>Reply</button>
              </div>
            </div>
          </div>

          {activeStory && (
            <div className="drawer-backdrop open" onClick={() => setActiveStory(null)}>
              <div className="reply-drawer" onClick={(e) => e.stopPropagation()}>
                <div className="drawer-handle"></div>
                <div className="drawer-header"><span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600 }}>{activeStory.emoji} {activeStory.title}</span><button type="button" className="post-more-btn" onClick={() => setActiveStory(null)}>✕</button></div>
                <div className="drawer-replies-list"><p className="community-subtitle"><strong>{activeStory.byline}</strong></p><p className="post-text">{activeStory.body}</p></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function LooplyPostCard(props: {
  post: Post;
  onVote: (optionId: string) => void;
  onRate: (value: number) => void;
  onChallenge: (mode: "join" | "leave" | "checkin") => void;
  onHunt: (x: number, y: number) => void;
  onPath: (endNode: number) => void;
  onHelpful: () => void;
  onOpenReply: () => void;
}) {
  const { post, onVote, onRate, onChallenge, onHunt, onPath, onHelpful, onOpenReply } = props;
  const meta = typeMeta[post.type] ?? { label: post.type, emoji: "💬", group: "posts" };
  const helpfulCount = post.helpfulCount ?? post.helpful?.count ?? 0;
  const helpfulMine = post.iHelpful ?? post.helpful?.mine ?? false;
  const replyCount = (post.comments ?? []).length;
  const myVoteOptionId = (post.options ?? []).find((o) => o.mine)?.id || post.my?.vote || post.my?.optionId || "";

  return (
    <article className="feed-post">
      <div className="post-header">
        <div className="post-author-left">
          <div className="post-avatar">{post.authorEmoji || (post.isKiki ? "🪶" : "🛡️")}</div>
          <div className="post-author-meta">
            <div className="post-author-row">
              <span className="post-author-name">{post.authorAlias}</span>
            </div>
            <div className="post-time-row"><span>{fmtTime(post.createdAt)}</span><span>·</span><span>{meta.group}</span></div>
          </div>
        </div>
        <div className="post-header-right">
          <span className="post-type-pill">{meta.emoji} {meta.label}</span>
        </div>
      </div>

      <div className="post-body">
        {post.title ? <h3 className="post-title">{post.title}</h3> : null}
        {post.body ? <p className="post-text">{post.body}</p> : null}
        {post.media && post.media.length ? <LooplyCarousel media={post.media} /> : null}
        <LooplyInteractive post={post} myVoteOptionId={myVoteOptionId} onVote={onVote} onRate={onRate} onChallenge={onChallenge} onHunt={onHunt} onPath={onPath} />
      </div>

      <div className="post-footer">
        <div className="footer-left">
          <button className={`engage-btn${helpfulMine ? " liked" : ""}`} onClick={onHelpful}>
            <svg className="heart-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            <span className="engage-count">{helpfulCount}</span>
            <span className="engage-label">Helpful</span>
          </button>
          <button className="engage-btn" onClick={onOpenReply}>
            <MessageCircle size={17} />
            <span className="engage-count">{replyCount}</span>
            <span className="engage-label">Replies</span>
          </button>
        </div>
        <div className="footer-right">
          <button className="icon-action-btn" aria-label="Bookmark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>
        </div>
      </div>
    </article>
  );
}

function LooplyCarousel({ media }: { media: Media[] }) {
  const [index, setIndex] = useState(0);
  const current = media[index];
  if (!current) return null;
  const prev = () => setIndex((i) => (i - 1 + media.length) % media.length);
  const next = () => setIndex((i) => (i + 1) % media.length);
  return (
    <div>
      <div className="carousel-frame">
        {current.url ? <img className="carousel-img" src={current.url} alt={current.altText || current.caption || "Community image"} /> : <div className="carousel-img" style={{ display: "grid", placeItems: "center", color: "var(--text-muted)" }}>Image unavailable</div>}
        {media.length > 1 ? (
          <>
            <button type="button" className="carousel-arrow prev" onClick={prev} aria-label="Previous slide">‹</button>
            <button type="button" className="carousel-arrow next" onClick={next} aria-label="Next slide">›</button>
            <span className="carousel-counter-badge">{index + 1}/{media.length}</span>
          </>
        ) : null}
      </div>
      {current.caption ? <p className="carousel-step-caption">{current.caption}</p> : null}
      {media.length > 1 ? <div className="carousel-bars">{media.map((_, i) => <div key={i} className={`carousel-bar${i === index ? " active" : ""}`} onClick={() => setIndex(i)} />)}</div> : null}
    </div>
  );
}

function LooplyInteractive(props: {
  post: Post;
  myVoteOptionId: string;
  onVote: (optionId: string) => void;
  onRate: (value: number) => void;
  onChallenge: (mode: "join" | "leave" | "checkin") => void;
  onHunt: (x: number, y: number) => void;
  onPath: (endNode: number) => void;
}) {
  const { post, myVoteOptionId, onVote, onRate, onChallenge, onHunt, onPath } = props;
  const [slider, setSlider] = useState(Number(post.my?.rating ?? post.my?.value ?? 50));
  const [pathNode, setPathNode] = useState("start");
  const [pathTip, setPathTip] = useState<string | null>(null);

  if (post.type === "poll" || post.type === "decide" || post.type === "tt" || post.type === "quiz" || post.type === "mf") {
    const total = (post.options ?? []).reduce((sum, o) => sum + Number(o.count ?? 0), 0) || 1;
    return (
      <div className="widget-box">
        <div className="choice-stack">
          {(post.options ?? []).map((o) => {
            const count = Number(o.count ?? 0);
            const selected = Boolean(o.mine) || (myVoteOptionId && (o.id === myVoteOptionId || o.label === myVoteOptionId));
            return (
              <button key={o.id ?? o.label} type="button" className={`choice-pill${selected ? " selected" : ""}`} onClick={() => o.id && onVote(o.id)}>
                <div className="choice-bar-fill" style={{ width: `${pct(count, total)}%` }} />
                <div className="choice-text-wrap"><span className="choice-main-label">{o.label}</span>{o.subLabel ? <span className="choice-sub-label"> {o.subLabel}</span> : null}</div>
                <span className="choice-pct">{pct(count, total)}%</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (post.type === "slider") {
    const lo = String(post.config?.lo ?? "Not ready");
    const hi = String(post.config?.hi ?? "Very ready");
    const avg = Number(post.results?.slider?.avg ?? post.results?.average ?? 0);
    return (
      <div className="widget-box">
        <div className="slider-header"><span>{lo}</span><span className="slider-val-badge">{slider}%</span><span>{hi}</span></div>
        <input type="range" className="kiki-range" min={0} max={100} value={slider} onChange={(e) => setSlider(Number(e.target.value))} />
        <button type="button" className="pill-btn-primary full-width" onClick={() => onRate(slider)}>Submit rating</button>
        {avg ? <div className="feedback-callout show" style={{ marginTop: 9 }}>Community average: {Math.round(avg)}%</div> : null}
      </div>
    );
  }

  if (post.type === "fill") {
    return <div className="widget-box"><div className="prompt-sentence">{String(post.config?.prefix ?? "")} <span className="blank-highlight">_____</span> {String(post.config?.suffix ?? "")}</div><div className="community-desc">Reply in comments to complete the blank.</div></div>;
  }

  if (post.type === "hot") {
    return (
      <div className="widget-box">
        <div className="stance-row">
          <button type="button" className="stance-btn" onClick={() => onVote((post.options ?? []).find((o) => /agree/i.test(o.label))?.id || (post.options ?? [])[0]?.id || "")}>Agree</button>
          <button type="button" className="stance-btn" onClick={() => onVote((post.options ?? []).find((o) => /disagree/i.test(o.label))?.id || (post.options ?? [])[1]?.id || "")}>Disagree</button>
        </div>
        <div className="community-desc">Share your view in replies.</div>
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
    return (
      <div className="widget-box">
        <div className="challenge-stats">Participants: {Number(post.results?.challenge?.participants ?? post.results?.participants ?? 0)} · Streak: {streak} · Check-ins: {daysDone}/{days}</div>
        <div className="segments-row">{Array.from({ length: days }).map((_, i) => <div key={i} className={`segment-bar${i < daysDone ? " filled" : ""}`} />)}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!enrolled ? <button type="button" className="pill-btn-primary" onClick={() => onChallenge("join")}>Join challenge</button> : <button type="button" className="close-pill-btn" onClick={() => onChallenge("leave")}>Leave</button>}
          {enrolled ? <button type="button" className="pill-btn-primary" onClick={() => onChallenge("checkin")} disabled={checked}>{checked ? "Checked in today" : "Check in today"}</button> : null}
        </div>
      </div>
    );
  }

  if (post.type === "hunt") {
    const found = post.my?.hunt?.found ?? post.results?.hunt?.found ?? post.my?.foundTargets ?? [];
    const total = Number(post.results?.hunt?.total ?? post.config?.targets_count ?? (Array.isArray(post.config?.targets) ? post.config.targets.length : 0));
    const tries = Number(post.my?.hunt?.tries ?? post.my?.tries ?? 0);
    const foundCount = Array.isArray(found) ? found.length : 0;
    return (
      <div className="widget-box">
        <div className="hunt-status-pill"><span>Found {foundCount}/{total || "?"}</span><span>Tries: {tries}</span></div>
        {post.media?.[0]?.url ? (
          <div className="single-photo-frame hunt-canvas" style={{ marginTop: 10 }}>
            <img src={post.media[0].url} alt="Hunt image" onClick={(e) => {
              const rect = (e.currentTarget as HTMLImageElement).getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * 100;
              const y = ((e.clientY - rect.top) / rect.height) * 100;
              onHunt(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
            }} />
            {(Array.isArray(found) ? found : []).map((t: any, i: number) => <span key={t.id ?? i} className="hunt-hotspot found" style={{ left: `${Number(t.x)}%`, top: `${Number(t.y)}%` }}>✓</span>)}
          </div>
        ) : <div className="community-desc">Tap the image in this hunt to search for spots.</div>}
      </div>
    );
  }

  if (post.type === "path") {
    const nodes: any[] = Array.isArray(post.config?.nodes) ? post.config.nodes : [];
    const nodeMap = new Map(nodes.map((n: any) => [n.id, n]));
    const current = nodeMap.get(pathNode) ?? nodeMap.get("start") ?? nodes[0];
    if (!current) return null;
    return (
      <div className="widget-box">
        <p className="post-text" style={{ marginBottom: 10 }}>{current.t || current.text}</p>
        {pathTip ? <div className="feedback-callout show">{pathTip}</div> : null}
        {!current.end ? (
          <div className="choice-stack" style={{ marginTop: 8 }}>
            {(current.ch ?? current.choices ?? []).map((choice: any, i: number) => (
              <button key={i} type="button" className="choice-pill" onClick={() => {
                const to = choice.to; setPathNode(to); setPathTip(choice.tip || null);
                const target = nodeMap.get(to);
                if (target?.end) { const idx = nodes.findIndex((n: any) => n.id === to); onPath(idx >= 0 ? idx : 0); }
              }}>
                <div className="choice-text-wrap"><span className="choice-main-label">{choice.t || choice.text}</span></div>
              </button>
            ))}
          </div>
        ) : <button type="button" className="pill-btn-primary full-width" onClick={() => { setPathNode("start"); setPathTip(null); }}>Start over</button>}
      </div>
    );
  }

  if (post.type === "ama") return <div className="widget-box"><div className="community-desc">Ask a question in replies. Host answers will appear in the thread.</div></div>;
  if (post.type === "cap") return <div className="widget-box"><div className="community-desc">Add your caption in replies.</div></div>;
  return null;
}