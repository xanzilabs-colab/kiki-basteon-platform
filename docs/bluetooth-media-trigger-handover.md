# Bluetooth media-trigger diagnostic handover

## Purpose

This handover separates historical observations with the user's Volkano Pulse
earbuds from Kiki's new device-agnostic, signature-based trigger design. The
historical click mapping is no longer used to fire alerts. Do not treat either
the old mapping or one accessory's event signatures as a universal Bluetooth
rule.

## Confirmed device observations

- Device under test: Bluetooth earbuds identified by the user as **Volkano
  Pulse series**. The exact hardware revision and firmware were not recorded.
- The Android media-session callback delivered `KEYCODE_MEDIA_PAUSE` for one
  tap and `KEYCODE_MEDIA_PREVIOUS` for the tested double-tap. Kiki's original
  listener counted each delivered key event as one click, so both gestures
  appeared as one click even though Android and the music player reacted to
  them differently.
- Three-tap testing was reported to produce a volume-key event (the user
  observed master volume changing); a short hold opened the voice assistant.
  Kiki did not receive a distinct hold event in the captured logs. The exact
  volume key code and hold behavior should be rechecked against native logs on
  the physical earbuds before relying on them.
- The former workaround weighted `MEDIA_PAUSE` as one click,
  `MEDIA_PREVIOUS` as two, and volume keys as three. Those global click weights
  are now legacy settings only; the signature matcher does not use them.
- With those click mappings assigned to actions, the user confirmed that
  alerts work when Practice/Test mode is off and the phone is armed for live
  alerts.

## Current signature-based design

1. In Trigger Lab, start Practice and run the calibration wizard. It captures
   repeated normalized input signatures, groups timings, reports reliability
   and ambiguity, and offers recommendations. Assign only signatures actually
   observed; SOS and Cancel are mandatory before verification. Practice cannot
   call the alert gateway.
2. A draft is saved in encrypted Android preferences. The user must perform
   every assigned action three consecutive times while Kiki's native matcher
   reports a unique match. A non-hit clears verification progress. Imported
   profiles are always unverified and must be verified on this phone.
3. Verified profiles are matched by normalized event sequence, not tap weights.
   The sequence engine merges duplicate key/session reports, combines volume
   changes when Android broadcasts them, recognizes a hold only if a distinct
   native hold signal arrives, and uses profile timing. Ambiguous, unmatched,
   and unverified gestures do not fire.
4. Live arming is blocked unless a connected accessory (or an explicit global
   profile with an audio output) has a fresh verified profile with SOS and
   Cancel. Verification expires after 90 days and becomes stale after app or
   Android-version changes. Test mode remains separate; Practice disarms the
   live service.
5. Profiles can be exported/imported and backed up to the signed-in account's
   server record. The server stores mappings, observed signatures and timing
   samples, never the Android trigger bearer token. Profile backup requires an
   active registered Android trigger; deleting all local profiles synchronizes
   an empty backup.
6. Compatibility reports have a separate explicit-consent action. They submit
   only phone model, Android SDK, accessory category and aggregate signatures,
   reliability, and grade. They exclude accessory names/IDs, addresses, raw
   traces, alert data, and location. A temporary hash of the request IP is used
   for rate limiting and is not saved with the report.

The native foreground service receives media key/session/volume inputs, forms
the signature, and POSTs a unique verified match to `/api/trigger/fire`. In
Test mode, the server records the test press but does not create an active
alert, countdown, or push. For a live alert, the response exposes bounded push
gateway counts/status to the native diagnostic log. “Accepted” means the push
gateway accepted the request, **not** that a responder's device received it.
The alert server remains the source of truth for pending/cancelled/promoted
state.

## Cancellation behavior

The notification's Cancel action sends `/api/trigger/cancel`. The server only
cancels a pending, unpromoted alert whose countdown has not expired. A 404
means there is no longer a cancellable pending alert; it does not mean that a
previously activated alert was withdrawn.

The Android receiver now dismisses the local countdown immediately on tap,
then reports the server result in a follow-up notification. A confirmed
`{ "ok": true }` reports “Alert cancelled.” A missing pending countdown reports
that it may already be active; transport or server failures warn that
cancellation could not be confirmed. The local countdown also expires
automatically at its configured deadline. The updated APK has been built and
installed on the connected phone; installation may stop the foreground
service, so re-arm in live mode before manually verifying confirmed
cancellation, already-active/expired alerts, and network failure with a safe
test alert. Server semantics are unchanged.

