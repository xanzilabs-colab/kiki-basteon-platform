# Virtual Walk Audio

One live audio room is reserved per Bubble. The caller and the first answering
Buddy are the two audio participants; additional group members see the room's
occupied status, but cannot listen, signal, or obtain relay credentials. This is
not a mesh group conference. Ending the room allows a different pair to call.

The walk row's `mode = 'audio'` describes the session, not a shared mic setting.
Each participant defaults to open mic and independently chooses walkie-talkie.
Mode and transmission status travel over the WebRTC data channel. No audio is
stored. Microphone access requires HTTPS (or localhost) and explicit Start/Answer.
Hidden pages mute; blur, pointer cancellation, and a 30-second hold limit release
press-to-talk. Page exit stops tracks immediately and attempts a keepalive end.

## Deployment

The new migration is `20261025000000_buddy_virtual_walk_audio.sql`; it depends on
the account checks in migration `20261024000000`. It has not been applied by this
implementation. Use Supabase Realtime private Broadcast authorization with the
included `realtime.messages` policies. Disable public Realtime channels in project
settings. Audit existing broad policies: permissive policies are OR-combined, so
another unrestricted broadcast policy must not bypass these topic restrictions.

All database operations use the authenticated server client and SECURITY DEFINER
RPCs, not direct table reads. Private topics include Bubble, call, and sender IDs;
only that sender may broadcast, and only the two current participants may receive.
Realtime permissions can be cached for a subscription; lifecycle RPC checks and
heartbeats also enforce current membership. Ringing expires after 90 seconds;
either participant missing heartbeats expires an active room after 45 seconds.
Reads and new call attempts clean expired rows; closure and member-leave triggers
end live rooms. There is no scheduled background cleanup job.

STUN is always returned to authorized participants. Optional server-only relay
settings (never use NEXT_PUBLIC variables):

- `BUDDY_TURN_URLS`: comma-separated `turn:` / `turns:` URLs.
- `BUDDY_TURN_USERNAME`: relay username.
- `BUDDY_TURN_CREDENTIAL`: relay password.

Without TURN, restricted/mobile networks may not connect. The configured relay
credentials are returned only after the participation RPC succeeds; provision
scoped/short-lived relay credentials according to your TURN provider. These env
values themselves are static and are not automatically rotated by this app.

## Verification

Run `npm test -- src/lib/buddies/audio/__tests__` and `npx tsc --noEmit`.
In a test Supabase project after a separately authorized migration deployment,
use two signed-in browsers to check Start/Answer, mic modes, remote playback,
hidden-tab muting, end/leave, and relay connectivity. Use a third Bubble member
to verify occupied-room UI and denied signalling/ICE. Check nonmember and
signed-out access, simultaneous answers, expiry, and reconnect after a lost peer.
Unit tests and TypeScript alone do not prove deployed RLS or actual audio delivery.