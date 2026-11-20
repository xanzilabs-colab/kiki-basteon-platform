"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Footprints, Heart, HeartHandshake, Lightbulb, LockKeyhole, MapPinned, MessageCircle, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Community = {
  id: string;
  slug: string;
  name: string;
  description: string;
  scope: string;
  iconKey: string;
  isSystem: boolean;
  memberCount: number;
  isMember: boolean;
  pseudonym: string | null;
  welcomeReadAt: string | null;
  mutedUntil: string | null;
};

type CommunityView = Pick<Community, "id" | "slug" | "name" | "description" | "scope" | "iconKey" | "isSystem">;
type ReactionType = "support" | "thanks" | "care";
type Comment = { id: string; authorAlias: string; isKiki: boolean; body: string; createdAt: string };
type Post = {
  id: string;
  type: string;
  authorAlias: string;
  isKiki: boolean;
  body: string;
  createdAt: string;
  comments: Comment[];
  reactions: { support: number; thanks: number; care: number; mine: string[] };
};
type Feed = {
  community: CommunityView;
  isMember: boolean;
  pseudonym?: string;
  welcomeRequired?: boolean;
  canPost?: boolean;
  mutedUntil?: string | null;
  posts: Post[];
};
type GuardPreview = { decision: "allow" | "redact" | "refuse"; safeText: string; reason: string };
type GuardEvent = { decision: "redacted" | "refused"; categories: string[]; severity: number; created_at: string };
type Tab = "feed" | "discover" | "guard" | "create";

const tabLabels: Array<{ value: Tab; label: string }> = [
  { value: "feed", label: "Feed" },
  { value: "discover", label: "Discover" },
  { value: "guard", label: "Kiki Guard" },
  { value: "create", label: "Create" },
];

const communityIcons: Record<string, LucideIcon> = {
  shield: ShieldCheck,
  lightbulb: Lightbulb,
  footprints: Footprints,
  heart: Heart,
  users: Users,
};

function CommunityIcon({ iconKey, size = 20 }: { iconKey: string; size?: number }) {
  const Icon = communityIcons[iconKey] ?? Users;
  return <Icon size={size} aria-hidden="true" />;
}

function formatCommunityTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(value).toLocaleDateString();
}

function messageForError(code: string) {
  const messages: Record<string, string> = {
    communities_unavailable: "Communities could not be loaded. Please try again.",
    community_unavailable: "This community could not be loaded. Please try again.",
    community_feed_unavailable: "The community feed could not be loaded. Please try again.",
    community_join_unavailable: "You could not join this community. Please try again.",
    community_create_unavailable: "The community could not be created. Check whether its name is already in use.",
    community_post_unavailable: "Your message could not be posted. Please try again.",
    reaction_unavailable: "Your reaction could not be saved.",
    rate_limited: "You have reached an activity limit. Please wait before trying again.",
    posting_muted: "Posting is temporarily paused for this community.",
    not_a_member: "Join this community before posting.",
    welcome_unread: "Read and acknowledge the community welcome before posting.",
  };
  return messages[code] ?? "Something went wrong. Please try again.";
}

async function communityApi<T>(input: string, init?: RequestInit): Promise<{ ok: boolean; result: T } | null> {
  try {
    const response = await fetch(input, init);
    return { ok: response.ok, result: await response.json() as T };
  } catch {
    return null;
  }
}

