// ===== Kiki Band v2.6: ESP32 + GPS + AES-256-GCM + live tracking + BLE linking + PIN lock =====
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <TinyGPSPlus.h>
#include <NimBLEDevice.h>
#include "mbedtls/gcm.h"
#include "mbedtls/md.h"
#include "mbedtls/base64.h"
#include "esp_random.h"

const char* FW_VERSION = "2.6";

// ---------- Config (EDIT THESE) ----------
const char* WIFI_SSID   = "HUAWEI_B311_CC04";
const char* WIFI_PASS   = "TLgNg6ih7NH";
const char* BACKEND_URL = "https://xsfhstvydstxeadiynom.supabase.co/functions/v1/secure-alert";
const bool  SILENT_MODE = false;              // true = no buzzer, no LED during countdown

// Wiring polarity: false = other leg to GND (correct). true = other leg to 3V3.
const bool LED_ACTIVE_LOW    = false;
const bool BUZZER_ACTIVE_LOW = true;

// No GPS module yet: true = send these coordinates as a "dev" location
const bool   USE_DEV_FALLBACK_LOCATION = true;
const double DEV_FALLBACK_LAT = -23.9667;
const double DEV_FALLBACK_LNG = 29.7;

#define USE_BATTERY_SENSE 0
const int BATTERY_PIN = 34;

// Dev key = ASCII "12345678901234567890123456789012". Replace via NVS in production.
const uint8_t DEV_KEY[32] = {'1','2','3','4','5','6','7','8','9','0','1','2','3','4','5','6',
                             '7','8','9','0','1','2','3','4','5','6','7','8','9','0','1','2'};
uint8_t deviceKey[32];

// ---------- Pins ----------
const int BUTTON_PIN = 13;   // button to GND (internal pull-up)
const int LED_PIN    = 2;    // onboard LED / external LED via 220R
const int BUZZER_PIN = 4;    // active buzzer + leg
const int GPS_RX_PIN = 16;   // ESP32 RX2 <- GPS TX
const int GPS_TX_PIN = 17;   // ESP32 TX2 -> GPS RX
const uint32_t GPS_BAUD = 9600;

// ---------- Timing ----------
const unsigned long COUNTDOWN_MS      = 10000;
const unsigned long DEBOUNCE_MS       = 50;
const unsigned long CANCEL_HOLD_MS    = 1500;
const unsigned long RETRY_INTERVAL_MS = 3000;
const unsigned long WIFI_BACKOFF_MIN_MS = 5000;
const unsigned long WIFI_BACKOFF_MAX_MS = 30000;
const unsigned long GPS_FRESH_MS      = 30000;
const unsigned long CACHE_MIN_INTERVAL_MS = 300000;
const double        CACHE_MIN_MOVE_M      = 100.0;
const unsigned long TELEMETRY_INTERVAL_MS = 120000;

// ---------- Live tracking (periodic updates after the first alert) ----------
const bool          TRACKING_ENABLED     = true;
const unsigned long TRACK_PHASE1_END_MS  = 120000UL;    // 0-2 min
const unsigned long TRACK_PHASE1_MS      = 10000UL;     //   every 10 s
const unsigned long TRACK_PHASE2_END_MS  = 600000UL;    // 2-10 min
const unsigned long TRACK_PHASE2_MS      = 30000UL;     //   every 30 s
const unsigned long TRACK_PHASE3_END_MS  = 3600000UL;   // 10-60 min
const unsigned long TRACK_PHASE3_MS      = 60000UL;     //   every 60 s
const unsigned long TRACK_PHASE4_MS      = 300000UL;    // 60 min onward: every 5 min
const unsigned long TRACK_MAX_MS         = 10800000UL;  // hard stop after 3 h
const double        TRACK_MIN_MOVE_M     = 25.0;        // moved less than this => skip (unless heartbeat due)
const unsigned long TRACK_HEARTBEAT_MS   = 120000UL;    // always send at least this often
const double        TRACK_FAST_KMPH      = 30.0;        // faster than this => tighten interval
const unsigned long TRACK_FAST_MS        = 10000UL;
const int           TRACK_BAT_LOW_PCT    = 20;          // below: intervals x2
const int           TRACK_BAT_CRIT_PCT   = 10;          // below: at most every 5 min
const unsigned long TRACK_RETRY_MS       = 5000UL;      // after a failed update, try again soon
const unsigned long TRACK_STOP_HOLD_MS   = 1500UL;      // hold button this long to stop tracking (use 3-5 s in production)

// ---------- BLE device linking ----------
// Link mode: hold the button ~5 s while idle (two quick beeps), or hold it while resetting, or send 'l' on Serial.
// BLE is off at all other times.
const bool          BLE_LINKING_ENABLED  = true;
const unsigned long LINK_WINDOW_MS       = 300000UL;    // BLE stays on for 5 min
const int           LINK_MAX_TRIES       = 5;           // server attempts per token
const unsigned long LINK_TRY_INTERVAL_MS = 3000UL;
const unsigned long LINK_HOLD_MS         = 5000UL;      // hold the button this long while idle to enter link mode
const unsigned long LINK_AFTER_LINK_MS   = 20000UL;     // keep BLE up this long after "linked" so the app can set a PIN
#define BLE_SERVICE_UUID "7b1c0001-4e5a-4a6d-9c1b-8f3a2d5e6b00"
#define BLE_CHR_INFO     "7b1c0002-4e5a-4a6d-9c1b-8f3a2d5e6b00"   // READ   -> {"id","fw","locked","salt","iters","wait"}
#define BLE_CHR_TOKEN    "7b1c0003-4e5a-4a6d-9c1b-8f3a2d5e6b00"   // WRITE  <- one-time link token
#define BLE_CHR_STATUS   "7b1c0004-4e5a-4a6d-9c1b-8f3a2d5e6b00"   // READ+NOTIFY -> status strings
#define BLE_CHR_CTRL     "7b1c0005-4e5a-4a6d-9c1b-8f3a2d5e6b00"   // WRITE  <- UNLOCK:<proof> | SETPIN:<salt>:<verifier> | CLEARPIN
#define BLE_CHR_NONCE    "7b1c0006-4e5a-4a6d-9c1b-8f3a2d5e6b00"   // READ   -> 32 hex chars, one-time challenge

