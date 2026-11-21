# Interactive community posts

This document describes the interactive, media-rich anonymous community posts implemented in Basteon/Kiki.

## Architecture

- **Client:** Next.js app routes/components in `basteon/src/app/account/communities/*` and `basteon/src/components/CommunitiesHub.tsx`.
- **Server APIs:** Next.js route handlers in `basteon/src/app/api/communities/*` (repo convention). They authenticate the signed-in user, resolve community membership, enforce scope acknowledgement/rate limits, run Kiki Guard server-side, and use the Supabase service-role client for privileged reads/writes.
- **Database:** Supabase/Postgres migrations in `basteon/supabase/migrations/`, extending the existing `communities`, `community_memberships`, `community_posts`, `community_reactions`, and `community_moderation_events` tables.
- **Storage:** Private bucket `community-images` for JPEG/WebP community images. Image uploads are validated server-side and feed responses include short-lived signed URLs.
- **Guard:** Shared rules in `basteon/src/lib/communities/guardrails.ts` for live previews and server-side enforcement. Interactive posts and comments are refused or redacted before publication when risky details are detected.

## Post types

Supported post types: `post`, `carousel`, `poll`, `tt`, `slider`, `fill`, `cap`, `hot`, `quiz`, `mf`, `hunt`, `chal`, `ama`, `decide`, `path`.

- Votes for `poll`, `tt`, `decide`, and `hot` are changeable until the post closes.
- `quiz`, `mf`, and `slider` are one-shot interactions.
- `hunt` stores targets in `community_post_secrets`/`community_hunt_targets` and only reveals found target labels/positions to the member.
- `chal` supports join/leave and daily check-ins (Africa/Johannesburg day) with streaks.
- `ama` supports member questions and host answers.
- `decide` closes after `ends_at` and reveals results/tallies appropriately.
- `path` stores a bounded node graph in post config and records end-node visits.

## Main tables

Base/extended:
- `communities`, `community_memberships`, `community_posts`, `community_reactions`, `community_moderation_events`

Interactive additions:
- `community_post_media`
- `community_post_options`
- `community_post_secrets`
- `community_hunt_targets`
- `community_post_votes`
- `community_post_ratings`
- `community_post_comment_likes`
- `community_post_likes`
- `community_post_helpful`
- `community_challenge_enrollments`
- `community_challenge_checkins`
- `community_hunt_attempts`
- `community_hunt_found`
- `community_path_visits`
- `community_guard_events`
- `community_stories`
- `community_activity_seen`

## RPCs / server operations

Key DB functions added or extended in `20261121000000_community_interactive_posts.sql`:
- `create_community_interactive_post(p_payload jsonb)` - validates and inserts an interactive post, options, media, secrets/targets, and config.
- `community_interactive_vote(p_post_id, p_user_id, p_option_id)` - changeable votes for poll/tt/decide/hot, one-shot quiz/mf with reveal.
- `community_interactive_rate(p_post_id, p_user_id, p_value)` - one-shot slider rating.
- `community_interactive_challenge(p_post_id, p_user_id, p_checkin)` and `community_interactive_challenge_action(p_post_id, p_user_id, p_mode)` - join/leave/check-in.
- `community_interactive_hunt_guess(p_post_id, p_user_id, p_x, p_y)` - bounded guess attempts and found-target reveal.
- `community_interactive_path_finish(p_post_id, p_user_id, p_end_node)` - records path completion.

API routes:
- `GET /api/communities` - discover/list communities.
- `POST /api/communities` - create community (Guard checked).
- `POST /api/communities/:communityKey/join` - join community.
- `POST /api/communities/:communityKey/welcome` - acknowledge scope/welcome.
- `GET /api/communities/:communityKey/feed?group=...` - member feed, stories, signed media URLs, interactive state/results.
- `POST /api/communities/posts` - legacy/simple text post or reply.
- `POST /api/communities/interactive-posts` - create interactive/media-rich post.
- `POST /api/communities/media` - upload validated JPEG image for a draft interactive post.
- `POST /api/communities/comments` - replies, answers, AMA questions, host answers.
- `POST /api/communities/interactions` - vote/rate/challenge/hunt/path/comment-like actions.
- `POST /api/communities/reactions` - support/thanks/care reactions and like/helpful toggles.
- `GET|POST /api/communities/guard` - guard preview/history.

## Security and privacy notes

- Member aliases are per-community; real user IDs/names are not exposed in feed payloads.
- Scope acknowledgement is required before posting/interacting.
- Kiki Guard runs server-side on post/comment/host-answer text and stores guard events for recent checks.
- `community_post_secrets` and `community_hunt_targets` are not granted to anon/authenticated roles; sensitive quiz/hunt data is only revealed through server logic/RPCs.
- `community-images` is a private bucket; media access is provided via server-generated signed URLs.
- Images only (JPEG/WebP storage). Media upload route validates image bytes/dimensions and rejects sensitive metadata.

## Deploy / migration

1. Apply migrations in `basteon/supabase/migrations/` (including `20261121000000_community_interactive_posts.sql`).
2. Ensure Supabase Storage supports the `community-images` bucket.
3. Regenerate Supabase types if the project uses generated DB types.
4. Deploy the Next.js app so updated API routes and UI are available.

## Seed data

`basteon/supabase/seed/community_interactive_posts.sql` adds sample stories and one example per post type for development/demo environments. Seeded media rows reference placeholder storage paths; upload matching objects to `community-images` or adjust paths for local demos.

## Assumptions / mapping

- The implementation follows existing repo conventions (Next.js route handlers + service-role server access) rather than introducing new Supabase Edge Function folders.
- Existing anonymous community schema names (`community_posts`, `community_memberships`, etc.) were extended in place instead of replacing them with a parallel schema.
- "Official" posts are represented by `is_kiki` and controlled server-side; host actions are limited to the post author where moderator roles are not modeled.
- Client UI is being evolved in `CommunitiesHub.tsx`; some prototype-only chrome may be adapted to fit the existing account shell.