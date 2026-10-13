# Bluetooth media-trigger diagnostic handover

## Purpose

This handover records the confirmed behavior observed while testing Kiki's
earbud-trigger flow with the Volkano Pulse series, the device-specific change
that made those tests work, and the gaps the next investigation should address.
Do not treat the Volkano mapping as a universal Bluetooth rule.

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
- The applied device workaround weights `MEDIA_PAUSE` as one click,
  `MEDIA_PREVIOUS` as two, and `VOLUME_UP` / `VOLUME_DOWN` as three. This is an
  empirical mapping for the observed device behavior, not an Android guarantee.
- With those click mappings assigned to actions, the user confirmed that
  alerts work when Practice/Test mode is off and the phone is armed for live
  alerts.

## Current user-facing setup and alert flow

1. Open Trigger Lab / Universal click setup, start Practice, capture the
   earbuds' media-key sequence for each action, and tap Set. Captures are
   persisted in the phone's encrypted preferences. Setting a mapping enables
   Universal click mode; saved mappings are also enabled when Practice starts.
2. Practice is diagnostic only: while active, real alerts are disabled. The
   phone must leave Practice, have Test mode unchecked, and be armed for live
   alerts before a captured action can create a real pending alert.
3. The native foreground service receives Android media-session key events,
   groups them into a sequence using a 650 ms inter-event gap and a 900 ms
   settle window, resolves the configured click count, and POSTs the action to
   `/api/trigger/fire`.
4. In Test mode, the server records the test press but deliberately does not
   create an active alert, countdown, or push. In live mode, the server returns
   a pending alert ID/countdown; Kiki displays a local notification with a
   cancel action. The server controls whether the pending alert can still be
   cancelled or has already become active.

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
- Current click weights are global key-code rules rather than a learned,
  per-device profile. They can misclassify a different accessory that uses
  the same key codes differently.
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

Build a device-agnostic configurator around **observed event sequences**, not
brand-name assumptions or fixed key weights:

- Let a user capture and review raw event sequences per action; expose the
  timing window and show ambiguous/overlapping captures before saving.
- Store mappings per accessory/profile (and OS/app version where useful),
  support edits, reset, import/export, and an explicit fallback profile.
- Keep Practice isolated from live alerting, visibly distinguish test from
  live mode, and require an explicit arm/live transition.
- Preserve a diagnostic log that separates native input, local pattern match,
  server acceptance, pending-alert state, and push/delivery outcomes.
- For car controls and other media buttons, capture their actual Android
  events first; do not assume they emit the same keys or support multiple taps.
- Validate cancellation on time, after expiry, after server promotion, with
  network loss, and with concurrent actions. Treat server confirmation as the
  source of truth; never imply an alert was withdrawn when cancellation was
  not confirmed.

## Relevant implementation locations

- `basteon/android/app/src/main/java/za/co/xanzi/kiki/KikiTriggerService.kt`:
  media-session input, sequence timing, fire/cancel requests, and notifications.
- `basteon/android/app/src/main/java/za/co/xanzi/kiki/PressPatternRecognizer.kt`:
  click weighting and configured click-count resolution.
- `basteon/android/app/src/main/java/za/co/xanzi/kiki/TriggerCancelReceiver.kt`:
  notification cancellation action and result feedback.
- `basteon/android/app/src/main/java/za/co/xanzi/kiki/DeviceTracker.kt`:
  tracked device metadata and sync payload (if device-specific profiles are
  implemented, review what metadata Android actually exposes first).
- `basteon/src/components/TriggerLab.tsx` and
  `basteon/src/components/EarbudTriggerCard.tsx`: web setup and Practice/live
  controls.
- `basteon/src/app/api/trigger/fire/route.ts` and
  `basteon/src/app/api/trigger/cancel/route.ts`: server fire/cancel endpoints.
- `basteon/supabase/migrations/20261111000600_trigger_gateway_bluetooth.sql`:
  server-side pending-alert cancellation semantics.
