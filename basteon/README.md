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

## Device Endpoint

Set the wearable firmware's backend endpoint to:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/secure-alert
```

## Device Provisioning

Sign in as an admin, open **Devices**, and choose **Register device**. Enter the identifier shown by the device serial monitor (`Boot ok, id: ...`) and a device name. The console displays a base64 AES-256 key exactly once; copy it to the device's secure configuration before closing the dialog.

## Testing Alerts

Use the admin API endpoint `POST /api/admin/simulate-alert` while signed in as an admin, with a `device_id`, `lat`, and `lng`. It inserts a `dev` location alert and advances the selected device counter. New alerts appear in the responder console through Supabase Realtime without a page refresh.

## Security Notes

The service role key is used only by server-side route handlers and the Supabase Edge Function. Do not expose it in browser code or commit populated environment files.

## User Accounts And Device Linking

Apply `supabase/migrations/20261005000000_accounts_and_device_linking.sql`, then redeploy the Edge Function. In Vercel, configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for the Production environment. Add the Vercel production URL and local development URL to Supabase Auth redirect URLs.

Device linking uses Web Bluetooth and requires the v2.5 firmware GATT service. It works in Chrome on Android and Chrome/Edge on supported desktop systems over HTTPS (or localhost); iPhone, Safari, and Firefox are unsupported. Android users must enable Location for scanning.

To test an encrypted device-link request without exposing secrets in source, issue a real link token from the UI and run:

```sh
DEVICE_ID=YOUR_DEVICE_ID DEVICE_KEY_B64=YOUR_BASE64_KEY LINK_TOKEN=TOKEN_FROM_UI LINK_CTR=NEXT_COUNTER FUNCTION_URL=https://PROJECT.supabase.co/functions/v1/secure-alert npm run test:link-device
```

For BLE testing with nRF Connect, advertise a `Basteon-XXXX` device in link mode, expose the documented service and INFO/TOKEN/STATUS characteristics, verify INFO returns the device ID JSON, observe the token write, emit `linking` then `linked`, and confirm the device appears under **My devices**.