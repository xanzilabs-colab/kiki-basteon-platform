"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, HeartHandshake, Lightbulb, LockKeyhole, MapPinned, MessageCircle, ShieldCheck, Users } from "lucide-react";

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

  return <section className="kiki-communities-page">
    <header className="kiki-communities-heading">
      <span className="kiki-communities-spatial-label"><MapPinned size={14} aria-hidden="true" /> SOCIAL · SPATIAL · ANONYMOUS</span>
      <h1>Communities</h1>
      <p>Share practical ideas anonymously. There’s no following, public profile, or direct messaging.</p>
    </header>

    <nav className="kiki-communities-tabs" aria-label="Community sections">
      {tabLabels.map((item) => <button key={item.value} type="button" aria-pressed={tab === item.value} onClick={() => { setTab(item.value); setError(""); setNotice(""); }}>
        {item.label}
      </button>)}
    </nav>

    {error && <p className="kiki-communities-alert" role="alert">{error}</p>}
    {notice && <p className="kiki-communities-notice" role="status">{notice}</p>}

    {tab === "feed" && <>
      {joinedCommunities.length > 0 && <div className="kiki-communities-switcher" aria-label="Your communities">
        {joinedCommunities.map((community) => <button key={community.id} type="button" aria-pressed={activeSlug === community.slug} onClick={() => openCommunity(community.slug)}>
          {community.isSystem ? <ShieldCheck size={15} aria-hidden="true" /> : <Users size={15} aria-hidden="true" />}{community.name}
        </button>)}
      </div>}
      {loading || feedLoading ? <p className="kiki-communities-loading" role="status">Loading community…</p> : feed && !feed.isMember ? <article className="kiki-community-scope-card">
        <div className="kiki-community-card-icon"><Users size={20} aria-hidden="true" /></div>
        <h2>{feed.community.name}</h2>
        <p>{feed.community.description}</p>
        <h3>Community scope</h3>
        <p>{feed.community.scope}</p>
        <button type="button" disabled={busy} onClick={() => void joinCommunity(communities.find((item) => item.id === feed.community.id) ?? { ...feed.community, memberCount: 0, isMember: false, pseudonym: null, welcomeReadAt: null, mutedUntil: null })}>Join community</button>
      </article> : feed ? <>
        <header className="kiki-community-feed-heading">
          <div className="kiki-community-card-icon">{feed.community.isSystem ? <ShieldCheck size={20} aria-hidden="true" /> : <Users size={20} aria-hidden="true" />}</div>
          <div><h2>{feed.community.name}{feed.community.isSystem && <span className="kiki-community-system-badge">Kiki community</span>}</h2><p>{feed.community.description}</p></div>
        </header>
        <div className="kiki-community-spatial-scope"><MapPinned size={17} aria-hidden="true" /><span><small>Community scope</small><strong>{feed.community.scope}</strong></span></div>
        {feed.pseudonym && <p className="kiki-community-anonymity"><LockKeyhole size={16} aria-hidden="true" /> You’re <strong>{feed.pseudonym}</strong> in this community. Your nickname is different in each community; your profile and real name are never shown.</p>}
        {feed.welcomeRequired && feed.posts.map((post) => <article className="kiki-community-post kiki-community-welcome" key={post.id}>
          <p className="kiki-community-post-author"><ShieldCheck size={16} aria-hidden="true" /> Kiki · Welcome</p>
          <p className="kiki-community-post-body">{post.body}</p>
          <p className="kiki-community-scope-note">Community scope: {feed.community.scope}</p>
          <button type="button" disabled={busy} onClick={() => void acknowledgeWelcome()}>I understand — continue</button>
        </article>)}
        {!feed.welcomeRequired && <>
          {feed.mutedUntil && feed.mutedUntil > new Date().toISOString() && <p className="kiki-communities-alert" role="status">Posting is paused until {new Date(feed.mutedUntil).toLocaleString()}.</p>}
          {feed.canPost && !replyingTo && <form className="kiki-community-composer" onSubmit={(event) => { event.preventDefault(); void reviewAndPost(draft, null); }}>
            <label htmlFor="community-post">Share a general tip or question</label>
            <textarea id="community-post" value={draft} maxLength={3000} onChange={(event) => setDraft(event.target.value)} placeholder="Keep it general. Kiki Guard will check your message before it’s shared." required />
            <div className="kiki-community-composer-footer"><small>{draft.length}/3000 · Text only, no images or contact links</small><button type="submit" disabled={busy || !draft.trim()}>Review &amp; post</button></div>
          </form>}
          {pendingDraft && <aside className="kiki-community-guard-preview" aria-label="Kiki Guard review">
            <h3><ShieldCheck size={18} aria-hidden="true" /> Kiki Guard found details to remove</h3>
            <p>{pendingDraft.reason}</p>
            <blockquote>{pendingDraft.safeText}</blockquote>
            <div><button type="button" className="secondary" disabled={busy} onClick={() => setPendingDraft(null)}>Edit message</button><button type="button" disabled={busy} onClick={() => void publishMessage(pendingDraft.text, pendingDraft.parentId)}>Post safe version</button></div>
          </aside>}
          {feed.posts.length === 0 && <div className="kiki-communities-empty"><Lightbulb size={24} aria-hidden="true" /><p>No new posts yet. You’ll see posts shared after you read the welcome note.</p></div>}
          <div className="kiki-community-post-list">
            {feed.posts.map((post) => <article className="kiki-community-post" key={post.id}>
              <p className="kiki-community-post-author">{post.isKiki ? <ShieldCheck size={16} aria-hidden="true" /> : <span className="kiki-community-author-dot" aria-hidden="true" />}{post.authorAlias}{post.isKiki && <span className="kiki-community-system-badge">Kiki</span>}</p>
              <p className="kiki-community-post-body">{post.body}</p>
              <time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleString()}</time>
              <div className="kiki-community-post-actions">
                {([
                  ["support", "Support", Heart],
                  ["thanks", "Thanks", HeartHandshake],
                  ["care", "Care", Heart],
                ] as const).map(([reaction, label, Icon]) => <button type="button" key={reaction} aria-pressed={post.reactions.mine.includes(reaction)} disabled={busy} onClick={() => void toggleReaction(post.id, reaction)}>
                  <Icon size={16} aria-hidden="true" /> {label} {post.reactions[reaction]}
                </button>)}
                <button type="button" onClick={() => { setReplyingTo(replyingTo === post.id ? null : post.id); setPendingDraft(null); }}><MessageCircle size={16} aria-hidden="true" /> Reply {post.comments.length}</button>
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

    {tab === "discover" && <div className="kiki-communities-list">
      <p className="kiki-communities-intro">Every community is public and moderated. Read its scope before joining.</p>
      {communities.map((community) => <article className="kiki-community-discovery-card" key={community.id}>
        <div className="kiki-community-card-icon">{community.isSystem ? <ShieldCheck size={20} aria-hidden="true" /> : <Users size={20} aria-hidden="true" />}</div>
        <div className="kiki-community-discovery-copy"><h2>{community.name}{community.isSystem && <span className="kiki-community-system-badge">Kiki</span>}</h2><p>{community.description}</p><small><MapPinned size={13} aria-hidden="true" />{community.memberCount} members · {community.scope}</small></div>
        <button type="button" disabled={busy} onClick={() => community.isMember ? openCommunity(community.slug) : void joinCommunity(community)}>{community.isMember ? "Open" : "Join"}</button>
      </article>)}
    </div>}

    {tab === "guard" && <section className="kiki-community-guard-page">
      <div className="kiki-community-guard-hero"><span><ShieldCheck size={24} aria-hidden="true" /></span><div><h2>Your privacy comes first</h2><p>Kiki Guard screens every community post and reply on your device preview and again on the server. Your draft isn’t sent to an AI service.</p></div></div>
      <div className="kiki-community-guard-rules"><h3>What it checks</h3><ul><li>Names and identifying details about you or another person</li><li>Addresses, live locations, and precise coordinates</li><li>Phone numbers, email addresses, social handles, and external contact links</li><li>Whether a message is personal disclosure or general safety guidance</li></ul><p>General advice and public emergency numbers are allowed. Risky details are removed when the message remains clear; otherwise it is not posted. Repeated severe violations may pause posting temporarily.</p></div>
      <h3 className="kiki-community-history-title">Recent checks</h3>
      {events.length ? events.map((event, index) => <article className="kiki-community-guard-event" key={`${event.created_at}-${index}`}><ShieldCheck size={17} aria-hidden="true" /><div><strong>{event.decision === "redacted" ? "Private details removed" : "Message not posted"}</strong><p>{event.categories.map((category) => category.replaceAll("_", " ")).join(", ")} · {new Date(event.created_at).toLocaleString()}</p></div></article>) : <p className="kiki-communities-empty">No recent checks. Kiki Guard will show a notice here when it removes or refuses risky details.</p>}
    </section>}

    {tab === "create" && <form className="kiki-community-create-form" onSubmit={(event) => void createCommunity(event)}>
      <div className="kiki-community-guard-hero"><span><Users size={24} aria-hidden="true" /></span><div><h2>Create a community</h2><p>Communities are public and have no following or direct messages. Kiki’s privacy rules apply to all posts and replies.</p></div></div>
      <label>Community name<input value={form.name} minLength={2} maxLength={60} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required /></label>
      <label>Description<textarea value={form.description} maxLength={280} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} required /></label>
      <label>Community scope<textarea value={form.scope} minLength={10} maxLength={500} onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value }))} placeholder="What kind of general discussion belongs here? Include privacy expectations." required /></label>
      <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create community"}</button>
    </form>}
  </section>;
}