// Set to 1 to require an encrypted BLE link (the phone will show a pairing prompt). Recommended once the basics work.
#define BLE_REQUIRE_ENCRYPTION 0
#if BLE_REQUIRE_ENCRYPTION
  #define CTRL_PROPS  (NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC)
  #define TOKEN_PROPS (NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC)
#else
  #define CTRL_PROPS  (NIMBLE_PROPERTY::WRITE)
  #define TOKEN_PROPS (NIMBLE_PROPERTY::WRITE)
#endif

// ---------- PIN lock ----------
// The band never stores the PIN. It stores a verifier (PBKDF2 output derived in the app) and checks a
// challenge-response proof. The panic button is NEVER blocked by the PIN.
const bool          PIN_LOCK_ENABLED            = true;
const uint32_t      PIN_PBKDF2_ITERS            = 10000;     // reported to the app; the app derives the verifier
const uint8_t       PIN_MAX_FAILS               = 5;
const unsigned long PIN_LOCKOUT_MS              = 900000UL;  // 15 min after too many wrong PINs
const bool          LOCKED_DISABLES_MANUAL_STOP = false;     // true: a locked band can't be silenced by hand (needs an app "I'm safe" feature first)
const bool          DEV_SERIAL_COMMANDS         = true;      // 'l' = link mode, 'x' = wipe PIN. Set false for production.

enum DeviceState { IDLE, COUNTDOWN, SENDING, TRACKING };
DeviceState state = IDLE;

Preferences prefs;
TinyGPSPlus gps;
String deviceId;
unsigned long countdownStart = 0, lastAttempt = 0, lastCacheSave = 0, lastTelemetryAt = 0;
unsigned int sendAttempts = 0;
int lastSendErr = 0;

bool   hasCached = false;
double cachedLat = 0, cachedLng = 0;

double locLat = 0, locLng = 0;
const char* locSrc = "";
long   locAgeS = -1;
String lastLocMsg = "no location";

// Tracking state
uint32_t      activationCtr = 0;     // ctr of the original alert; updates reference it
unsigned long alertStart = 0;
unsigned long nextUpdateAt = 0;
unsigned long lastSentAt = 0;
bool          haveLastSent = false;
double        lastSentLat = 0, lastSentLng = 0;
unsigned int  updatesSent = 0;
int           lastTrackErr = 0;
bool          resumeTrackingOnCancel = false;   // true if a new countdown interrupted active tracking

bool btnDown = false, ignoreUntilRelease = false;
int  lastRaw = HIGH;
unsigned long lastChange = 0, pressStart = 0;

// WiFi state
bool wifiWasUp = false;
unsigned long lastWifiTry = 0;
unsigned long wifiBackoff = 10000;   // first boot attempt gets more time
unsigned int  wifiAttempt = 0;

// GPS log-on-change state
bool gpsHadFix = false, gpsNoDataWarned = false;

// PIN state
bool          pinSet = false;
uint8_t       pinSalt[16];
uint8_t       pinVerifier[32];
uint8_t       pinFails = 0;
unsigned long pinLockoutUntil = 0;
bool          sessionUnlocked = false;   // true after a valid UNLOCK proof, ends when the phone disconnects
String        nonceHex = "";

// BLE link state
bool linkMode = false;
unsigned long linkModeUntil = 0;
volatile bool linkTokenWritten = false;   // set by the BLE callback, handled in loop()
String linkTokenRaw = "";
volatile bool ctrlWritten = false;        // set by the BLE callback, handled in loop()
String ctrlRaw = "";
bool linkRequested = false;
String linkToken = "";
int  linkTries = 0;
unsigned long linkNextTry = 0;
bool linkDone = false;
unsigned long linkEndAt = 0;
unsigned long lastInfoRefresh = 0;
NimBLEServer* bleServer = nullptr;
NimBLECharacteristic* bleStatusChr = nullptr;
NimBLECharacteristic* bleInfoChr = nullptr;
NimBLECharacteristic* bleNonceChr = nullptr;

// ---------- LED / buzzer ----------
void ledSet(bool on)  { digitalWrite(LED_PIN,    (on != LED_ACTIVE_LOW)    ? HIGH : LOW); }
void buzzSet(bool on) { digitalWrite(BUZZER_PIN, (on != BUZZER_ACTIVE_LOW) ? HIGH : LOW); }
void allOff()         { ledSet(false); buzzSet(false); }

void beep(unsigned int ms) {
  ledSet(true);
  if (!SILENT_MODE) buzzSet(true);
  delay(ms);
  allOff();
}

void signalSent()   { for (int i = 0; i < 3; i++) { beep(120); delay(120); } }
void signalCancel() { beep(400); }

void countdownFeedback() {
  if (SILENT_MODE) return;
  unsigned long elapsed = millis() - countdownStart;
  unsigned long period = (COUNTDOWN_MS - elapsed <= 3000) ? 250 : 500;
  bool on = (millis() % period) < (period / 2);
  ledSet(on);
  buzzSet(on);
}

// ---------- GPS ----------
void maybeCacheFix(double lat, double lng) {
  unsigned long now = millis();
  if (hasCached) {
    if (now - lastCacheSave < CACHE_MIN_INTERVAL_MS) return;
    if (TinyGPSPlus::distanceBetween(lat, lng, cachedLat, cachedLng) < CACHE_MIN_MOVE_M) return;
  }
  prefs.putDouble("lat", lat);
  prefs.putDouble("lng", lng);
  cachedLat = lat; cachedLng = lng; hasCached = true; lastCacheSave = now;
}

