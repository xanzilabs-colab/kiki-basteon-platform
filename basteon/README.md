# Basteon Response Console

Secure emergency-response console for wearable panic-button alerts. The backend is Supabase Postgres, Auth, Realtime, and the `secure-alert` Edge Function.

## Setup

1. Create a Supabase project.
2. Run `supabase/migrations/20261002000000_init.sql` in the Supabase SQL editor, or run `supabase db push` after linking the project.
3. Deploy ingestion with:

   ```sh
   supabase functions deploy secure-alert --no-verify-jwt
   ```

4. Fill in the values in `.env.local`.
5. Install dependencies and create demo accounts:

   ```sh
   npm install
   npm run seed:users
   ```

6. Start the console:

   ```sh
   npm run dev
   ```

## Push Notifications

Web Push supports desktop browsers and mobile browsers. On iPhone, responders must open the console from an installed Home Screen web app before iOS permits push notifications.

1. Apply `supabase/migrations/20261003000000_push_subscriptions.sql` in the Supabase SQL editor.
2. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `PUSH_DISPATCH_SECRET` in the deployed web application's environment.
3. Set the Edge Function secrets, replacing the URL with the deployed web application URL:

   ```sh
   supabase secrets set PUSH_DISPATCH_URL=https://YOUR_APP_DOMAIN/api/push/dispatch
   supabase secrets set PUSH_DISPATCH_SECRET=YOUR_PUSH_DISPATCH_SECRET
   ```

4. Redeploy the alert ingestion function:

   ```sh
   supabase functions deploy secure-alert --no-verify-jwt
   ```

Responders receive the browser permission prompt after their first interaction with the dashboard. Accept it to subscribe that browser or phone.

## Scheduled Jobs

Scheduled cron jobs are disabled in [vercel.json](./vercel.json). The watchdog, alert escalation, and roster revalidation endpoints remain available for manually authorized service-to-service calls. Because schedules are off, expired roster links will not be ended automatically; invoke roster revalidation manually when required.

- Watchdog: `x-trip-watchdog-secret: $TRIP_WATCHDOG_SECRET`
- Alert escalation: `x-alert-escalation-secret: $ALERT_ESCALATION_SECRET`
- Roster revalidation: `Authorization: Bearer $CRON_SECRET`

## Organisation Roster Linking (Roster-Only Validation)

Organisation linking now validates strictly against organisation roster entries:

- Endpoint: `POST /api/org-links/validate`
- Accepted identifiers: `email`, `member_id`, `access_code`
- Outcome codes: `LINKED`, `PENDING_APPROVAL`, `NOT_ELIGIBLE`, `EXPIRED`, `ALREADY_CLAIMED`, `RATE_LIMITED`
- No OTP/second-factor flow is required when `organisation_link_settings.require_identifier_verification=false` (default).

The validator is rate-limited per user and IP, does not reveal roster membership details to the claimant, and records link/rejection events in the roster audit log.

## Device Endpoint

