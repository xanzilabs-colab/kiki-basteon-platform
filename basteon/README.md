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

## Scheduled Jobs (Watchdog + Alert Escalation)

This repository includes [vercel.json](./vercel.json) cron schedules for:

- `GET /api/trips/watchdog` every 2 minutes
- `GET /api/alerts/escalate` every minute

Set `CRON_SECRET` in the deployment environment so Vercel cron authentication succeeds.  
For manual service-to-service triggering, the existing `POST` endpoints still support:

- `x-trip-watchdog-secret: $TRIP_WATCHDOG_SECRET`
- `x-alert-escalation-secret: $ALERT_ESCALATION_SECRET`

## Device Endpoint

Set the wearable firmware's backend endpoint to:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/secure-alert
```

## Device Provisioning

Sign in as an admin, open **Devices**, and choose **Register device**. Enter the identifier shown by the device serial monitor (`Boot ok, id: ...`) and a device name. The console displays a base64 AES-256 key exactly once; copy it to the device's secure configuration before closing the dialog.

## Testing Alerts

Use the admin API endpoint `POST /api/admin/simulate-alert` while signed in as an admin, with a `device_id`, `lat`, and `lng`. It inserts a `dev` location alert and advances the selected device counter. New alerts appear in the responder console through Supabase Realtime without a page refresh.

## Live SOS Movement Tracking

Apply the live-tracking migrations through `supabase/migrations/20261110003000_phone_sos_updates.sql`, then redeploy `secure-alert`.

- Wearable updates continue through `secure-alert` and enrich each alert with motion/speed/heading plus a full location trail.
- Phone-originated SOS now streams movement updates to `POST /api/account/sos/update` every few seconds while the SOS confirmation card is open.
- Responder and admin surfaces use the same shared fields (`motion_state`, `is_moving`, `speed_kmh`, `heading_deg`, `hdop`) for consistent status, map smoothing, and telemetry display.

## Security Notes

The service role key is used only by server-side route handlers and the Supabase Edge Function. Do not expose it in browser code or commit populated environment files.

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