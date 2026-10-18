"use client";

import { Check, Copy, UserMinus, UserPlus, UserRoundX, Users } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CachedProfileImage } from "@/components/CachedProfileImage";

type Buddy = { id: string; kikiId: string; name: string; avatarUrl: string | null };
type BuddyRequest = { requestId: string; createdAt: string; buddy: Buddy | null };
type BuddyData = {
  kikiId: string;
  buddies: Buddy[];
  incoming: BuddyRequest[];
  outgoing: BuddyRequest[];
  blocked: Buddy[];
};

async function responseData(response: Response) {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

function displayError(value: unknown) {
  const messages: Record<string, string> = {
    invalid_kiki_id: "Enter a valid Kiki ID.",
    buddy_not_found: "No account was found for that Kiki ID.",
    cannot_add_self: "You cannot add your own account as a buddy.",
    already_connected: "You’re already connected.",
    request_already_pending: "A request is already waiting for them.",
    incoming_request_exists: "They already sent you a request. Accept it below.",
    blocked: "This connection cannot be made.",
    invalid_buddy: "That buddy could not be found.",
    not_connected: "You are no longer connected to this person.",
  };
  return typeof value === "string" ? messages[value] ?? "That action could not be completed. Please try again." : "That action could not be completed. Please try again.";
}

function BuddyIdentity({ buddy }: { buddy: Buddy }) {
  return (
    <span className="kiki-buddy-identity">
      <CachedProfileImage
        src={buddy.avatarUrl}
        alt={`${buddy.name}'s profile`}
        fallback={<span aria-hidden="true">{buddy.name.charAt(0).toUpperCase()}</span>}
      />
      <span>
        <b>{buddy.name}</b>
        <small>{buddy.kikiId}</small>
      </span>
    </span>
  );
}

export function BuddyManager() {
  const [data, setData] = useState<BuddyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState<Buddy | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/account/buddies", { cache: "no-store" });
      const result = await responseData(response);
      if (!response.ok) {
        setError(displayError(result.error));
        return;
      }
      setData(result as unknown as BuddyData);
    } catch {
      setError("Could not load your buddy list. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function searchBuddy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCandidate(null);
    setMessage("");
    setError("");
    setSearching(true);
    try {
      const response = await fetch("/api/account/buddies/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kikiId: query }),
      });
      const result = await responseData(response);
      if (!response.ok) {
        setError(displayError(result.error));
        return;
      }
      setCandidate(result.buddy as Buddy);
      if (result.connected) setMessage("You’re already connected to this buddy.");
    } catch {
      setError("Could not search for that buddy. Check your connection and try again.");
    } finally {
      setSearching(false);
    }
  }

  async function sendRequest() {
    if (!candidate) return;
    setBusy("send");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/buddies/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kikiId: candidate.kikiId }),
      });
      const result = await responseData(response);
      if (!response.ok) {
        setError(displayError(result.error));
        if (result.error === "incoming_request_exists") await load();
        return;
      }
      setMessage(`Buddy request sent to ${candidate.name}.`);
      setCandidate(null);
      setQuery("");
      await load();
    } catch {
      setError("Could not send the buddy request. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  async function answerRequest(requestId: string, accept: boolean) {
    setBusy(requestId);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/buddies/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, accept }),
      });
      const result = await responseData(response);
      if (!response.ok) {
        setError(displayError(result.error));
        return;
      }
      setMessage(accept ? "Buddy request accepted." : "Buddy request declined.");
      await load();
    } catch {
      setError("Could not update the buddy request. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  async function relationshipAction(userId: string, action: "remove" | "block" | "unblock") {
    const target = action === "remove" ? data?.buddies.find((buddy) => buddy.id === userId)?.name : undefined;
    if (action === "remove" && !window.confirm(`Remove ${target ?? "this buddy"} from your buddy list?`)) return;
    if (action === "block" && !window.confirm("Block this person? They will be removed from your buddy list and cannot request to connect again unless you unblock them.")) return;

    setBusy(userId);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/account/buddies/${encodeURIComponent(userId)}`, {
        method: action === "remove" ? "DELETE" : action === "block" ? "POST" : "PATCH",
      });
      const result = await responseData(response);
      if (!response.ok) {
        setError(displayError(result.error));
        return;
      }
      setMessage(action === "remove" ? "Buddy removed." : action === "block" ? "Person blocked." : "Person unblocked.");
      await load();
    } catch {
      setError("Could not update this buddy. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  async function copyId() {
    if (!data?.kikiId) return;
    try {
      await navigator.clipboard.writeText(data.kikiId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy your ID. Select it and copy it manually.");
    }
  }

  return (
    <div className="kiki-setting-page kiki-buddy-manager">
      <header>
        <span>MY ACCOUNT</span>
        <h1>My Buddies</h1>
        <p>Connect with people you know. Requests must be accepted before you can invite each other to games or walks.</p>
      </header>

      <section aria-labelledby="kiki-buddy-id-title">
        <h2 id="kiki-buddy-id-title"><Users size={18} />Your Kiki ID</h2>
        <p>Share this ID with someone you trust so they can find you. Your email, phone number and location are not shown.</p>
        <div className="kiki-buddy-share-id">
          <code>{loading ? "Loading…" : data?.kikiId ?? "Unavailable"}</code>
          <button className="btn" type="button" disabled={!data?.kikiId} onClick={() => void copyId()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy ID"}
          </button>
        </div>
      </section>

      <section aria-labelledby="kiki-buddy-add-title">
        <h2 id="kiki-buddy-add-title"><UserPlus size={18} />Add a buddy</h2>
        <p>Enter the Kiki ID they shared with you. Check the name and profile before you send a request.</p>
        <form className="kiki-buddy-search" onSubmit={(event) => void searchBuddy(event)}>
          <label htmlFor="kiki-buddy-id">Kiki ID</label>
          <input
            id="kiki-buddy-id"
            className="input"
            autoComplete="off"
            placeholder="KIKI-0123456789ABCDEF"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setCandidate(null); }}
          />
          <button className="btn btn-primary" type="submit" disabled={searching || !query.trim()}>
            {searching ? "Searching…" : "Find person"}
          </button>
        </form>
        {candidate && (
          <div className="kiki-buddy-result">
            <BuddyIdentity buddy={candidate} />
            <button type="button" className="btn btn-primary" onClick={() => void sendRequest()} disabled={busy === "send"}>
              {busy === "send" ? "Sending…" : "Send request"}
            </button>
          </div>
        )}
      </section>

      {message && <p className="kiki-buddy-message" role="status">{message}</p>}
      {error && <p className="kiki-buddy-error" role="alert">{error}</p>}

      <section aria-labelledby="kiki-buddy-incoming-title">
        <h2 id="kiki-buddy-incoming-title">Requests for you <span className="kiki-buddy-count">{data?.incoming.length ?? 0}</span></h2>
        {loading ? <p>Loading requests…</p> : !data?.incoming.length ? <p>No pending requests.</p> : (
          <ul className="kiki-buddy-list">
            {data.incoming.map((request) => request.buddy && (
              <li key={request.requestId}>
                <BuddyIdentity buddy={request.buddy} />
                <div className="kiki-buddy-actions">
                  <button type="button" className="btn btn-primary" disabled={busy === request.requestId} onClick={() => void answerRequest(request.requestId, true)}>Accept</button>
                  <button type="button" className="btn" disabled={busy === request.requestId} onClick={() => void answerRequest(request.requestId, false)}>Decline</button>
                  <button type="button" className="btn kiki-buddy-danger" aria-label={`Block ${request.buddy.name}`} disabled={busy === request.buddy.id} onClick={() => void relationshipAction(request.buddy!.id, "block")}><UserRoundX size={15} />Block</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="kiki-buddy-list-title">
        <h2 id="kiki-buddy-list-title">Your buddy list <span className="kiki-buddy-count">{data?.buddies.length ?? 0}</span></h2>
        <p>Accepted buddies can be selected when you invite people to multiplayer games or walks.</p>
        {loading ? <p>Loading buddies…</p> : !data?.buddies.length ? <p>Your buddy list is empty. Add someone using their Kiki ID.</p> : (
          <ul className="kiki-buddy-list">
            {data.buddies.map((buddy) => (
              <li key={buddy.id}>
                <BuddyIdentity buddy={buddy} />
                <div className="kiki-buddy-actions">
                  <button type="button" className="btn" disabled={busy === buddy.id} onClick={() => void relationshipAction(buddy.id, "remove")}><UserMinus size={15} />Remove</button>
                  <button type="button" className="btn kiki-buddy-danger" disabled={busy === buddy.id} onClick={() => void relationshipAction(buddy.id, "block")}><UserRoundX size={15} />Block</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="kiki-buddy-outgoing-title">
        <h2 id="kiki-buddy-outgoing-title">Sent requests <span className="kiki-buddy-count">{data?.outgoing.length ?? 0}</span></h2>
        {loading ? <p>Loading sent requests…</p> : !data?.outgoing.length ? <p>No requests waiting for a response.</p> : (
          <ul className="kiki-buddy-list">
            {data.outgoing.map((request) => request.buddy && (
              <li key={request.requestId}>
                <BuddyIdentity buddy={request.buddy} />
                <small>Waiting for acceptance</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {Boolean(data?.blocked.length) && (
        <section aria-labelledby="kiki-buddy-blocked-title">
          <h2 id="kiki-buddy-blocked-title">Blocked</h2>
          <ul className="kiki-buddy-list">
            {data?.blocked.map((buddy) => (
              <li key={buddy.id}>
                <BuddyIdentity buddy={buddy} />
                <button type="button" className="btn" disabled={busy === buddy.id} onClick={() => void relationshipAction(buddy.id, "unblock")}>Unblock</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && !data && <button className="btn" type="button" onClick={() => void load()}>Try again</button>}
    </div>
  );
}
