// ===== Kiki Band v2.7 (fixed): ESP32 + GPS + ACCELEROMETER + motion fusion + AES-256-GCM + live tracking + BLE linking + PIN lock =====
//
// FIXES vs the broken v2.7:
//  * WiFi credentials fall back to the v2.6 values again (no kiki-secrets.h needed).
//  * Dev key (v2.6 behaviour) is used when no key was provisioned in NVS, so encrypted posts work again.
//  * TLS uses setInsecure() like v2.6 (cert bundle verification fails without a valid clock).
//  * I2C timeout shortened so probing for a missing accelerometer can never stall the button.
//
// WIRING (everything is auto-detected, just plug in and reboot, hot-plug also works for the IMU):
//   GPS module (NEO-6M / NEO-7M / NEO-8M / any NMEA):  VCC->3V3 (or 5V if the board needs it)  GND->GND
//                                                      GPS TX -> ESP32 GPIO16 (RX2)   GPS RX -> ESP32 GPIO17 (TX2)
//   Accelerometer (I2C): VCC->3V3  GND->GND  SDA->GPIO21  SCL->GPIO22
//                        Supported: MPU6050 / MPU6500 / MPU9250 (0x68,0x69), ADXL345 (0x53,0x1D), LIS3DH (0x18,0x19)
//   Button GPIO13 -> GND, LED GPIO2, buzzer GPIO4
//
// Libraries needed: TinyGPSPlus, NimBLE-Arduino.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <TinyGPSPlus.h>
#include <NimBLEDevice.h>
#include <Wire.h>
#include "mbedtls/gcm.h"
#include "mbedtls/md.h"
#include "mbedtls/base64.h"
#include "esp_random.h"

#if __has_include("kiki-secrets.h")
#include "kiki-secrets.h"
#endif

#ifndef WIFI_SSID
#define WIFI_SSID "HUAWEI_B311_CC04"
#endif
#ifndef WIFI_PASS
#define WIFI_PASS "TLgNg6ih7NH"
#endif

const char* FW_VERSION = "2.7";

// ---------- Config ----------
const char* BACKEND_URL = "https://xsfhstvydstxeadiynom.supabase.co/functions/v1/secure-alert";
const bool  SILENT_MODE = false;              // true = no buzzer, no LED during countdown

// Wiring polarity: false = other leg to GND (correct). true = other leg to 3V3.
const bool LED_ACTIVE_LOW    = false;
const bool BUZZER_ACTIVE_LOW = true;

// Dev location: used ONLY while no GPS module has ever been detected. Auto-disabled forever once a GPS is seen.
const bool   USE_DEV_FALLBACK_LOCATION = true;
const double DEV_FALLBACK_LAT = -23.9667;
const double DEV_FALLBACK_LNG = 29.7;

#define USE_BATTERY_SENSE 0
const int BATTERY_PIN = 34;

uint8_t deviceKey[32];
bool deviceKeyProvisioned = false;

// DEV ONLY: same key as v2.6 (ASCII "12345678901234567890123456789012").
// Provision a unique key via KEY:<base64> on the Serial Monitor before shipping.
const uint8_t DEV_KEY[32] = {'1','2','3','4','5','6','7','8','9','0','1','2','3','4','5','6',
                             '7','8','9','0','1','2','3','4','5','6','7','8','9','0','1','2'};

// ---------- Pins ----------
const int BUTTON_PIN = 13;   // button to GND (internal pull-up)
const int LED_PIN    = 2;    // onboard LED / external LED via 220R
const int BUZZER_PIN = 4;    // active buzzer + leg
const int GPS_RX_PIN = 16;   // ESP32 RX2 <- GPS TX
const int GPS_TX_PIN = 17;   // ESP32 TX2 -> GPS RX
const int I2C_SDA_PIN = 21;  // accelerometer SDA
const int I2C_SCL_PIN = 22;  // accelerometer SCL

// ---------- GPS ----------
const bool     GPS_AUTO_BAUD = true;
const uint32_t GPS_BAUDS[]   = {9600, 38400, 115200, 4800};
const uint8_t  GPS_BAUD_COUNT = 4;
const unsigned long GPS_BAUD_TRY_MS   = 4000UL;
const unsigned long GPS_SILENCE_RELOCK_MS = 30000UL;

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

// ---------- Motion detection (GPS + accelerometer fusion) ----------
const bool          IMU_ENABLED       = true;
const unsigned long IMU_SAMPLE_MS     = 20;          // 50 Hz
const unsigned long IMU_RESCAN_MS     = 10000UL;
const float         IMU_STILL_MG      = 18.0f;
const float         IMU_WALK_MIN_MG   = 60.0f;
const float         STEP_THRESH_G     = 0.10f;
const double        MOT_WALK_KMH      = 3.0;
const double        MOT_VEHICLE_KMH   = 12.0;
const unsigned long MOT_UP_MS         = 3000UL;
const unsigned long MOT_DOWN_MS       = 20000UL;
const unsigned long MOT_UNKNOWN_HOLD_MS = 30000UL;
const bool          MOTION_DEBUG      = true;        // set false for production

