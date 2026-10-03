// ===== Basteon Panic Unit v2.4: ESP32 + GPS + AES-256-GCM + live tracking =====
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <TinyGPSPlus.h>
#include "mbedtls/gcm.h"
#include "mbedtls/base64.h"
#include "esp_random.h"

// ---------- Config (EDIT THESE) ----------
const char* WIFI_SSID   = "YOUR_WIFI_SSID";
const char* WIFI_PASS   = "YOUR_WIFI_PASSWORD";
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

// ---------- Live tracking (periodic updates after the first alert) ----------
const bool          TRACKING_ENABLED     = true;
// Schedule, measured from the moment the alert was activated:
const unsigned long TRACK_PHASE1_END_MS  = 120000UL;    // 0-2 min
const unsigned long TRACK_PHASE1_MS      = 10000UL;     //   every 10 s
const unsigned long TRACK_PHASE2_END_MS  = 600000UL;    // 2-10 min
const unsigned long TRACK_PHASE2_MS      = 30000UL;     //   every 30 s
const unsigned long TRACK_PHASE3_END_MS  = 3600000UL;   // 10-60 min
const unsigned long TRACK_PHASE3_MS      = 60000UL;     //   every 60 s
const unsigned long TRACK_PHASE4_MS      = 300000UL;    // 60 min onward: every 5 min
const unsigned long TRACK_MAX_MS         = 10800000UL;  // hard stop after 3 h
// Motion-aware:
const double        TRACK_MIN_MOVE_M     = 25.0;        // moved less than this => skip (unless heartbeat due)
const unsigned long TRACK_HEARTBEAT_MS   = 120000UL;    // always send at least this often
const double        TRACK_FAST_KMPH      = 30.0;        // faster than this => tighten interval
const unsigned long TRACK_FAST_MS        = 10000UL;
// Battery-aware (only active when USE_BATTERY_SENSE is 1):
const int           TRACK_BAT_LOW_PCT    = 20;          // below: intervals x2
const int           TRACK_BAT_CRIT_PCT   = 10;          // below: at most every 5 min
// Failure handling and manual control:
const unsigned long TRACK_RETRY_MS       = 5000UL;      // after a failed update, try again soon
const unsigned long TRACK_STOP_HOLD_MS   = 1500UL; //5000UL;      // hold button this long to stop tracking


enum DeviceState { IDLE, COUNTDOWN, SENDING, TRACKING };
DeviceState state = IDLE;

Preferences prefs;
TinyGPSPlus gps;
String deviceId;
unsigned long countdownStart = 0, lastAttempt = 0, lastCacheSave = 0;
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
bool          forceUpdate = false;
unsigned int  updatesSent = 0;
int           lastTrackErr = 0;

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
bool resumeTrackingOnCancel = false;   // true if a new countdown interrupted active tracking

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

uint32_t nextCtr() {
  uint32_t c = prefs.getUInt("ctr", 0) + 1;
  prefs.putUInt("ctr", c);
  return c;
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
  forceUpdate = false;
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

  // Skip if we are on a live GPS fix and have barely moved, unless a heartbeat is due or user forced it
  if (!forceUpdate && haveLoc && haveLastSent && strcmp(locSrc, "gps") == 0 &&
      (now - lastSentAt) < TRACK_HEARTBEAT_MS &&
      TinyGPSPlus::distanceBetween(locLat, locLng, lastSentLat, lastSentLng) < TRACK_MIN_MOVE_M) {
    nextUpdateAt = now + currentInterval();
    return;
  }
  forceUpdate = false;

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

    // Optional downlink: server tells the device the alert was resolved / marked false alarm
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
        pressStart = now;
        if (state == IDLE && !ignoreUntilRelease) startCountdown();
      } else {
        // Released. A short tap while tracking = start a new alert.
        // (A long hold already stopped tracking and set ignoreUntilRelease.)
        if (state == TRACKING && !ignoreUntilRelease && (now - pressStart) < TRACK_STOP_HOLD_MS) {
          startCountdown();
        }
        ignoreUntilRelease = false;
      }
    }
  }
  if (state == COUNTDOWN && btnDown && !ignoreUntilRelease && (now - pressStart) >= CANCEL_HOLD_MS) {
    cancelCountdown();
  }
  if (state == TRACKING && btnDown && !ignoreUntilRelease && (now - pressStart) >= TRACK_STOP_HOLD_MS) {
    stopTracking("stopped by user", true);
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

  prefs.begin("basteon", false);
  if (prefs.getBytesLength("key") == 32) prefs.getBytes("key", deviceKey, 32);
  else memcpy(deviceKey, DEV_KEY, 32);

  cachedLat = prefs.getDouble("lat", 999.0);
  cachedLng = prefs.getDouble("lng", 999.0);
  hasCached = (cachedLat >= -90 && cachedLat <= 90 && cachedLng >= -180 && cachedLng <= 180);

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
  Serial.println("[BOOT] Basteon Panic Unit v2.4, device id: " + deviceId);
  Serial.println("[BOOT] pins: button=" + String(BUTTON_PIN) + " led=" + String(LED_PIN) + " buzzer=" + String(BUZZER_PIN));
  Serial.println(String("[BOOT] live tracking: ") + (TRACKING_ENABLED ? "on" : "off"));
  Serial.println("[WIFI] connecting to " + String(WIFI_SSID) + "...");
}

void loop() {
  pollGps();
  trackGps();
  updateButton();
  maintainWifi();

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