Set the wearable firmware's backend endpoint to:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/secure-alert
```

## Device Provisioning

Sign in as an admin, open **Devices**, and choose **Register device**. Enter the identifier shown by the device serial monitor (`[BOOT] Kiki Band v2.7, device id: ...`) and a device name. The console displays a base64 AES-256 key exactly once. With the band connected to USB, open Serial Monitor at 115200 baud, select a line ending, and send `KEY:<base64-key>`; the band saves the key to NVS without echoing it. If WiFi credentials are not compiled in through the ignored local `kiki-secrets.h`, send `WIFI:<ssid>|<password>` as well; the password is not echoed and both values are stored in NVS. If an already-registered band has lost its NVS key, an admin can rotate it from the key-shaped action in the **Devices** table; copy the complete `KEY:<base64-key>:<server-counter>` command displayed by the dialog and send it to the band. Rotation invalidates the old key, so server communication resumes only after the new key is provisioned.

Missing credentials no longer prevent the band from booting: the alert button, status output, and BLE setup remain available offline. Network alerts and device claims require both the matching unique key and WiFi. Send `s` in Serial Monitor for device ID, key provisioning, WiFi, PIN-lock, GPS, IMU, and operating-state status. The `KEY:` command must use the key generated for that same device ID in the admin dialog; registering it again generates a different key and invalidates the old one.

## Testing Alerts

Use the admin API endpoint `POST /api/admin/simulate-alert` while signed in as an admin, with a `device_id`, `lat`, and `lng`. It inserts a `dev` location alert and advances the selected device counter. New alerts appear in the responder console through Supabase Realtime without a page refresh.

## Live SOS Movement Tracking

Apply the live-tracking migrations through `supabase/migrations/20261110003000_phone_sos_updates.sql`, then redeploy `secure-alert`.

- Wearable updates continue through `secure-alert` and enrich each alert with motion/speed/heading plus a full location trail.
- Phone-originated SOS now streams movement updates to `POST /api/account/sos/update` every few seconds while the SOS confirmation card is open.
- Responder and admin surfaces use the same shared fields (`motion_state`, `is_moving`, `speed_kmh`, `heading_deg`, `hdop`) for consistent status, map smoothing, and telemetry display.

## Security Notes

The service role key is used only by server-side route handlers and the Supabase Edge Function. Do not expose it in browser code or commit populated environment files.

## Android Bluetooth Media Triggers

The Android app is a Capacitor shell around the deployed Kiki web app. It requires a network connection and does not work offline. The native foreground service listens for standard Android media-button events (for example, a headset play/pause or next-track press). Pairing alone does not guarantee that a device sends those events. The setup guide includes ten accessory categories, but actual trigger support is limited to accessories that deliver those standard events; iPhone, BLE GATT trigger buttons, and devices that do not expose media controls are not supported.

Before enabling triggers:

1. Apply the trigger migrations in order, including `supabase/migrations/20261111000600_trigger_gateway_bluetooth.sql`, `supabase/migrations/20261112000100_trigger_virtual_endpoints_and_user_cancel.sql`, `supabase/migrations/20261113000000_trigger_gesture_profiles.sql`, and `supabase/migrations/20261113000100_trigger_everyday_device_types.sql`, with `supabase db push` or your controlled SQL deployment process. The gesture-profile migration creates private profile backups and opt-in compatibility reports and updates bounded fire metadata. Do not enable the app before the migrations are deployed.
2. Vercel scheduled jobs are currently disabled so deployments do not require a plan that supports sub-daily cron schedules. The former once-per-minute trigger recovery sweep also pruned trigger diagnostics and routed pending trigger alerts; immediate countdown promotion remains in the trigger gateway request lifecycle. Re-enable the sweep and configure `CRON_SECRET` only when scheduled jobs are desired.
3. Deploy the current Next.js app and set `KIKI_APP_URL` to its HTTPS origin when building Android. The wrapper signs into that deployment and uses its existing Supabase session.

Build and install a debug APK from PowerShell on Windows:

```powershell
Set-Location .\basteon
$env:KIKI_APP_URL = "https://YOUR_DEPLOYED_KIKI_ORIGIN"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
npm install
npm run cap:sync
npm run android:apk
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r ".\android\app\build\outputs\apk\debug\app-debug.apk"
```

Enable Developer options and USB debugging on the phone, connect it over USB, accept the debugging prompt, and run the install command. The APK is at `android/app/build/outputs/apk/debug/app-debug.apk`. Alternatively, copy that APK to the phone and open it to install; Android may ask you to allow installs from that file manager. For local development, use an HTTPS tunnel or a laptop LAN URL reachable by the phone; HTTP URLs are accepted only by debug builds. Re-run `npm run cap:sync` whenever the web app URL or native plugin dependencies change.

On the phone, sign in to Kiki, open **Profile → Bluetooth Triggers**, leave **Test mode** enabled, grant notifications and optional location, then arm the phone. Pair an everyday device in Android Bluetooth settings and connect it. Adding it under **My devices → Phone-connected devices** is optional for alert triggering: that list tracks connection health, disconnect notices, and guided practice verification; the trigger service accepts supported media-button events from any compatible connected accessory without requiring it to be listed. Use **Practice check** or **Trigger Lab** with other media devices disconnected to verify which controls the accessory exposes.

The same rhythms apply to every compatible accessory: **5 or more quick presses in one burst = SOS; 3 quick presses, pause, then 2 = medical; 2, pause, 2, pause, 2 = discreet SOS; exactly 4 quick presses during the countdown = cancel.** Keep presses in a burst less than about 650 ms apart and leave a longer pause between groups; recognition waits about 900 ms after the last press. Accessory buttons must emit standard play/pause, headset, or next/previous media events. Practice mode is local-only and never sends an alert. After testing, turn off **Test mode** and confirm the live-alert warning; recognised patterns can then create alerts for responders. Keep the Kiki foreground-service notification enabled and exempt Kiki from battery optimisation for more reliable background monitoring.

Admins can review phone heartbeat health, user-selected device labels, and recent media-key diagnostics at **Admin → Bluetooth triggers**. A stale heartbeat is flagged after 15 minutes. These records describe reported status, not proof that a device will deliver a press or that a real alert was received.

**Compatibility is not universal and this build is not emergency-certified.** An accessory must deliver standard Android media-button events to Kiki's active media session; Android does not reliably identify which accessory sent an event. Pairing or a successful practice press does not guarantee background delivery across phones, Android versions, vendor power controls, or calls/music playback. Test the exact phone and accessory while in test mode before considering any real-mode use. Keep the dedicated Kiki/Basteon hardware or another tested emergency route available.

Bluetooth names and MAC addresses remain encrypted on the phone. The server receives only the user-selected device label, general device type, connection/verification state, and the generic trigger source. The countdown notification includes a server-backed cancel action; the four-press cancel pattern is also available. Web-push cancellation requires an active authenticated Kiki session, while the Android foreground notification can cancel using the phone's trigger token.

## Buddy Safe Spots And Meetings

The non-audio features require migration `20261024000000_buddy_safe_places_and_meeting.sql`, after all migrations through `20261023000000`. This implementation does not apply migrations automatically.

- Account entry: `/account/buddies/safe-places`. Members open their active Bubble meeting at `/account/buddies/meeting/[id]`; the existing Bubble page and privacy-preserving map remain unchanged.
- Admin entry: `/admin/buddy-places`. Admins create reviewed public spots, approve or reject suggestions, set quality and 24-hour availability, deactivate listings, and resolve community reports. Approval expires for ranking after 90 days unless renewed.
- Meeting locations require explicit sharing and are eligible for 10 minutes. Browser responses never contain another member's coordinates, destination, individual distance breakdown, or user ID. Options expose your estimate and the group's longest estimate. Location eligibility expiry is not physical data deletion; deployments should configure retention separately.
- New rounds require current locations from every member. Landmark lookup requires unanimous opt-in. Configure `KIKI_HTTP_UA` with a contact email for OpenStreetMap requests; lookup sends the meeting-zone centre, not individual member records. OSM landmarks are unreviewed and may be unavailable.
- Voting is round-scoped and unanimous across the active group. Membership changes invalidate options; feedback excludes a spot from subsequent rounds in that Bubble. Generation has a 30-second cooldown before external lookup. Distances are estimates, not live walking routes or guarantees of safety.
- Community alerts are approximate, expire after four hours, and never expose reporter identity. Limits are five reports per hour and ten spot suggestions per day per account.
- New operations use authenticated, role-checked SECURITY DEFINER RPCs. Only the existing meeting engine's raw-input and candidate-save contracts use service role. New tables remain inaccessible to browser table queries.

Focused checks: `npm test -- src/lib/buddies/meeting/__tests__` and `npx tsc --noEmit --incremental false`. Database integration must be verified in a controlled environment after the migration is deployed.

## User Accounts And Device Linking

Apply `supabase/migrations/20261005000000_accounts_and_device_linking.sql`, then redeploy the Edge Function. In Vercel, configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for the Production environment. Add the Vercel production URL and local development URL to Supabase Auth redirect URLs.

Device linking uses Web Bluetooth and requires the v2.5 firmware GATT service. It works in Chrome on Android and Chrome/Edge on supported desktop systems over HTTPS (or localhost); iPhone, Safari, and Firefox are unsupported. Android users must enable Location for scanning.

To test an encrypted device-link request without exposing secrets in source, issue a real link token from the UI and run:

```sh
DEVICE_ID=YOUR_DEVICE_ID DEVICE_KEY_B64=YOUR_BASE64_KEY LINK_TOKEN=TOKEN_FROM_UI LINK_CTR=NEXT_COUNTER FUNCTION_URL=https://PROJECT.supabase.co/functions/v1/secure-alert npm run test:link-device
```

For BLE testing with nRF Connect, advertise a `Basteon-XXXX` device in link mode, expose the documented service and INFO/TOKEN/STATUS characteristics, verify INFO returns the device ID JSON, observe the token write, emit `linking` then `linked`, and confirm the device appears under **My devices**.