export function CommunitiesHub({ slug }: { slug?: string }) {
  const router = useRouter();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [activeSlug, setActiveSlug] = useState(slug ?? "");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [tab, setTab] = useState<Tab>("feed");
  const [events, setEvents] = useState<GuardEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedLoading, setFeedLoading] = useState(false);
  const [communityListReady, setCommunityListReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discoverFilter, setDiscoverFilter] = useState<"all" | "kiki" | "joined">("all");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<{ text: string; safeText: string; reason: string; parentId: string | null } | null>(null);
  const [form, setForm] = useState({ name: "", description: "", scope: "" });

  async function loadCommunities() {
    setError("");
    const request = await communityApi<{ communities?: Community[]; defaultCommunitySlug?: string; error?: string }>("/api/communities", { cache: "no-store" });
    if (!request) {
      setError("Communities could not be loaded. Check your connection and try again.");
      setLoading(false);
      return;
    }
    const { ok, result } = request;
    if (!ok || !result.communities) {
      setError(messageForError(result.error ?? ""));
      setLoading(false);
      return;
    }
    let communities = result.communities;
    const welcomeCommunity = communities.find((item) => item.slug === (result.defaultCommunitySlug ?? "kiki-tips"));
    if (welcomeCommunity && !welcomeCommunity.isMember) {
      const joined = await communityApi<{ error?: string }>(`/api/communities/${welcomeCommunity.id}/join`, { method: "POST" });
      if (joined?.ok) {
        const refreshed = await communityApi<{ communities?: Community[] }>("/api/communities", { cache: "no-store" });
        if (refreshed?.ok && refreshed.result.communities) communities = refreshed.result.communities;
      } else {
        setError(messageForError(joined?.result.error ?? "community_join_unavailable"));
      }
    }
    setCommunities(communities);
    setCommunityListReady(true);
    if (!slug) setActiveSlug((current) => current || result.defaultCommunitySlug || communities.find((item) => item.isMember)?.slug || "");
    setLoading(false);
  }

  async function loadFeed(targetSlug: string) {
    setFeedLoading(true);
    const request = await communityApi<Feed & { error?: string }>(`/api/communities/${encodeURIComponent(targetSlug)}/feed`, { cache: "no-store" });
    if (!request) {
      setFeed(null);
      setError("The community feed could not be loaded. Check your connection and try again.");
      setFeedLoading(false);
      return;
    }
    const { ok, result } = request;
    if (!ok) {
      setFeed(null);
      setError(messageForError(result.error ?? ""));
      setFeedLoading(false);
      return;
    }
    setFeed(result);
    setError("");
    setFeedLoading(false);
  }

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (requestedTab === "discover" || requestedTab === "guard" || requestedTab === "create") setTab(requestedTab);
    void loadCommunities();
  }, []);

  useEffect(() => {
    if (slug) setActiveSlug(slug);
  }, [slug]);

  useEffect(() => {
    if (communityListReady && activeSlug) void loadFeed(activeSlug);
  }, [activeSlug, communityListReady]);

  useEffect(() => {
    if (tab !== "guard") return;
    let active = true;
    void communityApi<{ events?: GuardEvent[] }>("/api/communities/guard", { cache: "no-store" })
      .then((request) => {
        if (!request?.ok) {
          if (active) setError("Kiki Guard history could not be loaded.");
          return;
        }
        if (active) setEvents(request.result.events ?? []);
      });
    return () => { active = false; };
  }, [tab]);

  function openCommunity(targetSlug: string) {
    setTab("feed");
    setActiveSlug(targetSlug);
    router.push(`/account/communities/${encodeURIComponent(targetSlug)}`);
  }

  async function joinCommunity(community: Community) {
    setBusy(true);
    setError("");
    const request = await communityApi<{ error?: string }>(`/api/communities/${community.id}/join`, { method: "POST" });
    if (!request?.ok) {
      setError(messageForError(request?.result.error ?? "network_unavailable"));
      setBusy(false);
      return;
    }
    await loadCommunities();
    openCommunity(community.slug);
    await loadFeed(community.slug);
    setBusy(false);
  }

  async function acknowledgeWelcome() {
    if (!feed) return;
    setBusy(true);
    setError("");
    const request = await communityApi<{ error?: string }>(`/api/communities/${feed.community.id}/welcome`, { method: "POST" });
    if (!request?.ok) setError(messageForError(request?.result.error ?? "network_unavailable"));
    else await loadFeed(feed.community.slug);
    setBusy(false);
  }

  async function publishMessage(text: string, parentId: string | null) {
    if (!feed) return;
    setBusy(true);
    setError("");
    setNotice("");
    const request = await communityApi<{ error?: string; reason?: string; noticeSent?: boolean; redacted?: boolean }>("/api/communities/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ communityId: feed.community.id, body: text, parentId }),
    });
    if (!request) {
      setError("Your message could not be sent. Check your connection and try again.");
      setBusy(false);
      return;
    }
    const { ok, result } = request;
    if (!ok) {
      setError(result.reason ?? messageForError(result.error ?? ""));
      if (result.error === "message_refused" && result.noticeSent === false) setError(`${result.reason ?? "Your message was not posted."} Kiki Guard could not send the notification; please contact support.`);
      setBusy(false);
      return;
    }
    setDraft("");
    if (parentId) setReplyingTo(null);
    setPendingDraft(null);
    if (result.redacted) setNotice(result.noticeSent === false ? "Your message was shared without private details, but the Kiki Guard notification could not be sent." : "Kiki Guard removed possible private details and shared the safe version. You’ll also receive a notification.");
    else setNotice(result.noticeSent === false ? "Your message was shared, but the Kiki Guard notification could not be sent." : "Your message was shared anonymously.");
    await Promise.all([loadFeed(feed.community.slug), loadCommunities()]);
    setBusy(false);
  }

  async function reviewAndPost(text: string, parentId: string | null) {
    if (!feed) return;
    setBusy(true);
    setError("");
    const request = await communityApi<GuardPreview & { error?: string }>("/api/communities/guard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!request) {
      setError("Kiki Guard could not review your draft. Check your connection and try again.");
      setBusy(false);
      return;
    }
    const { ok, result: review } = request;
    if (!ok) {
      setError(messageForError(review.error ?? ""));
      setBusy(false);
      return;
    }
    if (review.decision === "redact") {
      setPendingDraft({ text, safeText: review.safeText, reason: review.reason, parentId });
      setBusy(false);
      return;
    }
    await publishMessage(text, parentId);
  }

  async function toggleReaction(postId: string, reaction: ReactionType) {
    setBusy(true);
    setError("");
    const request = await communityApi<{ error?: string }>("/api/communities/reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, reaction }),
    });
    if (!request?.ok) setError(messageForError(request?.result.error ?? "network_unavailable"));
    else if (activeSlug) await loadFeed(activeSlug);
    setBusy(false);
  }

  async function createCommunity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const request = await communityApi<{ id?: string; slug?: string; error?: string; reason?: string; noticeSent?: boolean }>("/api/communities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!request) {
      setError("The community could not be created. Check your connection and try again.");
      setBusy(false);
      return;
    }
    const { ok, result } = request;
    if (!ok || !result.slug) {
      if (result.error === "guarded_community" && result.noticeSent === false) setError(`${result.reason ?? "Kiki Guard could not approve this community."} The guard notification could not be sent.`);
      setBusy(false);
      return;
    }
    setForm({ name: "", description: "", scope: "" });
    await loadCommunities();
    openCommunity(result.slug);
    setBusy(false);
  }

  const selectedCommunity = communities.find((item) => item.slug === activeSlug);
  const joinedCommunities = communities.filter((item) => item.isMember);
  const filteredCommunities = communities.filter((community) => {
    const matchesQuery = `${community.name} ${community.description} ${community.scope}`.toLowerCase().includes(discoverQuery.trim().toLowerCase());
    const matchesFilter = discoverFilter === "all" || (discoverFilter === "kiki" ? community.isSystem : community.isMember);
    return matchesQuery && matchesFilter;
  });
  const memberCount = feed ? communities.find((item) => item.slug === feed.community.slug)?.memberCount ?? 0 : 0;

  return <section className="kiki-communities-page">
    <section className="kiki-community-stories" aria-label="Your communities">
      <div className="kiki-community-story-rail">
        {joinedCommunities.map((community) => <button key={community.id} type="button" className="kiki-community-story" aria-current={activeSlug === community.slug ? "true" : undefined} onClick={() => openCommunity(community.slug)}>
          <span className={`kiki-community-story-ring${community.isSystem ? " is-kiki" : ""}`}>
            <span className="kiki-community-story-core"><CommunityIcon iconKey={community.iconKey} size={22} /></span>
          </span>
          <span className="kiki-community-story-title">{community.name}</span>
        </button>)}
        <button type="button" className="kiki-community-story" onClick={() => setTab("discover")}>
          <span className="kiki-community-story-ring is-explore"><span className="kiki-community-story-core"><Users size={21} aria-hidden="true" /></span></span>
          <span className="kiki-community-story-title">Explore</span>
        </button>
      </div>
    </section>

    <nav className="kiki-communities-tabs" aria-label="Community sections">
      {tabLabels.map((item) => <button key={item.value} type="button" aria-pressed={tab === item.value} onClick={() => { setTab(item.value); setError(""); setNotice(""); }}>
        {item.label}
      </button>)}
    </nav>

    {error && <p className="kiki-communities-alert" role="alert">{error}</p>}
    {notice && <p className="kiki-communities-notice" role="status">{notice}</p>}

    <div className="kiki-communities-tab-content">
    {tab === "feed" && <>
      {joinedCommunities.length > 0 && <div className="kiki-communities-switcher" aria-label="Your communities">
        {joinedCommunities.map((community) => <button key={community.id} type="button" aria-pressed={activeSlug === community.slug} onClick={() => openCommunity(community.slug)}>
          <CommunityIcon iconKey={community.iconKey} size={15} />{community.name}
        </button>)}
        <button type="button" className="kiki-communities-explore" onClick={() => setTab("discover")}>+ Explore</button>
      </div>}
      {loading || feedLoading ? <p className="kiki-communities-loading" role="status">Loading community…</p> : feed && !feed.isMember ? <article className="kiki-community-scope-card">
        <div className="kiki-community-card-icon"><CommunityIcon iconKey={feed.community.iconKey} /></div>
        <h2>{feed.community.name}</h2>
        <p>{feed.community.description}</p>
        <h3>Community scope</h3>
        <p>{feed.community.scope}</p>
        <button type="button" disabled={busy} onClick={() => void joinCommunity(communities.find((item) => item.id === feed.community.id) ?? { ...feed.community, memberCount: 0, isMember: false, pseudonym: null, welcomeReadAt: null, mutedUntil: null })}>Join community</button>
      </article> : feed ? <>
        <div className={`kiki-community-hero is-${feed.community.iconKey}`}>
          <span className="kiki-community-hero-glow" aria-hidden="true" />
          <div className="kiki-community-hero-main">
            <span className="kiki-community-hero-icon"><CommunityIcon iconKey={feed.community.iconKey} size={24} /></span>
            <div className="kiki-community-hero-copy">
              <div><h1>{feed.community.name}</h1>{feed.community.isSystem && <span className="kiki-community-system-badge">Kiki community</span>}</div>
              <p>{feed.community.description}</p>
            </div>
          </div>
          <div className="kiki-community-hero-meta">
            <span><i aria-hidden="true" />{memberCount.toLocaleString()} members</span>
            <span className="kiki-community-hero-privacy"><LockKeyhole size={13} aria-hidden="true" />Anonymous by default</span>
          </div>
        </div>

        {feed.pseudonym && <section className="kiki-community-alias-card">
          <span className="kiki-community-alias-icon"><CommunityIcon iconKey={feed.community.iconKey} size={22} /></span>
          <span className="kiki-community-alias-copy"><small>Your community alias</small><strong>{feed.pseudonym}</strong></span>
          <span className="kiki-community-alias-badge"><LockKeyhole size={13} aria-hidden="true" />Cloaked</span>
          <p>Your nickname is unique to this community. Your profile and real name are never shown.</p>
        </section>}

        {feed.welcomeRequired ? <section className="kiki-community-welcome-card">
          <div className="kiki-community-welcome-title"><ShieldCheck size={17} aria-hidden="true" />Kiki · Welcome &amp; scope</div>
          <p>Welcome. You’re anonymous here under a community nickname. Kiki Guard checks every post and reply before it is shared.</p>
          {feed.posts.map((post) => <p className="kiki-community-welcome-message" key={post.id}>{post.body}</p>)}
          <div className="kiki-community-scope-note"><strong>Community scope:</strong> {feed.community.scope}</div>
          <button type="button" disabled={busy} onClick={() => void acknowledgeWelcome()}>I understand — continue</button>
        </section> : <div className="kiki-community-scope-active"><ShieldCheck size={16} aria-hidden="true" /><span>Scope active · General guidance only</span><LockKeyhole size={14} aria-hidden="true" /></div>}

        {!feed.welcomeRequired && <>
          {feed.mutedUntil && feed.mutedUntil > new Date().toISOString() && <p className="kiki-communities-alert" role="status">Posting is paused until {new Date(feed.mutedUntil).toLocaleString()}.</p>}
          {feed.canPost && !replyingTo && <form className="kiki-community-composer" onSubmit={(event) => { event.preventDefault(); void reviewAndPost(draft, null); }}>
            <label htmlFor="community-post"><span className="kiki-community-composer-avatar"><CommunityIcon iconKey={feed.community.iconKey} size={15} /></span><span>Share a tip as <strong>{feed.pseudonym ?? "your community alias"}</strong></span></label>
            <textarea id="community-post" value={draft} maxLength={3000} onChange={(event) => setDraft(event.target.value)} placeholder="Share a calm, general safety habit (no names or addresses)..." required />
            <div className="kiki-community-composer-footer"><small><ShieldCheck size={14} aria-hidden="true" />Kiki Guard preview ready · {draft.length}/3000</small><button type="submit" disabled={busy || !draft.trim()}>{busy ? "Reviewing…" : "Review & post"}</button></div>
          </form>}
          {pendingDraft && <aside className="kiki-community-guard-preview" aria-label="Kiki Guard review">
            <h3><ShieldCheck size={18} aria-hidden="true" /> Kiki Guard found details to remove</h3>
            <p>{pendingDraft.reason}</p>
            <blockquote>{pendingDraft.safeText}</blockquote>
            <div><button type="button" className="secondary" disabled={busy} onClick={() => setPendingDraft(null)}>Edit message</button><button type="button" disabled={busy} onClick={() => void publishMessage(pendingDraft.text, pendingDraft.parentId)}>Post safe version</button></div>
          </aside>}
          <div className="kiki-community-insights-heading"><h2>Community insights</h2><span><ShieldCheck size={13} aria-hidden="true" />Moderated by Kiki Guard</span></div>
          {feed.posts.length === 0 && <div className="kiki-communities-empty"><Lightbulb size={24} aria-hidden="true" /><p>No posts yet. Share a general safety tip to start the conversation.</p></div>}
          <div className="kiki-community-post-list">
            {feed.posts.map((post) => <article className="kiki-community-post" key={post.id}>
              <div className="kiki-community-post-head">
                <span className={`kiki-community-post-avatar${post.isKiki ? " is-kiki" : ""}`}>{post.isKiki ? <ShieldCheck size={17} aria-hidden="true" /> : <Users size={16} aria-hidden="true" />}</span>
                <span className="kiki-community-post-author-copy"><strong>{post.authorAlias}{post.isKiki && <span className="kiki-community-system-badge">Official</span>}</strong><small>{formatCommunityTime(post.createdAt)} · {post.type.replaceAll("_", " ")}</small></span>
              </div>
              <p className="kiki-community-post-body">{post.body}</p>
              <div className="kiki-community-post-actions">
                {([
                  ["support", "Helpful", Heart],
                  ["thanks", "Thanks", HeartHandshake],
                  ["care", "Care", Heart],
                ] as const).map(([reaction, label, Icon]) => <button type="button" key={reaction} aria-pressed={post.reactions.mine.includes(reaction)} disabled={busy} onClick={() => void toggleReaction(post.id, reaction)}>
                  <Icon size={15} aria-hidden="true" /> <span>{label}</span><b>{post.reactions[reaction]}</b>
                </button>)}
                <button type="button" className="kiki-community-reply-action" onClick={() => { setReplyingTo(replyingTo === post.id ? null : post.id); setPendingDraft(null); }}><MessageCircle size={15} aria-hidden="true" /> <span>Reply</span><b>{post.comments.length}</b></button>
              </div>
              {post.comments.map((comment) => <div className="kiki-community-comment" key={comment.id}><p className="kiki-community-post-author">{comment.isKiki && <ShieldCheck size={15} aria-hidden="true" />}{comment.authorAlias}{comment.isKiki && <span className="kiki-community-system-badge">Kiki</span>}</p><p>{comment.body}</p></div>)}
              {replyingTo === post.id && <form className="kiki-community-reply" onSubmit={(event) => { event.preventDefault(); void reviewAndPost(draft, post.id); }}>
                <label htmlFor={`reply-${post.id}`}>Reply anonymously</label><textarea id={`reply-${post.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={3000} required />
                <div><button type="button" className="secondary" onClick={() => setReplyingTo(null)}>Cancel</button><button type="submit" disabled={busy || !draft.trim()}>Review reply</button></div>
              </form>}
            </article>)}
          </div>
        </>}
      </> : !loading && selectedCommunity ? <p className="kiki-communities-loading">Choose a community to open its feed.</p> : null}
    </>}

    {tab === "discover" && <section className="kiki-community-discover">
      <header className="kiki-community-section-heading"><h1>Discover safe circles</h1><p>Browse public, anonymous communities moderated by Kiki Guard.</p></header>
      <label className="kiki-community-search"><span className="sr-only">Search communities</span><Users size={17} aria-hidden="true" /><input value={discoverQuery} onChange={(event) => setDiscoverQuery(event.target.value)} placeholder="Search communities..." /></label>
      <div className="kiki-community-filter-row" role="group" aria-label="Filter communities">
        {([["all", "All"], ["kiki", "Kiki"], ["joined", "Joined"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={discoverFilter === value} onClick={() => setDiscoverFilter(value)}>{label}</button>)}
      </div>
      <div className="kiki-communities-list">
        {filteredCommunities.map((community) => <article className="kiki-community-discovery-card" key={community.id}>
          <div className={`kiki-community-discovery-icon is-${community.iconKey}`}><CommunityIcon iconKey={community.iconKey} size={22} /></div>
          <div className="kiki-community-discovery-copy"><h2>{community.name}{community.isSystem && <span className="kiki-community-system-badge">Kiki</span>}</h2><p>{community.description}</p>
            {community.isMember && community.pseudonym && <small>Your alias: <strong>{community.pseudonym}</strong></small>}
          </div>
          <div className="kiki-community-discovery-scope"><span><Users size={13} aria-hidden="true" />{community.memberCount.toLocaleString()} members</span><p>{community.scope}</p></div>
          <button type="button" disabled={busy} onClick={() => community.isMember ? openCommunity(community.slug) : void joinCommunity(community)}>{community.isMember ? "Open" : "Join"}</button>
        </article>)}
        {filteredCommunities.length === 0 && <div className="kiki-communities-empty"><Users size={22} aria-hidden="true" /><p>No communities match this search.</p></div>}
      </div>
    </section>}

    {tab === "guard" && <section className="kiki-community-guard-page">
      <div className="kiki-community-guard-hero"><span><ShieldCheck size={24} aria-hidden="true" /></span><div><small>100% on-device preview</small><h2>Your privacy comes first</h2><p>Kiki Guard checks community posts and replies before they’re shared. Your draft isn’t sent to an AI service.</p></div></div>
      <div className="kiki-community-guard-rules"><h3>What Kiki Guard checks</h3><ul><li><ShieldCheck size={16} aria-hidden="true" />Names and identifying details about you or another person</li><li><ShieldCheck size={16} aria-hidden="true" />Addresses, live locations, and precise coordinates</li><li><ShieldCheck size={16} aria-hidden="true" />Phone numbers, email addresses, social handles, and external links</li><li><ShieldCheck size={16} aria-hidden="true" />Whether a message is personal disclosure or general safety guidance</li></ul><p>Risky details are removed when the message remains clear; otherwise it is not posted. Repeated severe violations may pause posting temporarily.</p></div>
      <h3 className="kiki-community-history-title">Recent checks</h3>
      {events.length ? events.map((event, index) => <article className="kiki-community-guard-event" key={`${event.created_at}-${index}`}><ShieldCheck size={17} aria-hidden="true" /><div><strong>{event.decision === "redacted" ? "Private details removed" : "Message not posted"}</strong><p>{event.categories.map((category) => category.replaceAll("_", " ")).join(", ")} · {new Date(event.created_at).toLocaleString()}</p></div></article>) : <p className="kiki-communities-empty">No recent checks. Kiki Guard will show a notice here when it removes or refuses risky details.</p>}
    </section>}

    {tab === "create" && <section className="kiki-community-create-page">
      <header className="kiki-community-section-heading"><h1>Create a community</h1><p>Public, anonymous, and protected by Kiki Guard.</p></header>
      <div className="kiki-community-create-note">Communities have no following or direct messaging. Kiki’s privacy rules apply to all posts and replies.</div>
      <form className="kiki-community-create-form" onSubmit={(event) => void createCommunity(event)}>
        <label>Community name<input value={form.name} minLength={2} maxLength={60} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required placeholder="e.g., Campus Night Safety" /></label>
        <label>Description<textarea value={form.description} maxLength={280} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} required placeholder="Short summary of what members share here..." /></label>
        <label>Community scope &amp; privacy expectations<textarea value={form.scope} minLength={10} maxLength={500} onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value }))} placeholder="What kind of general discussion belongs here? Include privacy expectations." required /></label>
        <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create community"}</button>
      </form>
    </section>}
    </div>
  </section>;
}