void pollGps() {
  while (Serial2.available()) gps.encode(Serial2.read());
  if (gps.location.isValid() && gps.location.isUpdated()) {
    maybeCacheFix(gps.location.lat(), gps.location.lng());
  }
}

void trackGps() {
  bool fix = gps.location.isValid() && gps.location.age() < GPS_FRESH_MS;
  if (fix != gpsHadFix) {
    gpsHadFix = fix;
    Serial.println(fix ? "[GPS] fix acquired, sats=" + String(gps.satellites.value())
                       : "[GPS] fix lost");
  }
  if (!gpsNoDataWarned && millis() > 15000 && gps.charsProcessed() == 0) {
    gpsNoDataWarned = true;
    Serial.println(String("[GPS] no data from module (not connected?) - ") +
                   (USE_DEV_FALLBACK_LOCATION ? "using dev fallback location" : "alerts will have no location"));
  }
}

bool resolveLocation() {
  pollGps();
  if (gps.location.isValid() && gps.location.age() <= GPS_FRESH_MS) {
    locLat = gps.location.lat(); locLng = gps.location.lng();
    locSrc = "gps"; locAgeS = gps.location.age() / 1000; return true;
  }
  if (gps.location.isValid()) {
    locLat = gps.location.lat(); locLng = gps.location.lng();
    locSrc = "stale"; locAgeS = gps.location.age() / 1000; return true;
  }
  if (hasCached) {
    locLat = cachedLat; locLng = cachedLng; locSrc = "cached"; locAgeS = -1; return true;
  }
  if (USE_DEV_FALLBACK_LOCATION) {
    locLat = DEV_FALLBACK_LAT; locLng = DEV_FALLBACK_LNG; locSrc = "dev"; locAgeS = -1; return true;
  }
  return false;
}

int readBatteryPercent() {
#if USE_BATTERY_SENSE
  long mv = (long)analogReadMilliVolts(BATTERY_PIN) * 2;
  long pct = (mv - 3300) * 100 / (4200 - 3300);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return (int)pct;
#else
  return -1;
#endif
}

// ---------- Crypto ----------
String b64(const uint8_t* data, size_t len) {
  size_t olen = 0;
  size_t cap = 4 * ((len + 2) / 3) + 1;
  uint8_t* buf = (uint8_t*)malloc(cap);
  if (!buf) return "";
  mbedtls_base64_encode(buf, cap, &olen, data, len);
  buf[olen] = 0;
  String s((char*)buf);
  free(buf);
  return s;
}

String encryptPayload(const String& plain) {
  uint8_t iv[12], tag[16];
  esp_fill_random(iv, sizeof(iv));

  size_t len = plain.length();
  uint8_t* out = (uint8_t*)malloc(len);
  if (!out) return "";

  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);
  mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, deviceKey, 256);
  mbedtls_gcm_crypt_and_tag(&gcm, MBEDTLS_GCM_ENCRYPT, len,
                            iv, sizeof(iv),
                            (const uint8_t*)deviceId.c_str(), deviceId.length(),
                            (const uint8_t*)plain.c_str(), out,
                            sizeof(tag), tag);
  mbedtls_gcm_free(&gcm);

  String body = "{\"device_id\":\"" + deviceId + "\",\"iv\":\"" + b64(iv, 12) +
                "\",\"tag\":\"" + b64(tag, 16) + "\",\"ciphertext\":\"" + b64(out, len) + "\"}";
  free(out);
  return body;
}

// Returns HTTP code, or -2 = no WiFi, -3 = could not start request.
// If resp is not null, the response body is stored there.
int postPayload(const String& body, String* resp) {
  if (WiFi.status() != WL_CONNECTED) return -2;
  WiFiClientSecure client;
  client.setInsecure();                      // TODO prod: client.setCACert(ROOT_CA);
  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(client, BACKEND_URL)) return -3;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  if (resp && code > 0) *resp = http.getString();
  http.end();
  return code;
}

String sendError(int code) {
  if (code == -2) return "no WiFi";
  if (code == -3) return "bad URL";
  if (code == 401) return "HTTP 401 key mismatch";
  if (code == 403) return "HTTP 403 device not registered";
  if (code == 404) return "HTTP 404 function not deployed";
  if (code < 0)   return "network error " + String(code);
  return "HTTP " + String(code);
}

// Tiny helper: extract a string value from a flat JSON response (spaces already stripped by caller)
String jsonStr(const String& s, const char* key) {
  String pat = "\"" + String(key) + "\":\"";
  int i = s.indexOf(pat);
  if (i < 0) return "";
  i += pat.length();
  int j = s.indexOf('"', i);
  if (j < 0) return "";
  return s.substring(i, j);
}

// ---------- Hex / HMAC helpers ----------
static const char HEXCHARS[] = "0123456789abcdef";

String bytesToHex(const uint8_t* d, size_t n) {
  String s;
  s.reserve(n * 2);
  for (size_t i = 0; i < n; i++) { s += HEXCHARS[d[i] >> 4]; s += HEXCHARS[d[i] & 15]; }
  return s;
}

int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool hexToBytes(const String& s, uint8_t* out, size_t n) {
  if (s.length() != n * 2) return false;
  for (size_t i = 0; i < n; i++) {
    int a = hexNibble(s.charAt(2 * i)), b = hexNibble(s.charAt(2 * i + 1));
    if (a < 0 || b < 0) return false;
    out[i] = (uint8_t)((a << 4) | b);
  }
  return true;
}