// ---------- Live tracking ----------
const bool          TRACKING_ENABLED     = true;
const unsigned long TRACK_PHASE1_END_MS  = 120000UL;
const unsigned long TRACK_PHASE1_MS      = 10000UL;
const unsigned long TRACK_PHASE2_END_MS  = 600000UL;
const unsigned long TRACK_PHASE2_MS      = 30000UL;
const unsigned long TRACK_PHASE3_END_MS  = 3600000UL;
const unsigned long TRACK_PHASE3_MS      = 60000UL;
const unsigned long TRACK_PHASE4_MS      = 300000UL;
const unsigned long TRACK_MAX_MS         = 10800000UL;  // hard stop after 3 h
const double        TRACK_MIN_MOVE_M     = 25.0;
const unsigned long TRACK_HEARTBEAT_MS   = 120000UL;
const double        TRACK_FAST_KMPH      = 30.0;
const unsigned long TRACK_FAST_MS        = 10000UL;
const int           TRACK_BAT_LOW_PCT    = 20;
const int           TRACK_BAT_CRIT_PCT   = 10;
const unsigned long TRACK_RETRY_MS       = 5000UL;
const unsigned long TRACK_STOP_HOLD_MS   = 1500UL;      // use 3-5 s in production
// Motion-aware tracking
const unsigned long TRACK_VEHICLE_MS        = 5000UL;
const unsigned long TRACK_WALK_MS           = 10000UL;
const unsigned long TRACK_FIRST_MOVING_MS   = 3000UL;
const unsigned long TRACK_MOTION_GAP_MS     = 3000UL;
const unsigned long TRACK_STILL_AFTER_MS    = 300000UL;
const unsigned long TRACK_STILL_MS          = 30000UL;

// ---------- BLE device linking ----------
const bool          BLE_LINKING_ENABLED  = true;
const unsigned long LINK_WINDOW_MS       = 300000UL;
const int           LINK_MAX_TRIES       = 5;
const unsigned long LINK_TRY_INTERVAL_MS = 3000UL;
const unsigned long LINK_HOLD_MS         = 5000UL;
const unsigned long LINK_AFTER_LINK_MS   = 20000UL;
#define BLE_SERVICE_UUID "7b1c0001-4e5a-4a6d-9c1b-8f3a2d5e6b00"
#define BLE_CHR_INFO     "7b1c0002-4e5a-4a6d-9c1b-8f3a2d5e6b00"
#define BLE_CHR_TOKEN    "7b1c0003-4e5a-4a6d-9c1b-8f3a2d5e6b00"
#define BLE_CHR_STATUS   "7b1c0004-4e5a-4a6d-9c1b-8f3a2d5e6b00"
#define BLE_CHR_CTRL     "7b1c0005-4e5a-4a6d-9c1b-8f3a2d5e6b00"
#define BLE_CHR_NONCE    "7b1c0006-4e5a-4a6d-9c1b-8f3a2d5e6b00"

#define BLE_REQUIRE_ENCRYPTION 0
#if BLE_REQUIRE_ENCRYPTION
  #define CTRL_PROPS  (NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC)
  #define TOKEN_PROPS (NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC)
#else
  #define CTRL_PROPS  (NIMBLE_PROPERTY::WRITE)
  #define TOKEN_PROPS (NIMBLE_PROPERTY::WRITE)
#endif

// ---------- PIN lock ----------
const bool          PIN_LOCK_ENABLED            = true;
const uint32_t      PIN_PBKDF2_ITERS            = 10000;
const uint8_t       PIN_MAX_FAILS               = 5;
const unsigned long PIN_LOCKOUT_MS              = 900000UL;
const bool          LOCKED_DISABLES_MANUAL_STOP = false;
const bool          DEV_SERIAL_COMMANDS         = true;      // set false for production

enum DeviceState { IDLE, COUNTDOWN, SENDING, TRACKING };
DeviceState state = IDLE;

enum MotState { MOT_UNKNOWN, MOT_STILL, MOT_WALK, MOT_VEHICLE };
enum ImuAct   { ACT_NONE, ACT_STILL, ACT_VIBE, ACT_WALK, ACT_RUN };
enum ImuType  { IMU_NONE, IMU_MPU, IMU_ADXL345, IMU_LIS3DH };

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

// GPS module state
bool          gpsEverSeen = false;
uint8_t       gpsBaudIdx = 0;
bool          gpsBaudLocked = false;
unsigned long gpsBaudSince = 0, lastGpsCharAt = 0;
uint32_t      gpsChecksumBase = 0;

// Motion state
ImuType       imuType = IMU_NONE;
uint8_t       imuAddr = 0;
const char*   imuName = "none";
uint8_t       imuFails = 0;
unsigned long lastImuScan = 0, lastImuSample = 0;
float         gEst = 1.0f;
bool          gInit = false, stepArmed = true;
float         winSumSq = 0;
uint16_t      winN = 0;
uint8_t       winSteps = 0;
unsigned long winStart = 0, lastStepAt = 0;
float         actRmsMg = 0, cadenceHz = 0;
ImuAct        imuAct = ACT_NONE;

MotState      motState = MOT_UNKNOWN, motCand = MOT_UNKNOWN;
const char*   motSrc = "none";
double        motSpeed = -1;
int           motHdg = -1;
unsigned long motChangedAt = 0, motCandSince = 0, lastMotionTick = 0, lastMotDbg = 0;
bool          motChangeFlag = false;
MotState      lastSentMot = MOT_UNKNOWN;

// Tracking state
uint32_t      activationCtr = 0;
unsigned long alertStart = 0;
unsigned long nextUpdateAt = 0;
unsigned long lastSentAt = 0;
bool          haveLastSent = false;
double        lastSentLat = 0, lastSentLng = 0;
unsigned int  updatesSent = 0;
int           lastTrackErr = 0;
bool          resumeTrackingOnCancel = false;

bool btnDown = false, ignoreUntilRelease = false;
int  lastRaw = HIGH;
unsigned long lastChange = 0, pressStart = 0;

// WiFi state
bool wifiWasUp = false;
String wifiSsid = "";
String wifiPassword = "";
bool wifiConfigured = false;
unsigned long lastWifiTry = 0;
unsigned long wifiBackoff = 10000;
unsigned int  wifiAttempt = 0;

// GPS log-on-change state
bool gpsHadFix = false, gpsNoDataWarned = false;

