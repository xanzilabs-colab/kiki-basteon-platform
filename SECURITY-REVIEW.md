# Security Review Findings (Pre-Remediation)

This report records the repository findings as observed during the read-only
security audit, before any remediation. It is not evidence of the current
deployed Supabase, Vercel, or device-firmware configuration. No production
requests or environment-secret reads were performed for the audit.

## Confirmed source findings

### 1. Global staff access to profiles and location/trip data

- **Severity:** High
- **Confidence:** 9/10
- **Areas:** Authorization, multi-tenancy, Supabase RLS, location privacy
- **Evidence:** `basteon/supabase/migrations/20261002000000_init.sql` (lines
  39-42, 160-167), `basteon/supabase/migrations/20261004000000_alert_locations.sql`
  (lines 26-30), `basteon/supabase/migrations/20261007000000_hamba_trips.sql`
  (lines 95-106), and `basteon/supabase/migrations/20261109000000_alert_routing_scope.sql`
  (lines 93-129).
- **Finding:** The global staff helper recognizes platform-wide `admin` and
  `responder` roles. Profile, alert-location, and trip-related policies permit
  broad staff access, while later alert/event policies add organisation/branch
  scoping without replacing those older policies.
- **Plausible impact:** An authenticated responder in one organisation may be
  able to query profiles and precise location/trip data belonging to another
  organisation through Supabase.
- **Suggested remediation:** Apply consistent organisation/branch authorization
  to sensitive profile, location, and trip reads; verify deployed grants and
  effective RLS policies.

### 2. Roster identity claim is not bound to a verified account email

- **Severity:** High
- **Confidence:** 8/10
- **Areas:** Authentication, authorization, organisation roster/linking
- **Evidence:** `basteon/src/app/api/account/organisations/link/route.ts`
  (lines 36-48) and `basteon/src/lib/orgLinkValidation.ts` (lines 153-159,
  203-206, 236-270).
- **Finding:** The authenticated linking flow accepts a caller-supplied
  identifier and matches/writes roster membership without verifying that a
  submitted email is the authenticated account's verified email.
- **Plausible impact:** If a matching active, unclaimed roster record exists
  and automatic membership is allowed, another authenticated user may claim
  that identity and obtain the corresponding organisation membership.
- **Suggested remediation:** Bind email claims to the account's verified email,
  require an independently verified factor for other identifiers, and make the
  claim atomic with appropriate audit logging.

### 3. Device firmware disables TLS certificate verification

- **Severity:** High
- **Confidence:** 9/10
- **Areas:** Device security, SOS integrity and availability
- **Evidence:** `kiki-v1.ino` (line 675), `kiki-v1 copy.ino` (line 251), and
  `kiki-v1.ino` (lines 1484-1492).
- **Finding:** Both firmware copies use `WiFiClientSecure.setInsecure()`. The
  device treats an HTTP 2xx response as successful SOS delivery without
  authenticating the server.
- **Plausible impact:** An on-path attacker may impersonate the backend and
  return a forged success response, causing the device to treat an SOS as
  delivered even if it was not forwarded.
- **Suggested remediation:** Validate the backend TLS certificate using a
  maintained trust configuration and authenticate the response before marking
  an alert delivered.

### 4. SOS push notifications are sent to all subscriptions

- **Severity:** High
- **Confidence:** 9/10
- **Areas:** Push notifications, sensitive-data exposure
- **Evidence:** `basteon/src/app/api/push/subscribe/route.ts` (lines 11-23),
  `basteon/src/lib/push.ts` (lines 24-39),
  `basteon/supabase/functions/secure-alert/index.ts` (lines 180-195), and
  `basteon/src/app/api/push/dispatch/route.ts` (lines 12-21).
- **Finding:** Authenticated users can register subscriptions, but the push
  helper fans out to all stored subscriptions without filtering by the alert's
  authorised recipients. The SOS content includes the owner/device name.
- **Plausible impact:** An unrelated subscriber may receive another person's
  SOS status or identifying information, including on a lock screen.