bool ctEqual(const uint8_t* a, const uint8_t* b, size_t n) {
  uint8_t d = 0;
  for (size_t i = 0; i < n; i++) d |= (uint8_t)(a[i] ^ b[i]);
  return d == 0;
}

void hmacSha256(const uint8_t* key, size_t klen, const uint8_t* data, size_t dlen, uint8_t out[32]) {
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_hmac(info, key, klen, data, dlen, out);
}

// ---------- Payload ----------
// status: "panic_activated" (ref = 0) or "panic_update" (ref = ctr of the original alert)
String buildPayload(const char* status, uint32_t ctr, uint32_t ref) {
  String inner = "{\"status\":\"" + String(status) + "\",\"ctr\":" + String(ctr);
  if (ref) inner += ",\"ref\":" + String(ref);
  lastLocMsg = "no location";
  if (resolveLocation()) {
    inner += ",\"lat\":" + String(locLat, 6) + ",\"lng\":" + String(locLng, 6) +
             ",\"src\":\"" + String(locSrc) + "\",\"age\":" + String(locAgeS);
    lastLocMsg = String(locLat, 6) + "," + String(locLng, 6) + " (" + String(locSrc) + ")";
  }
  int bat = readBatteryPercent();
  if (bat >= 0) inner += ",\"bat\":" + String(bat);
  inner += "}";
  return inner;
}

String buildHeartbeatPayload(uint32_t ctr) {
  String inner = "{\"status\":\"device_heartbeat\",\"ctr\":" + String(ctr);
  int bat = readBatteryPercent();
  if (bat >= 0) inner += ",\"bat\":" + String(bat);
  if (WiFi.status() == WL_CONNECTED) inner += ",\"rssi\":" + String(WiFi.RSSI());
  inner += ",\"lock\":" + String(pinSet ? 1 : 0);      // lets the server see/repair lock mismatches
  inner += "}";
  return inner;
}

uint32_t nextCtr() {
  uint32_t c = prefs.getUInt("ctr", 0) + 1;
  prefs.putUInt("ctr", c);
  return c;
}

// ---------- PIN storage and rules ----------
void loadPin() {
  pinSet = false;
  memset(pinSalt, 0, sizeof(pinSalt));
  memset(pinVerifier, 0, sizeof(pinVerifier));
  if (PIN_LOCK_ENABLED && prefs.getUChar("pin_on", 0) == 1 &&
      prefs.getBytesLength("pin_salt") == 16 && prefs.getBytesLength("pin_ver") == 32) {
    prefs.getBytes("pin_salt", pinSalt, 16);
    prefs.getBytes("pin_ver", pinVerifier, 32);
    pinSet = true;
  }
  pinFails = prefs.getUChar("pin_fail", 0);
  // Failures survive reboots: if the limit was reached, a reboot does not give a free retry
  if (pinSet && pinFails >= PIN_MAX_FAILS) pinLockoutUntil = millis() + PIN_LOCKOUT_MS;
}

void storePin() {
  prefs.putBytes("pin_salt", pinSalt, 16);
  prefs.putBytes("pin_ver", pinVerifier, 32);
  prefs.putUChar("pin_on", 1);
  pinSet = true;
}

void wipePin() {
  prefs.remove("pin_on");
  prefs.remove("pin_salt");
  prefs.remove("pin_ver");
  prefs.putUChar("pin_fail", 0);
  pinFails = 0;
  pinSet = false;
  sessionUnlocked = false;
  memset(pinSalt, 0, sizeof(pinSalt));
  memset(pinVerifier, 0, sizeof(pinVerifier));
}

bool pinLockedOut() {
  return pinSet && pinFails >= PIN_MAX_FAILS && (long)(pinLockoutUntil - millis()) > 0;
}

void recordPinFailure() {
  if (pinFails < 250) pinFails++;
  prefs.putUChar("pin_fail", pinFails);
  if (pinFails >= PIN_MAX_FAILS) pinLockoutUntil = millis() + PIN_LOCKOUT_MS;
}

void clearPinFailures() {
  pinFails = 0;
  prefs.putUChar("pin_fail", 0);
}

// ---------- BLE: status, info, nonce ----------
void setLinkStatus(const String& s) {
  Serial.println("[LINK] status: " + s);
  if (bleStatusChr) {
    bleStatusChr->setValue(std::string(s.c_str()));
    bleStatusChr->notify();
  }
}

void refreshInfo() {
  if (!bleInfoChr) return;
  String j = "{\"id\":\"" + deviceId + "\",\"fw\":\"" + String(FW_VERSION) + "\",\"locked\":" + String(pinSet ? 1 : 0);
  if (pinSet) {
    unsigned long wait = pinLockedOut() ? (pinLockoutUntil - millis()) / 1000 : 0;
    j += ",\"salt\":\"" + bytesToHex(pinSalt, 16) + "\",\"iters\":" + String(PIN_PBKDF2_ITERS) +
         ",\"wait\":" + String(wait);
  }
  j += "}";
  bleInfoChr->setValue(std::string(j.c_str()));
}

void newNonce() {
  uint8_t n[16];
  esp_fill_random(n, sizeof(n));
  nonceHex = bytesToHex(n, sizeof(n));
  if (bleNonceChr) bleNonceChr->setValue(std::string(nonceHex.c_str()));
}

// Runs on the BLE task: keep these tiny. Real work happens in linkTick().
class TokenCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& connInfo) override {
    auto v = c->getValue();
    size_t n = v.length();
    const char* p = v.c_str();
    String t;
    t.reserve(n);
    for (size_t i = 0; i < n && i < 80; i++) {
      char ch = p[i];
      if (isalnum((unsigned char)ch)) t += ch;
    }
    linkTokenRaw = t;
    linkTokenWritten = true;
  }
};
TokenCallbacks tokenCallbacks;

class CtrlCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& connInfo) override {
    auto v = c->getValue();
    size_t n = v.length();
    const char* p = v.c_str();
    String t;
    t.reserve(n);
    for (size_t i = 0; i < n && i < 160; i++) {
      char ch = p[i];
      if (isalnum((unsigned char)ch) || ch == ':') t += ch;
    }
    ctrlRaw = t;
    ctrlWritten = true;
  }
};
CtrlCallbacks ctrlCallbacks;

// UNLOCK:<64 hex proof>   proof = HMAC-SHA256(key = verifier, msg = ASCII nonce hex)
// SETPIN:<32 hex salt>:<64 hex verifier>   (allowed if not locked, or after UNLOCK)
// CLEARPIN                                 (allowed if not locked, or after UNLOCK)
void handleCtrl() {
  String c = ctrlRaw;

  if (c.startsWith("UNLOCK:")) {
    if (!pinSet) { sessionUnlocked = true; setLinkStatus("unlocked"); return; }
    if (pinLockedOut()) { setLinkStatus("failed:locked_out"); refreshInfo(); return; }

    uint8_t got[32], expect[32];
    bool fmtOk = hexToBytes(c.substring(7), got, 32);
    hmacSha256(pinVerifier, 32, (const uint8_t*)nonceHex.c_str(), nonceHex.length(), expect);
    bool match = fmtOk && ctEqual(expect, got, 32);
    newNonce();                                   // every attempt burns the challenge

    if (match) {
      sessionUnlocked = true;
      clearPinFailures();
      setLinkStatus("unlocked");
    } else {
      recordPinFailure();
      setLinkStatus(pinLockedOut() ? "failed:locked_out" : "failed:bad_pin");
    }
    refreshInfo();
    return;
  }

  if (c.startsWith("SETPIN:")) {
    if (!PIN_LOCK_ENABLED) { setLinkStatus("failed:bad_command"); return; }
    if (pinSet && !sessionUnlocked) { setLinkStatus("failed:not_unlocked"); return; }
    int sep = c.indexOf(':', 7);
    if (sep < 0) { setLinkStatus("failed:format"); return; }
    uint8_t s[16], v[32];
    if (!hexToBytes(c.substring(7, sep), s, 16) || !hexToBytes(c.substring(sep + 1), v, 32)) {
      setLinkStatus("failed:format");
      return;
    }
    memcpy(pinSalt, s, 16);
    memcpy(pinVerifier, v, 32);
    storePin();
    clearPinFailures();
    sessionUnlocked = true;
    newNonce();
    if (linkDone) linkEndAt = millis() + 5000;    // let the confirmation flush
    setLinkStatus("pin_set");
    refreshInfo();
    return;
  }

  if (c == "CLEARPIN") {
    if (pinSet && !sessionUnlocked) { setLinkStatus("failed:not_unlocked"); return; }
    wipePin();
    sessionUnlocked = true;
    newNonce();
    if (linkDone) linkEndAt = millis() + 5000;
    setLinkStatus("pin_cleared");
    refreshInfo();
    return;
  }

  setLinkStatus("failed:bad_command");
}