// PIN state
bool          pinSet = false;
uint8_t       pinSalt[16];
uint8_t       pinVerifier[32];
uint8_t       pinFails = 0;
unsigned long pinLockoutUntil = 0;
bool          sessionUnlocked = false;
String        nonceHex = "";

// BLE link state
bool linkMode = false;
unsigned long linkModeUntil = 0;
volatile bool linkTokenWritten = false;
String linkTokenRaw = "";
volatile bool ctrlWritten = false;
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
void gpsBegin(uint8_t idx) {
  gpsBaudIdx = idx % GPS_BAUD_COUNT;
  Serial2.end();
  Serial2.setRxBufferSize(1024);
  Serial2.begin(GPS_BAUDS[gpsBaudIdx], SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  gpsBaudSince = millis();
  gpsChecksumBase = gps.passedChecksum();
}

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
  while (Serial2.available()) { gps.encode(Serial2.read()); lastGpsCharAt = millis(); }
  if (gps.location.isValid() && gps.location.isUpdated()) {
    maybeCacheFix(gps.location.lat(), gps.location.lng());
  }
}

void trackGps() {
  unsigned long now = millis();

  if (!gpsBaudLocked) {
    if (gps.passedChecksum() >= gpsChecksumBase + 3) {
      gpsBaudLocked = true;
      prefs.putUChar("gps_bi", gpsBaudIdx);
      Serial.println("[GPS] NMEA detected at " + String(GPS_BAUDS[gpsBaudIdx]) + " baud");
    } else if (GPS_AUTO_BAUD && (now - gpsBaudSince) >= GPS_BAUD_TRY_MS) {
      gpsBegin(gpsBaudIdx + 1);
    }
  } else if (lastGpsCharAt != 0 && (now - lastGpsCharAt) > GPS_SILENCE_RELOCK_MS) {
    gpsBaudLocked = false;
    Serial.println("[GPS] module went silent, scanning bauds again");
    gpsBegin(gpsBaudIdx);
  }

  if (!gpsEverSeen && gpsBaudLocked) {
    gpsEverSeen = true;
    prefs.putUChar("gps_seen", 1);
    Serial.println("[GPS] module detected, dev fallback location is now permanently disabled");
  }

  bool fix = gps.location.isValid() && gps.location.age() < GPS_FRESH_MS;
  if (fix != gpsHadFix) {
    gpsHadFix = fix;
    Serial.println(fix ? "[GPS] fix acquired, sats=" + String(gps.satellites.value())
                       : "[GPS] fix lost");
  }
  if (!gpsNoDataWarned && now > 15000 && gps.charsProcessed() == 0) {
    gpsNoDataWarned = true;
    Serial.println(String("[GPS] no data from module (not connected?) - ") +
                   ((USE_DEV_FALLBACK_LOCATION && !gpsEverSeen) ? "using dev fallback location" : "alerts will have no live location"));
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
  if (USE_DEV_FALLBACK_LOCATION && !gpsEverSeen) {
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

// ---------- Accelerometer (raw I2C, no libraries) ----------
bool i2cPresent(uint8_t a) {
  Wire.beginTransmission(a);
  return Wire.endTransmission() == 0;
}

bool i2cWrite(uint8_t a, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(a);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool i2cRead(uint8_t a, uint8_t reg, uint8_t* buf, size_t n) {
  Wire.beginTransmission(a);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)a, (int)n) != (int)n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

bool imuInit() {
  if (!IMU_ENABLED) return false;
  uint8_t id = 0;

  // MPU6050 / MPU6500 / MPU9250 family
  for (uint8_t a = 0x68; a <= 0x69; a++) {
    if (!i2cPresent(a)) continue;
    if (i2cRead(a, 0x75, &id, 1) && (id == 0x68 || id == 0x70 || id == 0x71 || id == 0x73 || id == 0x98)) {
      i2cWrite(a, 0x6B, 0x01);
      delay(10);
      i2cWrite(a, 0x1A, 0x03);
      i2cWrite(a, 0x1C, 0x08);   // +-4 g
      i2cWrite(a, 0x6C, 0x07);   // gyros off
      imuType = IMU_MPU; imuAddr = a; imuName = (id == 0x68) ? "MPU6050" : "MPU6500/9250";
      return true;
    }
  }
  // ADXL345
  for (uint8_t a = 0x53; a != 0; a = (a == 0x53) ? 0x1D : 0) {
    if (!i2cPresent(a)) continue;
    if (i2cRead(a, 0x00, &id, 1) && id == 0xE5) {
      i2cWrite(a, 0x2C, 0x0A);
      i2cWrite(a, 0x31, 0x08);
      i2cWrite(a, 0x2D, 0x08);
      imuType = IMU_ADXL345; imuAddr = a; imuName = "ADXL345";
      return true;
    }
  }
  // LIS3DH
  for (uint8_t a = 0x18; a <= 0x19; a++) {
    if (!i2cPresent(a)) continue;
    if (i2cRead(a, 0x0F, &id, 1) && id == 0x33) {
      i2cWrite(a, 0x20, 0x57);
      i2cWrite(a, 0x23, 0x88);
      imuType = IMU_LIS3DH; imuAddr = a; imuName = "LIS3DH";
      return true;
    }
  }
  return false;
}

// Returns acceleration in g
bool imuRead(float& x, float& y, float& z) {
  uint8_t b[6];
  switch (imuType) {
    case IMU_MPU:
      if (!i2cRead(imuAddr, 0x3B, b, 6)) return false;
      x = (int16_t)((b[0] << 8) | b[1]) / 8192.0f;
      y = (int16_t)((b[2] << 8) | b[3]) / 8192.0f;
      z = (int16_t)((b[4] << 8) | b[5]) / 8192.0f;
      return true;
    case IMU_ADXL345:
      if (!i2cRead(imuAddr, 0x32, b, 6)) return false;
      x = (int16_t)((b[1] << 8) | b[0]) / 256.0f;
      y = (int16_t)((b[3] << 8) | b[2]) / 256.0f;
      z = (int16_t)((b[5] << 8) | b[4]) / 256.0f;
      return true;
    case IMU_LIS3DH:
      if (!i2cRead(imuAddr, 0x28 | 0x80, b, 6)) return false;
      x = ((int16_t)((b[1] << 8) | b[0]) >> 4) / 1000.0f;
      y = ((int16_t)((b[3] << 8) | b[2]) >> 4) / 1000.0f;
      z = ((int16_t)((b[5] << 8) | b[4]) >> 4) / 1000.0f;
      return true;
    default: return false;
  }
}

void imuResetWindow(unsigned long now) {
  winStart = now; winSumSq = 0; winN = 0; winSteps = 0;
}

void imuTick() {
  unsigned long now = millis();

  if (imuType == IMU_NONE) {
    if (IMU_ENABLED && (now - lastImuScan) >= IMU_RESCAN_MS) {
      lastImuScan = now;
      if (imuInit()) {
        gInit = false; imuAct = ACT_STILL; imuResetWindow(now);
        Serial.println(String("[IMU] ") + imuName + " detected at 0x" + String(imuAddr, HEX) + ", motion sensing active");
      }
    }
    return;
  }

  if ((now - lastImuSample) < IMU_SAMPLE_MS) return;
  unsigned long dt = now - lastImuSample;
  lastImuSample = now;

  float x, y, z;
  if (!imuRead(x, y, z)) {
    if (++imuFails >= 10) {
      Serial.println(String("[IMU] ") + imuName + " stopped responding, will keep looking");
      imuType = IMU_NONE; imuAct = ACT_NONE; imuName = "none"; imuFails = 0; lastImuScan = now;
    }
    return;
  }
  imuFails = 0;

  if (dt > 500) imuResetWindow(now);

  float mag = sqrtf(x * x + y * y + z * z);
  if (!gInit) { gEst = mag; gInit = true; }
  gEst += 0.02f * (mag - gEst);
  float dyn = mag - gEst;

  winSumSq += dyn * dyn;
  winN++;

  if (stepArmed && dyn > STEP_THRESH_G && (now - lastStepAt) >= 250) {
    winSteps++; lastStepAt = now; stepArmed = false;
  } else if (!stepArmed && dyn < 0.03f) {
    stepArmed = true;
  }

  if ((now - winStart) >= 2000 && winN > 10) {
    actRmsMg = sqrtf(winSumSq / winN) * 1000.0f;
    cadenceHz = winSteps / 2.0f;
    if (actRmsMg < IMU_STILL_MG) imuAct = ACT_STILL;
    else if (cadenceHz >= 1.0f && cadenceHz <= 4.0f && actRmsMg >= IMU_WALK_MIN_MG)
      imuAct = (cadenceHz >= 2.6f && actRmsMg >= 300.0f) ? ACT_RUN : ACT_WALK;
    else imuAct = ACT_VIBE;
    imuResetWindow(now);
  }
}

// ---------- Motion fusion (GPS speed + accelerometer) ----------
const char* motName(MotState m) {
  switch (m) {
    case MOT_STILL:   return "still";
    case MOT_WALK:    return "walking";
    case MOT_VEHICLE: return "vehicle";
    default:          return "unknown";
  }
}

int motRank(MotState m) { return m == MOT_VEHICLE ? 2 : (m == MOT_WALK ? 1 : 0); }
bool isMoving() { return motState == MOT_WALK || motState == MOT_VEHICLE; }

void motionTick() {
  unsigned long now = millis();
  if ((now - lastMotionTick) < 1000) return;
  lastMotionTick = now;

  bool gpsGood = gps.location.isValid() && gps.location.age() < 5000 &&
                 gps.speed.isValid() && gps.speed.age() < 5000 &&
                 (!gps.hdop.isValid() || gps.hdop.hdop() <= 6.0);
  if (gpsGood) {
    double v = gps.speed.kmph();
    motSpeed = (motSpeed < 0) ? v : (0.5 * motSpeed + 0.5 * v);
    motHdg = (gps.course.isValid() && gps.course.age() < 5000 && motSpeed >= MOT_WALK_KMH) ? (int)gps.course.deg() : -1;
  } else {
    motSpeed = -1; motHdg = -1;
  }

  bool imuOk = (imuType != IMU_NONE && imuAct != ACT_NONE);
  bool imuMoving = imuOk && imuAct != ACT_STILL;
  MotState raw; const char* src;

  if (gpsGood) {
    if (motSpeed >= MOT_VEHICLE_KMH) {
      raw = MOT_VEHICLE; src = imuMoving ? "gps+imu" : "gps";
    } else if (motSpeed >= MOT_WALK_KMH) {
      raw = (imuAct == ACT_VIBE) ? MOT_VEHICLE : MOT_WALK;
      src = imuMoving ? "gps+imu" : "gps";
    } else if (imuAct == ACT_WALK || imuAct == ACT_RUN) {
      raw = MOT_WALK; src = "imu";
    } else {
      raw = MOT_STILL; src = imuOk ? "gps+imu" : "gps";
    }
  } else if (imuOk) {
    src = "imu";
    if (imuAct == ACT_STILL) raw = MOT_STILL;
    else if (imuAct == ACT_VIBE) raw = MOT_VEHICLE;
    else raw = MOT_WALK;
  } else {
    raw = MOT_UNKNOWN; src = "none";
  }
  motSrc = src;

  if (raw == motState) {
    motCand = raw;
  } else {
    if (raw != motCand) { motCand = raw; motCandSince = now; }
    unsigned long need;
    if (motState == MOT_UNKNOWN) need = 0;
    else if (raw == MOT_UNKNOWN) need = MOT_UNKNOWN_HOLD_MS;
    else need = (motRank(raw) > motRank(motState)) ? MOT_UP_MS : MOT_DOWN_MS;
    if ((now - motCandSince) >= need) {
      MotState old = motState;
      motState = raw; motChangedAt = now;
      if (state == TRACKING) motChangeFlag = true;
      Serial.println(String("[MOT] ") + motName(old) + " -> " + motName(raw) + " (" + src + ")");
    }
  }

  if (MOTION_DEBUG && (now - lastMotDbg) >= 10000) {
    lastMotDbg = now;
    Serial.println(String("[MOT] ") + motName(motState) + " src=" + motSrc +
                   " spd=" + (motSpeed >= 0 ? String(motSpeed, 1) + "km/h" : String("n/a")) +
                   " imu=" + imuName + " act=" + String((int)actRmsMg) + "mg cad=" + String(cadenceHz, 1) +
                   " sats=" + (gps.satellites.isValid() ? String(gps.satellites.value()) : String("?")));
  }
}

String motionJson() {
  String s = ",\"mot\":\"" + String(motName(motState)) + "\",\"moving\":" + String(isMoving() ? 1 : 0) +
             ",\"msrc\":\"" + String(motSrc) + "\"";
  if (motSpeed >= 0) s += ",\"spd\":" + String(motSpeed, 1);
  if (motHdg >= 0)   s += ",\"hdg\":" + String(motHdg);
  if (motState == MOT_STILL) s += ",\"still_s\":" + String((millis() - motChangedAt) / 1000);
  if (imuType != IMU_NONE && imuAct != ACT_NONE) s += ",\"act\":" + String((int)actRmsMg);
  if (gps.satellites.isValid()) s += ",\"sats\":" + String(gps.satellites.value());
  if (gps.hdop.isValid())       s += ",\"hdop\":" + String(gps.hdop.hdop(), 1);
  return s;
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
  if (!deviceKeyProvisioned) return "";
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

// Returns HTTP code, or -2 = no WiFi, -3 = could not start request, -4 no key, -5 no wifi config, -6 encrypt failed.
int postPayload(const String& body, String* resp) {
  if (!deviceKeyProvisioned) return -4;
  if (!wifiConfigured) return -5;
  if (WiFi.status() != WL_CONNECTED) return -2;
  if (!body.length()) return -6;
  WiFiClientSecure client;
  client.setInsecure();                      // same as working v2.6. TODO prod: client.setCACert(ROOT_CA) + NTP time
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
  if (code == -4) return "device key not provisioned";
  if (code == -5) return "WiFi credentials not configured";
  if (code == -6) return "could not encrypt payload";
  if (code == 401) return "HTTP 401 key mismatch";
  if (code == 403) return "HTTP 403 device not registered";
  if (code == 404) return "HTTP 404 function not deployed";
  if (code < 0)   return "network error " + String(code);
  return "HTTP " + String(code);
}

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
String buildPayload(const char* status, uint32_t ctr, uint32_t ref) {
  String inner = "{\"status\":\"" + String(status) + "\",\"ctr\":" + String(ctr);
  if (ref) inner += ",\"ref\":" + String(ref);
  lastLocMsg = "no location";
  if (resolveLocation()) {
    inner += ",\"lat\":" + String(locLat, 6) + ",\"lng\":" + String(locLng, 6) +
             ",\"src\":\"" + String(locSrc) + "\",\"age\":" + String(locAgeS);
    lastLocMsg = String(locLat, 6) + "," + String(locLng, 6) + " (" + String(locSrc) + ", " + motName(motState) + ")";
  }
  inner += motionJson();
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
  inner += ",\"lock\":" + String(pinSet ? 1 : 0);
  inner += ",\"gps_ok\":" + String((gpsEverSeen && gps.charsProcessed() > 0 && (millis() - lastGpsCharAt) < 10000) ? 1 : 0);
  inner += ",\"fix\":" + String((gps.location.isValid() && gps.location.age() < GPS_FRESH_MS) ? 1 : 0);
  inner += ",\"imu_ok\":" + String(imuType != IMU_NONE ? 1 : 0);
  inner += motionJson();
  inner += ",\"fw\":\"" + String(FW_VERSION) + "\"";
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

void handleCtrl() {
  String c = ctrlRaw;

  if (c.startsWith("UNLOCK:")) {
    if (!pinSet) { sessionUnlocked = true; setLinkStatus("unlocked"); return; }
    if (pinLockedOut()) { setLinkStatus("failed:locked_out"); refreshInfo(); return; }

    uint8_t got[32], expect[32];
    bool fmtOk = hexToBytes(c.substring(7), got, 32);
    hmacSha256(pinVerifier, 32, (const uint8_t*)nonceHex.c_str(), nonceHex.length(), expect);
    bool match = fmtOk && ctEqual(expect, got, 32);
    newNonce();

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
    if (linkDone) linkEndAt = millis() + 5000;
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
  lastTelemetryAt = millis() - (TELEMETRY_INTERVAL_MS - 3000UL);
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

  if (!SILENT_MODE && !linkRequested && !linkDone) {
    unsigned long ph = now % 2000;
    ledSet(ph < 100 || (ph > 250 && ph < 350));
  }

  if (bleServer && bleServer->getConnectedCount() == 0) sessionUnlocked = false;

  if (bleServer && !linkDone && bleServer->getConnectedCount() == 0 &&
      !NimBLEDevice::getAdvertising()->isAdvertising()) {
    NimBLEDevice::getAdvertising()->start();
  }

  if (pinSet && (now - lastInfoRefresh) > 5000) { lastInfoRefresh = now; refreshInfo(); }

  if (ctrlWritten) { ctrlWritten = false; handleCtrl(); }

  if (linkDone) {
    if ((long)(now - linkEndAt) >= 0) endLinkMode("linked");
    return;
  }

  if (!linkRequested && (long)(now - linkModeUntil) >= 0) {
    endLinkMode("window expired");
    return;
  }

  if (linkTokenWritten) {
    linkTokenWritten = false;
    String t = linkTokenRaw;
    if (pinSet && !sessionUnlocked) {
      setLinkStatus("failed:pin_required");
    } else if (!deviceKeyProvisioned) {
      setLinkStatus("failed:key_missing");
      Serial.println("[LINK] cannot claim device: provision its unique key first with KEY:<base64>.");
    } else if (!wifiConfigured) {
      setLinkStatus("failed:wifi_not_configured");
      Serial.println("[LINK] cannot claim device: configure WiFi first with WIFI:<ssid>|<password>.");
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

  if (linkRequested && (long)(now - linkNextTry) >= 0) {
    linkTries++;
    linkNextTry = millis() + LINK_TRY_INTERVAL_MS;

    uint32_t ctr = nextCtr();
    String inner = "{\"status\":\"link_device\",\"ctr\":" + String(ctr) + ",\"token\":\"" + linkToken + "\"}";
    String body = encryptPayload(inner);
    String resp;
    int code = postPayload(body, &resp);

    if (code >= 200 && code < 300) {
      resp.replace(" ", "");
      if (resp.indexOf("\"linked\":true") >= 0) {
        wipePin();
        refreshInfo();
        linkRequested = false;
        linkDone = true;
        linkEndAt = millis() + LINK_AFTER_LINK_MS;
        setLinkStatus("linked");
        signalSent();
      } else {
        String reason = jsonStr(resp, "reason");
        if (reason.length() == 0) reason = "rejected";
        linkRequested = false;
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
  int code = postPayload(body, &resp);
  if (code >= 200 && code < 300) {
    Serial.println("[TELEMETRY] sent battery=" + String(readBatteryPercent()) + "% rssi=" + String(WiFi.RSSI()) +
                   " dBm lock=" + String(pinSet ? 1 : 0) + " mot=" + motName(motState));
    resp.replace(" ", "");
    if (pinSet && resp.indexOf("\"pin_clear\":true") >= 0) {
      wipePin();
      refreshInfo();
      Serial.println("[PIN] cleared: server says this band is not locked");
    }
  } else {
    lastTelemetryAt = millis() - (TELEMETRY_INTERVAL_MS - 30000UL);
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

  if (gps.speed.isValid() && gps.speed.age() < 5000 && gps.speed.kmph() > TRACK_FAST_KMPH) {
    if (TRACK_FAST_MS < iv) iv = TRACK_FAST_MS;
  }

  if (motState == MOT_VEHICLE) { if (TRACK_VEHICLE_MS < iv) iv = TRACK_VEHICLE_MS; }
  else if (motState == MOT_WALK) { if (TRACK_WALK_MS < iv) iv = TRACK_WALK_MS; }
  else if (motState == MOT_STILL && (millis() - motChangedAt) > TRACK_STILL_AFTER_MS && iv < TRACK_STILL_MS) iv = TRACK_STILL_MS;

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
  motChangeFlag = false;
  nextUpdateAt = millis() + (isMoving() ? TRACK_FIRST_MOVING_MS : currentInterval());
  Serial.println("[TRACK] started (" + String(motName(motState)) + "), first update in " + String((nextUpdateAt - millis()) / 1000) + "s");
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

  if (haveLoc && haveLastSent && !isMoving() && lastSentMot == motState && strcmp(locSrc, "gps") == 0 &&
      (now - lastSentAt) < TRACK_HEARTBEAT_MS &&
      TinyGPSPlus::distanceBetween(locLat, locLng, lastSentLat, lastSentLng) < TRACK_MIN_MOVE_M) {
    nextUpdateAt = now + currentInterval();
    return;
  }

  uint32_t ctr = nextCtr();
  String body = encryptPayload(buildPayload("panic_update", ctr, activationCtr));
  String resp;
  int code = postPayload(body, &resp);

  if (code >= 200 && code < 300) {
    updatesSent++;
    lastSentAt = millis();
    lastSentLat = locLat; lastSentLng = locLng; haveLastSent = haveLoc;
    lastSentMot = motState;
    if (lastTrackErr != 0) { Serial.println("[TRACK] link restored"); lastTrackErr = 0; }
    Serial.println("[TRACK] #" + String(updatesSent) + " sent " + lastLocMsg);

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
  endLinkMode("alert started");
  resumeTrackingOnCancel = (state == TRACKING);
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
    nextUpdateAt = millis();
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
  buildPayload("panic_activated", activationCtr, 0);
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
      } else {
        unsigned long held = now - pressStart;
        if (!ignoreUntilRelease) {
          if (state == IDLE) {
            startCountdown();
          } else if (state == TRACKING && held < TRACK_STOP_HOLD_MS) {
            startCountdown();
          }
        }
        ignoreUntilRelease = false;
      }
    }
  }

  if (state == COUNTDOWN && btnDown && !ignoreUntilRelease && (now - pressStart) >= CANCEL_HOLD_MS) {
    cancelCountdown();
  }

  if (state == TRACKING && btnDown && !ignoreUntilRelease && (now - pressStart) >= TRACK_STOP_HOLD_MS &&
      !(LOCKED_DISABLES_MANUAL_STOP && pinSet)) {
    stopTracking("stopped by user", true);
  }

  if (BLE_LINKING_ENABLED && state == IDLE && btnDown && !ignoreUntilRelease && !linkMode &&
      (now - pressStart) >= LINK_HOLD_MS) {
    ignoreUntilRelease = true;
    enterLinkMode();
    if (linkMode) { beep(80); delay(80); beep(80); }
  }

  if (state == IDLE && !linkMode && !SILENT_MODE) ledSet(btnDown && !ignoreUntilRelease);
}

bool provisionDeviceKey(const String& encoded) {
  uint8_t decoded[48] = {};
  size_t decodedLength = 0;
  const int result = mbedtls_base64_decode(
    decoded, sizeof(decoded), &decodedLength,
    reinterpret_cast<const unsigned char*>(encoded.c_str()), encoded.length()
  );
  if (result != 0 || decodedLength != sizeof(deviceKey)) {
    Serial.println("[SETUP] Key rejected: expected base64 for exactly 32 bytes.");
    memset(decoded, 0, sizeof(decoded));
    return false;
  }

  if (prefs.putBytes("key", decoded, sizeof(deviceKey)) != sizeof(deviceKey)) {
    Serial.println("[SETUP] Key could not be saved to NVS.");
    memset(decoded, 0, sizeof(decoded));
    return false;
  }
  memcpy(deviceKey, decoded, sizeof(deviceKey));
  memset(decoded, 0, sizeof(decoded));
  deviceKeyProvisioned = true;
  Serial.println("[SETUP] Unique device key saved to NVS. Key contents were not displayed.");
  return true;
}

bool provisionWifi(const String& value) {
  const int separator = value.indexOf('|');
  if (separator <= 0 || separator > 32 || value.length() - separator - 1 > 63) {
    Serial.println("[SETUP] WiFi rejected: use WIFI:<ssid>|<password> (SSID max 32, password max 63 characters).");
    return false;
  }
  const String ssid = value.substring(0, separator);
  const String password = value.substring(separator + 1);
  if (prefs.putString("wifi_ssid", ssid) != ssid.length() ||
      prefs.putString("wifi_pass", password) != password.length()) {
    Serial.println("[SETUP] WiFi settings could not be saved to NVS.");
    return false;
  }
  wifiSsid = ssid;
  wifiPassword = password;
  wifiConfigured = true;
  wifiAttempt = 0;
  wifiBackoff = WIFI_BACKOFF_MIN_MS;
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  lastWifiTry = millis();
  wifiWasUp = false;
  Serial.println("[SETUP] WiFi settings saved (password hidden); connecting.");
  Serial.println("[WIFI] connecting to " + wifiSsid + "...");
  return true;
}

void printSetupHelp() {
  Serial.println("[SETUP] Serial commands: KEY:<base64-key-from-admin-device-registration>");
  Serial.println("[SETUP] Serial WiFi command: WIFI:<ssid>|<password> (password is not echoed)");
  Serial.println("[SETUP] Controls: l=BLE link mode, x=clear PIN, g=allow dev location, m=sensor status, s=status");
}

void printDeviceStatus() {
  Serial.println("[STATUS] device id=" + deviceId +
                 " key=" + String(deviceKeyProvisioned ? "provisioned" : "MISSING") +
                 " wifi=" + String(WiFi.status() == WL_CONNECTED ? "connected" : (wifiConfigured ? "connecting/disconnected" : "not configured")) +
                 " pin=" + String(pinSet ? "locked" : "not set") +
                 " gps=" + String(gpsHadFix ? "fix" : (gpsEverSeen ? "seen/no fix" : "not detected")) +
                 " imu=" + String(imuName) +
                 " state=" + String(state == IDLE ? "idle" : (state == COUNTDOWN ? "countdown" : (state == SENDING ? "sending" : "tracking"))));
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WIFI] SSID=" + WiFi.SSID() + " IP=" + WiFi.localIP().toString() + " RSSI=" + String(WiFi.RSSI()) + " dBm");
  }
}

void handleSerialCommands() {
  while (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    while (command.endsWith("\r")) command.remove(command.length() - 1);
    if (command.startsWith("KEY:")) {
      provisionDeviceKey(command.substring(4));
      continue;
    }
    if (command.startsWith("WIFI:")) {
      provisionWifi(command.substring(5));
      continue;
    }
    command.trim();
    if (command == "s" || command == "S" || command == "STATUS") {
      printDeviceStatus();
      continue;
    }
    if (command == "l" || command == "L") {
      if (state == IDLE) enterLinkMode();
      else Serial.println("[LINK] busy, finish the current alert first");
    } else if (DEV_SERIAL_COMMANDS && (command == "x" || command == "X")) {
      wipePin();
      refreshInfo();
      Serial.println("[PIN] wiped on this band (dev command)");
    } else if (DEV_SERIAL_COMMANDS && (command == "g" || command == "G")) {
      gpsEverSeen = false;
      prefs.remove("gps_seen");
      Serial.println("[GPS] 'module seen' flag cleared (dev command), dev location allowed again until a GPS is detected");
    } else if (DEV_SERIAL_COMMANDS && (command == "m" || command == "M")) {
      Serial.println(String("[MOT] state=") + motName(motState) + " src=" + motSrc +
                     " spd=" + (motSpeed >= 0 ? String(motSpeed, 1) : String("n/a")) +
                     " hdg=" + String(motHdg) + " imu=" + imuName + "@0x" + String(imuAddr, HEX) +
                     " act=" + String((int)actRmsMg) + "mg cad=" + String(cadenceHz, 1) +
                     " gpsSeen=" + String(gpsEverSeen ? 1 : 0) + " baud=" + String(GPS_BAUDS[gpsBaudIdx]) +
                     " chars=" + String(gps.charsProcessed()) + " sats=" + (gps.satellites.isValid() ? String(gps.satellites.value()) : String("?")));
    }
  }
}

// ---------- WiFi ----------
void wifiConnectFresh() {
  if (!wifiConfigured) return;
  WiFi.disconnect(true, false);
  delay(200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
}

void maintainWifi() {
  if (!wifiConfigured) return;
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
  Serial.setTimeout(30);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  allOff();

  // Button held at power-on = link mode
  bool bootLink = (digitalRead(BUTTON_PIN) == LOW);
  if (bootLink) { delay(60); bootLink = (digitalRead(BUTTON_PIN) == LOW); }

  if (!prefs.begin("basteon", false)) {
    Serial.println("[SECURITY] Cannot open device settings; stopping.");
    while (true) delay(1000);
  }
  WiFi.mode(WIFI_STA);
  deviceId = WiFi.macAddress();
  deviceId.replace(":", "");

  // Key: NVS-provisioned key if present, otherwise the v2.6 dev key (so encrypted posts keep working)
  if (prefs.getBytesLength("key") == 32 && prefs.getBytes("key", deviceKey, 32) == 32) {
    deviceKeyProvisioned = true;
  } else {
    memcpy(deviceKey, DEV_KEY, 32);
    deviceKeyProvisioned = true;
  }

  wifiSsid = prefs.getString("wifi_ssid", "");
  wifiPassword = prefs.getString("wifi_pass", "");
  if (!wifiSsid.length() && WIFI_SSID[0] != '\0') wifiSsid = WIFI_SSID;
  if (!wifiPassword.length() && WIFI_PASS[0] != '\0') wifiPassword = WIFI_PASS;
  wifiConfigured = wifiSsid.length() > 0 && wifiSsid.length() <= 32 && wifiPassword.length() <= 63;
  if (wifiConfigured && !prefs.getString("wifi_ssid", "").length()) {
    prefs.putString("wifi_ssid", wifiSsid);
    prefs.putString("wifi_pass", wifiPassword);
  }

  cachedLat = prefs.getDouble("lat", 999.0);
  cachedLng = prefs.getDouble("lng", 999.0);
  hasCached = (cachedLat >= -90 && cachedLat <= 90 && cachedLng >= -180 && cachedLng <= 180);

  gpsEverSeen = (prefs.getUChar("gps_seen", 0) == 1);

  loadPin();

  uint8_t bi = prefs.getUChar("gps_bi", 0);
  if (bi >= GPS_BAUD_COUNT) bi = 0;
  gpsBegin(bi);

  // Accelerometer on I2C (optional, hot-pluggable)
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  Wire.setTimeOut(10);
  if (imuInit()) {
    imuAct = ACT_STILL; imuResetWindow(millis());
    Serial.println(String("[IMU] ") + imuName + " detected at 0x" + String(imuAddr, HEX) + ", motion sensing active");
  }
  lastImuScan = millis();
  motChangedAt = millis();

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  if (wifiConfigured) {
    WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
    lastWifiTry = millis();
  }

  Serial.println();
  Serial.println("[BOOT] Kiki Band v" + String(FW_VERSION) + ", device id: " + deviceId);
  Serial.println("[BOOT] pins: button=" + String(BUTTON_PIN) + " led=" + String(LED_PIN) + " buzzer=" + String(BUZZER_PIN) +
                 " gps_rx=" + String(GPS_RX_PIN) + " gps_tx=" + String(GPS_TX_PIN) +
                 " i2c_sda=" + String(I2C_SDA_PIN) + " i2c_scl=" + String(I2C_SCL_PIN));
  Serial.println(String("[BOOT] live tracking: ") + (TRACKING_ENABLED ? "on" : "off") +
                 ", PIN lock: " + (pinSet ? "ON" : "off") + (pinSet && pinFails >= PIN_MAX_FAILS ? " (locked out)" : ""));
  Serial.println(String("[BOOT] GPS seen before: ") + (gpsEverSeen ? "yes (dev location disabled)" : "no") +
                 ", IMU: " + imuName);
  Serial.println("[BOOT] link mode: hold button 5 s until two beeps, or send 'l' in Serial Monitor, or hold it while resetting");
  Serial.println(String("[SETUP] device key: ") + (deviceKeyProvisioned ? "ready" : "MISSING"));
  if (wifiConfigured) Serial.println("[WIFI] connecting to " + wifiSsid + "...");
  else Serial.println("[WIFI] credentials not configured; use WIFI:<ssid>|<password> in Serial Monitor.");
  printSetupHelp();
  printDeviceStatus();

  if (bootLink) {
    ignoreUntilRelease = true;
    enterLinkMode();
  }
}

void loop() {
  pollGps();
  trackGps();
  imuTick();
  motionTick();
  updateButton();
  handleSerialCommands();
  maintainWifi();
  linkTick();

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
        String body = encryptPayload(buildPayload("panic_activated", activationCtr, 0));
        int code = postPayload(body, nullptr);
        if (code >= 200 && code < 300) {
          Serial.println("[ALERT] SENT OK (HTTP " + String(code) + ", attempt " + String(sendAttempts) + ")");
          signalSent();
          lastSentAt = millis();
          lastSentLat = locLat; lastSentLng = locLng; haveLastSent = true;
          lastSentMot = motState;
          beginTracking();
        } else if (code != lastSendErr || sendAttempts % 10 == 0) {
          lastSendErr = code;
          Serial.println("[ALERT] send failed: " + sendError(code) + " (attempt " + String(sendAttempts) + "), still retrying");
        }
      }
      break;

    case TRACKING:
      if (millis() - alertStart >= TRACK_MAX_MS) {
        stopTracking("time limit reached", false);
      } else {
        if (motChangeFlag) {
          motChangeFlag = false;
          if (millis() - lastSentAt >= TRACK_MOTION_GAP_MS) nextUpdateAt = millis();
        }
        if ((long)(millis() - nextUpdateAt) >= 0) doTrackingUpdate();
      }
      break;

    default: break;
  }
}