- **Suggested remediation:** Resolve and enforce authorised recipients for
  each alert and keep lock-screen notification content discreet.

### 5. Public organisation signup does not prove control of the email address

- **Severity:** Medium
- **Confidence:** 8/10
- **Areas:** Authentication, business logic
- **Evidence:** `basteon/src/app/api/organisation/signup/route.ts` (lines
  25-37, 87-125).
- **Finding:** The unauthenticated signup path creates an owner account with
  the submitted email marked confirmed without first proving control of that
  address; generated credentials may be returned in the response.
- **Plausible impact:** An attacker may create an account represented by an
  unregistered third party's email address. The audit did not establish
  takeover of an already-existing account.
- **Suggested remediation:** Verify email control before activating owner
  privileges and avoid returning reusable credentials in the signup response.

### 6. Firmware contains embedded Wi-Fi credentials and falls back to a shared development key

- **Severity:** High if the checked-in firmware is deployed; otherwise
  informational for this development sketch
- **Confidence:** 8/10
- **Areas:** Secrets/configuration, device security
- **Evidence:** `kiki-v1.ino` (lines 34-56, 1405-1408) and
  `kiki-v1 copy.ino` (lines 10-31, 511-513).
- **Finding:** The tracked sketches contain non-placeholder Wi-Fi credentials
  and a fixed development device key. If no 32-byte key is provisioned in NVS,
  firmware falls back to that shared key. The audit did not verify whether the
  sketch or fallback key is used by production devices.
- **Plausible impact:** Anyone with access to the repository or firmware may
  recover the embedded Wi-Fi credential. If deployed devices use the fallback
  key and the server accepts it, the shared key could permit device
  impersonation or forged device messages.
- **Suggested remediation:** Remove credentials from tracked firmware, rotate
  exposed Wi-Fi credentials, and fail closed unless a unique per-device key
  has been securely provisioned.

## Additional observations requiring deployment verification

- Migration source does not explicitly enable RLS for `support_contacts`.
  Whether this is exposed depends on deployed grants/default privileges; this
  was not confirmed as an exploitable finding.
- A dependency audit reported high/moderate transitive PostCSS advisories via
  Next.js, but a reachable application exploit was not established.
- The audit was source-based. Deployed Supabase policies/grants, Vercel
  settings, production secrets, device provisioning, provider settings, and
  POPIA governance controls require separate verification.

## Source remediation applied

The following source changes address the findings above; they do not by
themselves deploy the migration or verify production configuration:

- Added `basteon/supabase/migrations/20261110008000_scope_sensitive_data_access.sql`
  to scope profile, device, alert, alert-event, alert-location, trip, trip
  location/event, and private profile-image reads to the owner, platform
  administrator, or responders authorised for an active alert.
- Bound roster email linking to the authenticated account's verified email.
  Non-email roster identifiers now create pending requests instead of active
  membership.
- Changed device push dispatch to identify an alert and route notifications
  through `routeAlertAndNotify`, which sends only to authorised recipients.
  Removed the global subscription-fanout helper.
- Changed organisation signup to require a verified authenticated email before
  setting a password or creating an owner membership. The signup flow emails a
  verification link and collects the password only after verification.
- Replaced firmware TLS bypasses with the ESP32 built-in CA bundle, removed
  embedded Wi-Fi credentials, and made firmware stop unless a unique 32-byte
  key is provisioned in NVS.

### Actions still required outside this source change

- Apply the new Supabase migration and verify the effective policies/grants in
  the deployed project.
- Allow the deployed `/organisation/signup/verify` URL in Supabase Auth's
  redirect allow list and keep email confirmation enabled.
- Rotate the Wi-Fi password that was previously present in the tracked sketch.
  Copy `kiki-secrets.example.h` to the ignored local `kiki-secrets.h` and enter
  the replacement Wi-Fi credentials there. Do not commit that local file.
- Provision each band with its unique backend-matched 32-byte NVS key; devices
  without one now intentionally stop rather than use a shared fallback key.
- Deploy the web app and Edge Function together with matching push-dispatch
  secrets, then verify alert routing using authorised and unauthorised test
  accounts.