// ---------- BLE link mode ----------
void enterLinkMode() {
  if (!BLE_LINKING_ENABLED || linkMode) return;

  String name = "Kiki-" + deviceId.substring(deviceId.length() - 4);
  NimBLEDevice::init(name.c_str());
#if BLE_REQUIRE_ENCRYPTION
  NimBLEDevice::setSecurityAuth(false, false, true);
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
#endif
  bleServer = NimBLEDevice::createServer();
  NimBLEService* svc = bleServer->createService(BLE_SERVICE_UUID);

  sessionUnlocked = false;
  bleInfoChr = svc->createCharacteristic(BLE_CHR_INFO, NIMBLE_PROPERTY::READ);
  refreshInfo();

  NimBLECharacteristic* tok = svc->createCharacteristic(BLE_CHR_TOKEN, TOKEN_PROPS);
  tok->setCallbacks(&tokenCallbacks);

  bleStatusChr = svc->createCharacteristic(BLE_CHR_STATUS, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  bleStatusChr->setValue(std::string("ready"));

  NimBLECharacteristic* ctrl = svc->createCharacteristic(BLE_CHR_CTRL, CTRL_PROPS);
  ctrl->setCallbacks(&ctrlCallbacks);

  bleNonceChr = svc->createCharacteristic(BLE_CHR_NONCE, NIMBLE_PROPERTY::READ);
  newNonce();

  svc->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->stop();

  NimBLEAdvertisementData advData;
  advData.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  advData.addServiceUUID(NimBLEUUID(BLE_SERVICE_UUID));
  adv->setAdvertisementData(advData);

  NimBLEAdvertisementData scanData;
  scanData.setName(name.c_str());
  adv->setScanResponseData(scanData);

  adv->enableScanResponse(true);
  adv->start();

  linkMode = true;
  linkModeUntil = millis() + LINK_WINDOW_MS;
  linkRequested = false;
  linkDone = false;
  linkTokenWritten = false;
  ctrlWritten = false;
  lastTelemetryAt = millis() - (TELEMETRY_INTERVAL_MS - 3000UL);   // heartbeat soon, so a stale PIN can self-heal
  Serial.println("[LINK] link mode ON as " + name + " (id " + deviceId + ")" + (pinSet ? " [PIN locked]" : "") +
                 ", open the web app and tap Find band");
}

void endLinkMode(const char* why) {
  if (!linkMode) return;
  linkMode = false;
  linkRequested = false;
  linkDone = false;
  sessionUnlocked = false;
  NimBLEDevice::deinit(true);
  bleServer = nullptr;
  bleStatusChr = nullptr;
  bleInfoChr = nullptr;
  bleNonceChr = nullptr;
  allOff();
  Serial.println(String("[LINK] BLE off: ") + why);
}

bool linkBusy() {
  return linkMode && (linkRequested || linkDone || (bleServer && bleServer->getConnectedCount() > 0));
}

void linkTick() {
  if (!linkMode) return;
  unsigned long now = millis();

  // Idle pattern: double blink every 2 s
  if (!SILENT_MODE && !linkRequested && !linkDone) {
    unsigned long ph = now % 2000;
    ledSet(ph < 100 || (ph > 250 && ph < 350));
  }

  // The PIN session only lives as long as the phone stays connected
  if (bleServer && bleServer->getConnectedCount() == 0) sessionUnlocked = false;

  // Keep advertising if a client dropped
  if (bleServer && !linkDone && bleServer->getConnectedCount() == 0 &&
      !NimBLEDevice::getAdvertising()->isAdvertising()) {
    NimBLEDevice::getAdvertising()->start();
  }

  // Keep the lockout countdown in INFO roughly current
  if (pinSet && (now - lastInfoRefresh) > 5000) { lastInfoRefresh = now; refreshInfo(); }

  // PIN / settings commands from the app
  if (ctrlWritten) { ctrlWritten = false; handleCtrl(); }

  // Finish: give notifications a moment to flush (and let the app set a PIN), then power BLE down
  if (linkDone) {
    if ((long)(now - linkEndAt) >= 0) endLinkMode("linked");
    return;
  }

  // Window expired (don't cut off an in-progress attempt)
  if (!linkRequested && (long)(now - linkModeUntil) >= 0) {
    endLinkMode("window expired");
    return;
  }

  // New token from the browser
  if (linkTokenWritten) {
    linkTokenWritten = false;
    String t = linkTokenRaw;
    if (pinSet && !sessionUnlocked) {
      setLinkStatus("failed:pin_required");          // locked band: no unlock proof, no linking
    } else if (t.length() < 16 || t.length() > 64) {
      setLinkStatus("failed:bad_token");
    } else {
      linkToken = t;
      linkRequested = true;
      linkTries = 0;
      linkNextTry = now;
      setLinkStatus("linking");
    }
  }

  // Ask the server to bind this device to the user who issued the token
  if (linkRequested && (long)(now - linkNextTry) >= 0) {
    linkTries++;
    linkNextTry = millis() + LINK_TRY_INTERVAL_MS;

    uint32_t ctr = nextCtr();   // new ctr every attempt; the server treats a repeated successful claim as idempotent
    String inner = "{\"status\":\"link_device\",\"ctr\":" + String(ctr) + ",\"token\":\"" + linkToken + "\"}";
    String body = encryptPayload(inner);
    String resp;
    int code = body.length() ? postPayload(body, &resp) : -3;

    if (code >= 200 && code < 300) {
      resp.replace(" ", "");
      if (resp.indexOf("\"linked\":true") >= 0) {
        wipePin();                            // new ownership = fresh start; the new owner sets their own PIN
        refreshInfo();
        linkRequested = false;
        linkDone = true;
        linkEndAt = millis() + LINK_AFTER_LINK_MS;
        setLinkStatus("linked");
        signalSent();
      } else {
        String reason = jsonStr(resp, "reason");
        if (reason.length() == 0) reason = "rejected";
        linkRequested = false;               // user can retry with a fresh token inside the window
        setLinkStatus("failed:" + reason);
      }
    } else {
      Serial.println("[LINK] attempt " + String(linkTries) + " failed: " + sendError(code));
      if (linkTries >= LINK_MAX_TRIES) {
        linkRequested = false;
        setLinkStatus("failed:network");
      }
    }
  }
}

// ---------- Heartbeat ----------
void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  lastTelemetryAt = millis();
  uint32_t ctr = nextCtr();
  String body = encryptPayload(buildHeartbeatPayload(ctr));
  String resp;
  int code = body.length() ? postPayload(body, &resp) : -3;
  if (code >= 200 && code < 300) {
    Serial.println("[TELEMETRY] sent battery=" + String(readBatteryPercent()) + "% rssi=" + String(WiFi.RSSI()) +
                   " dBm lock=" + String(pinSet ? 1 : 0));
    resp.replace(" ", "");
    // Server says this band is not locked but we are: stale PIN (e.g. after an admin reset). Drop it.
    if (pinSet && resp.indexOf("\"pin_clear\":true") >= 0) {
      wipePin();
      refreshInfo();
      Serial.println("[PIN] cleared: server says this band is not locked");
    }
  } else {
    lastTelemetryAt = millis() - (TELEMETRY_INTERVAL_MS - 30000UL);   // retry in 30 s, not every loop
    Serial.println("[TELEMETRY] failed: " + sendError(code));
  }
}

// ---------- Tracking ----------
unsigned long currentInterval() {
  unsigned long el = millis() - alertStart;
  unsigned long iv;
  if (el < TRACK_PHASE1_END_MS)      iv = TRACK_PHASE1_MS;
  else if (el < TRACK_PHASE2_END_MS) iv = TRACK_PHASE2_MS;
  else if (el < TRACK_PHASE3_END_MS) iv = TRACK_PHASE3_MS;
  else                               iv = TRACK_PHASE4_MS;

  // Moving fast: tighten (never loosen)
  if (gps.speed.isValid() && gps.speed.age() < 5000 && gps.speed.kmph() > TRACK_FAST_KMPH) {
    if (TRACK_FAST_MS < iv) iv = TRACK_FAST_MS;
  }

  // Low battery: stretch
  int bat = readBatteryPercent();
  if (bat >= 0) {
    if (bat < TRACK_BAT_CRIT_PCT) { if (TRACK_PHASE4_MS > iv) iv = TRACK_PHASE4_MS; }
    else if (bat < TRACK_BAT_LOW_PCT) iv *= 2;
  }
  return iv;
}