## Known limits / not yet validated

- Only the described Volkano Pulse behavior has been reported as tested.
  Other earbud brands/models, Android versions, watches, car controls, steering
  wheel buttons, speakers, USB headsets, and accessibility/remapping devices
  remain **unverified**.
- Android delivers media-session key events, not a standardized count of
  physical taps. Vendors may encode multi-tap as distinct keys, repeated
  down/up events, delayed single-tap events, or device-specific sequences.
- The new profile flow and code have not yet established physical-device
  compatibility across accessory models. The Volkano user's historical events
  are not an independent validation of the new signature capture/matcher.
- The observed short hold/assistant action was not represented as a distinct
  event in the captured Kiki input log. Long-press detection must not be
  advertised for a device until its actual callback sequence is captured and
  confirmed.
- A successful live-fire HTTP response means the server accepted a pending
  alert; it is not evidence that every responder received a push. Confirm
  server-side alert state and delivery separately during future diagnosis.

## Recommended follow-up investigation

For every accessory profile, collect a repeatable trace of raw media key
events (key code, action/down-up, event and receipt timestamps, repeat count,
device metadata when Android exposes it), then compare it against the physical
gesture and the media player's response. Test at least single, double, triple,
long press, rapid repeats, and two gestures near the sequence timeout. Repeat
with screen locked, screen on, music playing/paused, and the Kiki service
restarted.

Continue validating the device-agnostic configurator against **observed event
sequences**, not brand-name assumptions or fixed key weights:

- Let a user capture and review raw event sequences per action; expose the
  timing window and show ambiguous/overlapping captures before saving.
- Store mappings per accessory/profile (and OS/app version where useful),
  support edits, reset, import/export, and an explicit fallback profile.
- Keep Practice isolated from live alerting, visibly distinguish test from
  live mode, and require an explicit arm/live transition.
- Preserve a diagnostic log that separates native input, local pattern match,
  server acceptance, pending-alert state, and push-gateway outcomes. Do not
  label gateway acceptance as confirmed device delivery without receipts.
- For car controls and other media buttons, capture their actual Android
  events first; do not assume they emit the same keys or support multiple taps.
- Validate cancellation on time, after expiry, after server promotion, with
  network loss, and with concurrent actions. Treat server confirmation as the
  source of truth; never imply an alert was withdrawn when cancellation was
  not confirmed.

## Relevant implementation locations

- `basteon/android/app/src/main/java/za/co/xanzi/kiki/KikiTriggerService.kt`:
  media-session/key/volume input, signature timing, fire/cancel requests, and
  notifications.
- `basteon/android/app/src/main/java/za/co/xanzi/kiki/gesture/GestureEngine.kt`:
  event normalization, deduplication, sequencing, and signature matching.
- `basteon/android/app/src/main/java/za/co/xanzi/kiki/gesture/GestureProfiles.kt`:
  encrypted local profiles, connected-device selection, live readiness, and
  native verification progress.
- `basteon/src/components/GestureCalibrationPanel.tsx` and
  `basteon/src/lib/triggerGestures/analyze.ts`: calibration, review, trust
  analysis, profile import/export, and opt-in compatibility sharing.
- `basteon/src/app/api/trigger/profiles/route.ts` and
  `basteon/src/app/api/trigger/compat/route.ts`: authenticated profile backup
  and anonymous opt-in compatibility reports.
- `basteon/src/lib/push.ts` and
  `basteon/src/app/api/trigger/fire/route.ts`: push gateway outcome counts and
  live alert acceptance.
- `basteon/android/app/src/main/java/za/co/xanzi/kiki/TriggerCancelReceiver.kt`:
  notification cancellation action and result feedback.
- `basteon/android/app/src/main/java/za/co/xanzi/kiki/DeviceTracker.kt`:
  tracked device metadata and sync payload (if device-specific profiles are
  implemented, review what metadata Android actually exposes first).
- `basteon/src/components/TriggerLab.tsx` and
  `basteon/src/components/EarbudTriggerCard.tsx`: Practice/live controls and
  the native-profile live gate.
- `basteon/src/app/api/trigger/fire/route.ts` and
  `basteon/src/app/api/trigger/cancel/route.ts`: server fire/cancel endpoints.
- `basteon/supabase/migrations/20261113000000_trigger_gesture_profiles.sql`:
  profile backup/compatibility tables and fire metadata.
- `basteon/supabase/migrations/20261111000600_trigger_gateway_bluetooth.sql`:
  server-side pending-alert cancellation semantics.