void beginTracking() {
  if (!TRACKING_ENABLED) { state = IDLE; return; }
  state = TRACKING;
  updatesSent = 0;
  lastTrackErr = 0;
  nextUpdateAt = millis() + currentInterval();
  Serial.println("[TRACK] started, first update in " + String((nextUpdateAt - millis()) / 1000) + "s");
}

void stopTracking(const char* why, bool feedback) {
  state = IDLE;
  ignoreUntilRelease = true;
  allOff();
  if (feedback) signalCancel();
  Serial.println("[TRACK] stopped: " + String(why) + " (" + String(updatesSent) + " updates sent)");
}

void doTrackingUpdate() {
  unsigned long now = millis();
  bool haveLoc = resolveLocation();

  // Skip if we are on a live GPS fix and have barely moved, unless a heartbeat is due
  if (haveLoc && haveLastSent && strcmp(locSrc, "gps") == 0 &&
      (now - lastSentAt) < TRACK_HEARTBEAT_MS &&
      TinyGPSPlus::distanceBetween(locLat, locLng, lastSentLat, lastSentLng) < TRACK_MIN_MOVE_M) {
    nextUpdateAt = now + currentInterval();
    return;
  }

  uint32_t ctr = nextCtr();
  String body = encryptPayload(buildPayload("panic_update", ctr, activationCtr));
  String resp;
  int code = body.length() ? postPayload(body, &resp) : -3;

  if (code >= 200 && code < 300) {
    updatesSent++;
    lastSentAt = millis();
    lastSentLat = locLat; lastSentLng = locLng; haveLastSent = haveLoc;
    if (lastTrackErr != 0) { Serial.println("[TRACK] link restored"); lastTrackErr = 0; }
    Serial.println("[TRACK] #" + String(updatesSent) + " sent " + lastLocMsg);

    // Downlink: server tells the device the alert was resolved / marked false alarm
    resp.replace(" ", "");
    if (resp.indexOf("\"stop\":true") >= 0) { stopTracking("server closed the alert", false); return; }

    nextUpdateAt = millis() + currentInterval();
  } else {
    if (code != lastTrackErr) {
      lastTrackErr = code;
      Serial.println("[TRACK] update failed: " + sendError(code) + ", retrying");
    }
    nextUpdateAt = millis() + TRACK_RETRY_MS;
  }
}

// ---------- State ----------
void startCountdown() {
  endLinkMode("alert started");                   // free BLE/heap for the alert
  resumeTrackingOnCancel = (state == TRACKING);   // remember if we interrupted tracking
  state = COUNTDOWN;
  countdownStart = millis();
  ignoreUntilRelease = true;
  countdownFeedback();
  Serial.println(resumeTrackingOnCancel
    ? "[ALERT] new countdown started (hold 1.5s to cancel and resume tracking)"
    : "[ALERT] countdown started (hold button 1.5s to cancel)");
}

void cancelCountdown() {
  ignoreUntilRelease = true;
  allOff();
  signalCancel();
  if (resumeTrackingOnCancel) {
    state = TRACKING;
    nextUpdateAt = millis();                       // send a position straight away
    Serial.println("[ALERT] new alert cancelled, tracking resumed");
  } else {
    state = IDLE;
    Serial.println("[ALERT] cancelled");
  }
  resumeTrackingOnCancel = false;
}

void triggerAlert() {
  allOff();
  resumeTrackingOnCancel = false;
  activationCtr = nextCtr();
  alertStart = millis();
  haveLastSent = false;
  sendAttempts = 0;
  lastSendErr = 0;
  state = SENDING;
  lastAttempt = 0;
  buildPayload("panic_activated", activationCtr, 0);   // resolves location for the log line
  Serial.println("[ALERT] TRIGGERED ctr=" + String(activationCtr) + " location=" + lastLocMsg);
}

void updateButton() {
  int raw = digitalRead(BUTTON_PIN);
  unsigned long now = millis();
  if (raw != lastRaw) { lastChange = now; lastRaw = raw; }

  if ((now - lastChange) > DEBOUNCE_MS) {
    bool down = (raw == LOW);
    if (down != btnDown) {
      btnDown = down;
      if (btnDown) {
        pressStart = now;                       // press: only record it, decide on release
      } else {
        unsigned long held = now - pressStart;
        if (!ignoreUntilRelease) {
          if (state == IDLE) {
            startCountdown();                   // tap or short hold => panic alert (never PIN-gated)
          } else if (state == TRACKING && held < TRACK_STOP_HOLD_MS) {
            startCountdown();                   // tap while tracking => new alert
          }
        }
        ignoreUntilRelease = false;
      }
    }
  }

  // Hold 1.5 s during the countdown = cancel
  if (state == COUNTDOWN && btnDown && !ignoreUntilRelease && (now - pressStart) >= CANCEL_HOLD_MS) {
    cancelCountdown();
  }

  // Hold 1.5 s while tracking = stop tracking (can be disabled on PIN-locked bands)
  if (state == TRACKING && btnDown && !ignoreUntilRelease && (now - pressStart) >= TRACK_STOP_HOLD_MS &&
      !(LOCKED_DISABLES_MANUAL_STOP && pinSet)) {
    stopTracking("stopped by user", true);
  }

  // Hold 5 s while idle = link mode (this hold will NOT start an alert)
  if (BLE_LINKING_ENABLED && state == IDLE && btnDown && !ignoreUntilRelease && !linkMode &&
      (now - pressStart) >= LINK_HOLD_MS) {
    ignoreUntilRelease = true;
    enterLinkMode();
    if (linkMode) { beep(80); delay(80); beep(80); }
  }

  // LED stays on while the button is held (idle only), so you can see the press registered
  if (state == IDLE && !linkMode && !SILENT_MODE) ledSet(btnDown && !ignoreUntilRelease);
}

// Dev shortcuts on the Serial Monitor: 'l' = link mode, 'x' = wipe the PIN stored on this band
void handleSerialCommands() {
  if (!DEV_SERIAL_COMMANDS) return;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'l' || c == 'L') {
      if (state == IDLE) enterLinkMode();
      else Serial.println("[LINK] busy, finish the current alert first");
    } else if (c == 'x' || c == 'X') {
      wipePin();
      refreshInfo();
      Serial.println("[PIN] wiped on this band (dev command)");
    }
  }
}

// ---------- WiFi: single owner, backoff, alternating reconnect/fresh start ----------
void wifiConnectFresh() {
  WiFi.disconnect(true, false);   // radio off
  delay(200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void maintainWifi() {
  bool up = (WiFi.status() == WL_CONNECTED);

  if (up != wifiWasUp) {
    wifiWasUp = up;
    if (up) {
      Serial.println("[WIFI] connected, IP " + WiFi.localIP().toString() + ", " + String(WiFi.RSSI()) + " dBm");
      wifiAttempt = 0;
      wifiBackoff = WIFI_BACKOFF_MIN_MS;
    } else {
      Serial.println("[WIFI] lost, reconnecting...");
      lastWifiTry = millis();
      wifiBackoff = WIFI_BACKOFF_MIN_MS;
    }
  }
  if (up) return;

  if (millis() - lastWifiTry >= wifiBackoff) {
    lastWifiTry = millis();
    wifiAttempt++;
    unsigned long next = wifiBackoff * 2;
    wifiBackoff = (next > WIFI_BACKOFF_MAX_MS) ? WIFI_BACKOFF_MAX_MS : next;
    Serial.println("[WIFI] retry #" + String(wifiAttempt) + " (next in " + String(wifiBackoff / 1000) + "s)");
    if (wifiAttempt == 3) Serial.println("[WIFI] check: hotspot on, 2.4GHz, SSID/password");
    if (wifiAttempt % 2 == 1) WiFi.reconnect();
    else wifiConnectFresh();
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  allOff();

  // Button held at power-on = link mode
  bool bootLink = (digitalRead(BUTTON_PIN) == LOW);
  if (bootLink) { delay(60); bootLink = (digitalRead(BUTTON_PIN) == LOW); }

  prefs.begin("basteon", false);       // namespace name kept so existing counters/keys survive
  if (prefs.getBytesLength("key") == 32) prefs.getBytes("key", deviceKey, 32);
  else memcpy(deviceKey, DEV_KEY, 32);

  cachedLat = prefs.getDouble("lat", 999.0);
  cachedLng = prefs.getDouble("lng", 999.0);
  hasCached = (cachedLat >= -90 && cachedLat <= 90 && cachedLng >= -180 && cachedLng <= 180);

  loadPin();

  Serial2.setRxBufferSize(1024);
  Serial2.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);     // maintainWifi() owns reconnecting
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lastWifiTry = millis();
  deviceId = WiFi.macAddress();
  deviceId.replace(":", "");

  Serial.println();
  Serial.println("[BOOT] Kiki Band v" + String(FW_VERSION) + ", device id: " + deviceId);
  Serial.println("[BOOT] pins: button=" + String(BUTTON_PIN) + " led=" + String(LED_PIN) + " buzzer=" + String(BUZZER_PIN));
  Serial.println(String("[BOOT] live tracking: ") + (TRACKING_ENABLED ? "on" : "off") +
                 ", PIN lock: " + (pinSet ? "ON" : "off") + (pinSet && pinFails >= PIN_MAX_FAILS ? " (locked out)" : ""));
  Serial.println("[BOOT] link mode: hold button 5 s until two beeps, or send 'l' in Serial Monitor, or hold it while resetting");
  Serial.println("[WIFI] connecting to " + String(WIFI_SSID) + "...");

  if (bootLink) {
    ignoreUntilRelease = true;      // don't treat the held button as an alert
    enterLinkMode();
  }
}

void loop() {
  pollGps();
  trackGps();
  updateButton();
  handleSerialCommands();
  maintainWifi();
  linkTick();

  // Heartbeat only when idle, button up and no phone mid-conversation (it blocks for up to 8 s on a bad link)
  if (state == IDLE && !btnDown && !linkBusy() && millis() - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) sendHeartbeat();

  switch (state) {
    case COUNTDOWN:
      if (millis() - countdownStart >= COUNTDOWN_MS) triggerAlert();
      else countdownFeedback();
      break;

    case SENDING:
      if (millis() - lastAttempt >= RETRY_INTERVAL_MS) {
        lastAttempt = millis();
        sendAttempts++;
        // Rebuilt on every attempt so a delayed alert always carries the freshest location.
        // The ctr stays the same, so the server still sees one alert.
        String body = encryptPayload(buildPayload("panic_activated", activationCtr, 0));
        int code = body.length() ? postPayload(body, nullptr) : -3;
        if (code >= 200 && code < 300) {
          Serial.println("[ALERT] SENT OK (HTTP " + String(code) + ", attempt " + String(sendAttempts) + ")");
          signalSent();
          lastSentAt = millis();
          lastSentLat = locLat; lastSentLng = locLng; haveLastSent = true;
          beginTracking();
        } else if (code != lastSendErr || sendAttempts % 10 == 0) {
          lastSendErr = code;
          Serial.println("[ALERT] send failed: " + sendError(code) + " (attempt " + String(sendAttempts) + "), still retrying");
        }
      }
      break;

    case TRACKING:
      if (millis() - alertStart >= TRACK_MAX_MS) stopTracking("time limit reached", false);
      else if ((long)(millis() - nextUpdateAt) >= 0) doTrackingUpdate();
      break;

    default: break;
  }
}