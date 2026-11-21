/* =====================================================================================
 * PROJECT: LevelEdge Croquet
 * Write the mallet settings and caliration directly to flash
 * ===================================================================================== */

#include <ArduinoBLE.h>
#include <LSM6DS3.h>
#include <Wire.h>
#include <mbed.h>
#include "FastMadgwick.h"

const char* FW_VERSION = "9.8.03";

// --- FEATURE TOGGLES ---
const bool ENABLE_WATCHDOG = false; 

// --- INTERNAL FLASH STORAGE (4KB Sector safely below 0x000ED000 LittleFS & 0x000F4000 Bootloader) ---
const uint32_t PROFILE_FLASH_ADDR  = 0x000EC000;
const uint32_t PROFILE_FLASH_MAGIC = 0x4C564531; // "LVE1"
const uint8_t  PROFILE_SCHEMA_VER  = 1;

struct Quat { float x, y, z, w; };
struct Vec3 { float x, y, z; };

struct CalibrationMatrix {
    float w;
    float x;
    float y;
    float z;
};
CalibrationMatrix hardwareMatrix = {1.0f, 0.0f, 0.0f, 0.0f};

// --- 48-Byte BLE & Flash Mallet Hardware Profile ---
struct __attribute__((packed)) MalletBleProfile {
    uint8_t  version;         // Byte 0: Schema version (1)
    uint8_t  isCalibrated;    // Byte 1: 0 = uncalibrated, 1 = calibrated
    uint16_t reserved;        // Bytes 2-3: 4-byte alignment padding
    float    w;               // Bytes 4-7:   Calibration quaternion W
    float    x;               // Bytes 8-11:  Calibration quaternion X
    float    y;               // Bytes 12-15: Calibration quaternion Y
    float    z;               // Bytes 16-19: Calibration quaternion Z
    float    headLength_cm;   // Bytes 20-23: Mallet head length (default 27.6)
    float    faceWidth_cm;    // Bytes 24-27: Striking face width (default 6.0)
    float    handleLength_cm; // Bytes 28-31: Handle length (default 91.4)
    float    mass_g;          // Bytes 32-35: Mallet mass in grams (default 1000.0)
    float    offsetY_cm;      // Bytes 36-39: Sensor vertical offset Y (default 5.5)
    float    offsetZ_cm;      // Bytes 40-43: Sensor forward offset Z (default 10.0)
    float    sweetSpot_cm;    // Bytes 44-47: Sweet spot tolerance +/- cm (default 1.5)
};

struct __attribute__((packed)) MalletFlashRecord {
    uint32_t magic;
    MalletBleProfile data;
    uint32_t crc32;
};

MalletBleProfile malletProfile;
bool pendingFlashSave = false;

// --- Restored True 32-Byte Payload ---
struct __attribute__((packed)) StrikePacket {
    uint8_t header;     
    int16_t peakG;
    int16_t peakTwist;
    uint8_t dwell;
    int16_t backArc;    
    int16_t faceAngle;
    int16_t zVel;       
    int8_t appliedForce; 
    int16_t backswingTime;  
    int16_t q0; 
    int16_t q1;
    int16_t q2;
    int16_t q3;  
    uint32_t matchTime;
    uint16_t strikeTimeOffset; 
    uint16_t downwardSwingTime;
    int8_t decelFactor;         
};

// --- TIMEOUT CONSTANTS ---
const unsigned long ARMED_TIMEOUT_MS = 30000;
const unsigned long BLE_DISCONNECT_TIMEOUT_MS = 180000;

inline void feedWatchdog() {
    if (ENABLE_WATCHDOG) {
        NRF_WDT->RR[0] = 0x6E524635;
    }
}

bool pendingReboot = false;
unsigned long rebootTriggerTime = 0;

uint32_t currentMatchTime = 0; 
unsigned long armedStateStartTime = 0;

int currentBatteryPct = 100; 

unsigned long inactivityTimeout_ms = 300000;
unsigned long lastActivityTime = 0;
const int IMU_INT_PIN = PIN_LSM6DS3TR_C_INT1; 

LSM6DS3 myIMU(I2C_MODE, 0x6A);
FastMadgwick filter;

float ax = 0.0;
float ay = 0.0;
float az = 1.0;

const float WAKE_GYRO_THRESHOLD = 60.0;
const float HIGH_MOTION_GYRO_THRESHOLD = 800.0;
const float HIGH_MOTION_ACCEL_THRESHOLD = 2.5;
const float IDLE_GYRO_THRESHOLD = 5.0;
const float IDLE_ACCEL_TOLERANCE = 0.1;

BLEService telemetryService("19B30000-E8F2-537E-4F6C-D104768A1214");
BLECharacteristic telemetryChar("19B30001-E8F2-537E-4F6C-D104768A1214", BLERead | BLENotify, 20); 
BLECharacteristic commandChar("19B30002-E8F2-537E-4F6C-D104768A1214", BLEWrite | BLEWriteWithoutResponse, 32);
BLECharacteristic strikeChar("19B30003-E8F2-537E-4F6C-D104768A1214", BLERead | BLENotify, 32);
BLECharacteristic calibrationChar("19B30004-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite, 16); 
BLEStringCharacteristic identityChar("19B30005-E8F2-537E-4F6C-D104768A1214", BLERead, 20);
BLECharacteristic traceChar("19B30006-E8F2-537E-4F6C-D104768A1214", BLERead | BLENotify, 32);
BLECharacteristic profileChar("19B30007-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite, sizeof(MalletBleProfile));

// --- 4ms PRE-IMPACT ROLLING BUFFER ---
struct TracePoint { 
    int16_t q0, q1, q2, q3; 
};
TracePoint traceBuffer[40];
int traceHead = 0;

unsigned long previousBleMillis = 0;
unsigned long previousImuMicros = 0;
const long BLE_INTERVAL = 40; 
const long IMU_INTERVAL_MICROS = 2000;

float radius_m = 1.27;
float mass_kg = 1.0;
float impactThreshold = 1.5;
float offset_m = 0.055;  
float sweetSpot_cm = 1.5; 
float twistTolerance_deg = 1.0;
float pitchOffset = 0.0;
float yawOffset = 0.0;
bool led_guidance_enabled = true; 

float cal_q0 = 1.0f, cal_q1 = 0.0f, cal_q2 = 0.0f, cal_q3 = 0.0f;
int swingGrade = 1; // 1 = Green, 2 = Red
bool hasGradedThisPass = false;

float getCalibratedPitchDeg() {
    return atan2(2.0f * (cal_q0 * cal_q1 + cal_q2 * cal_q3),
                 1.0f - 2.0f * (cal_q1 * cal_q1 + cal_q2 * cal_q2)) * RAD_TO_DEG;
}

float currentAccelMag = 1.0;
float currentOmegaMag = 0.0;

float prevAccelMag = 1.0;
float prevPitchRads = 0.0;
float prevOmegaSigned = 0.0;
float minPitch = 0.0; 
float maxPitch = 0.0;
float currentTwist_deg = 0.0;
bool tareTwistNextFrame = false;

char bleDeviceName[25];

Quat baseQuatInverse = {0.0f, 0.0f, 0.0f, 1.0f};
float twistOffset_deg = 0.0f;

Quat multQuat(Quat a, Quat b) {
    return {
        a.x*b.w + a.w*b.x + a.y*b.z - a.z*b.y,
        a.y*b.w + a.w*b.y + a.z*b.x - a.x*b.z,
        a.z*b.w + a.w*b.z + a.x*b.y - a.y*b.x,
        a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z
    };
}

Quat invertQuat(Quat q) {
    float n = q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w;
    return {-q.x/n, -q.y/n, -q.z/n, q.w/n};
}

Vec3 applyQuat(Vec3 v, Quat q) {
    Quat vq = {v.x, v.y, v.z, 0.0f};
    Quat inv = invertQuat(q);
    Quat res = multQuat(multQuat(q, vq), inv);
    return {res.x, res.y, res.z};
}

float dotVec(Vec3 a, Vec3 b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
Vec3 crossVec(Vec3 a, Vec3 b) { return {a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x}; }
void normVec(Vec3 &v) {
    float l = sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
    if(l > 0.0001f) { v.x/=l; v.y/=l; v.z/=l; }
}

float zVelocity = 0.0;
int8_t appliedForceIndex = 0;
int8_t currentAppliedForce = 0;
float peakPush = 0.0;

float tmPitch[5] = {0};
float tmQ0[5] = {1.0}, tmQ1[5] = {0}, tmQ2[5] = {0}, tmQ3[5] = {0};
float tmVel[5] = {0};
int8_t tmAppForce[5] = {0};
float tmPushForce[5] = {0};
int tmIdx = 0;

float pristinePitch = 0.0;
float pristineQ0 = 1.0, pristineQ1 = 0.0, pristineQ2 = 0.0, pristineQ3 = 0.0;
float pristineVel = 0.0;
int8_t pristineAppForce = 0;
float pristinePushForce = 0.0;

enum AppState {
    STATE_DISCONNECTED = 0,
    STATE_IDLE         = 1,
    STATE_CALIBRATING  = 2,
    STATE_ARMED        = 3,
    STATE_SWINGING     = 4,
    STATE_REVIEW       = 5,
    STATE_STEADYING    = 6
};

AppState currentAppState = STATE_DISCONNECTED;
uint8_t liveFeedbackState = 1; 
bool isArmed = false;
bool needsConnectionCalibration = false;
bool isSwinging = false;
unsigned long strikeHoldEndTime = 0;
uint8_t lastStrikeLedColor = 0; 
bool inImpactWindow = false;
unsigned long topOfBackswingTime = 0;
unsigned long startOfBackswingTime = 0;
bool strikePacketSent = false;
unsigned long impactStartTime = 0;
unsigned long lastImpactTime = 0;
float impactPeakG = 0;
float impactPeakTwist = 0;
int impactDwellSamples = 0;

float impactPeakFaceG = 0; 
float impactPeakShaftG = 0; 

float gyroBiasX = 0, gyroBiasY = 0, gyroBiasZ = 0;
bool isCalibratingBias = false;
int biasSamples = 0;

unsigned long lastLedBlinkTime = 0;
bool ledBlinkState = false;

struct __attribute__((packed)) TelemetryPacket {
    uint16_t timestamp;   
    int16_t q0;
    int16_t q1;           
    int16_t q2;
    int16_t q3;           
    int16_t ax;           
    int16_t ay;           
    int16_t az;           
    int8_t appliedForce;  
    uint8_t appState;     
    uint16_t dynRadius;   
};

bool bleInitialized = false;

void injectGravitySnapshot();
void enterSafeChargingMode();
void powerDown();
void flushPendingFlashSave(bool resumeAdvertising);

void setLEDColor(uint8_t r, uint8_t g, uint8_t b) {
    digitalWrite(LEDR, r > 127 ? LOW : HIGH);
    digitalWrite(LEDG, g > 127 ? LOW : HIGH);
    digitalWrite(LEDB, b > 127 ? LOW : HIGH);
}

// =====================================================================================
// INTERNAL FLASH STORAGE HELPERS (nRF52840 FlashIAP)
// =====================================================================================
uint32_t computeCRC32(const uint8_t* data, size_t len) {
    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int j = 0; j < 8; j++) {
            crc = (crc >> 1) ^ (0xEDB88320 & (-(crc & 1)));
        }
    }
    return ~crc;
}

void resetMalletProfileToDefaults() {
    malletProfile.version = PROFILE_SCHEMA_VER;
    malletProfile.isCalibrated = 0;
    malletProfile.reserved = 0;
    malletProfile.w = 1.0f;
    malletProfile.x = 0.0f;
    malletProfile.y = 0.0f;
    malletProfile.z = 0.0f;
    malletProfile.headLength_cm = 27.6f;
    malletProfile.faceWidth_cm = 6.0f;
    malletProfile.handleLength_cm = 91.4f;
    malletProfile.mass_g = 1000.0f;
    malletProfile.offsetY_cm = 5.5f;
    malletProfile.offsetZ_cm = 10.0f;
    malletProfile.sweetSpot_cm = 1.5f;
}

void applyMalletProfileToRuntime() {
    hardwareMatrix.w = malletProfile.w;
    hardwareMatrix.x = malletProfile.x;
    hardwareMatrix.y = malletProfile.y;
    hardwareMatrix.z = malletProfile.z;
    mass_kg          = malletProfile.mass_g / 1000.0f;
    offset_m         = malletProfile.offsetY_cm / 100.0f;
    sweetSpot_cm     = malletProfile.sweetSpot_cm;
}

void syncProfileToBleCharacteristics() {
    if (!bleInitialized) return;
    calibrationChar.writeValue((uint8_t*)&hardwareMatrix, sizeof(CalibrationMatrix));
    profileChar.writeValue((uint8_t*)&malletProfile, sizeof(MalletBleProfile));
}

void loadMalletProfileFromFlash() {
    resetMalletProfileToDefaults();

    mbed::FlashIAP flash;
    if (flash.init() == 0) {
        MalletFlashRecord rec;
        if (flash.read(&rec, PROFILE_FLASH_ADDR, sizeof(MalletFlashRecord)) == 0) {
            uint32_t expectedCrc = computeCRC32((const uint8_t*)&rec, offsetof(MalletFlashRecord, crc32));
            float qNorm = sqrt(rec.data.w * rec.data.w + rec.data.x * rec.data.x +
                               rec.data.y * rec.data.y + rec.data.z * rec.data.z);

            if (rec.magic == PROFILE_FLASH_MAGIC &&
                rec.data.version == PROFILE_SCHEMA_VER &&
                rec.crc32 == expectedCrc &&
                !isnan(qNorm) && fabs(qNorm - 1.0f) < 0.05f) {
                memcpy(&malletProfile, &rec.data, sizeof(MalletBleProfile));
            }
        }
        flash.deinit();
    }

    applyMalletProfileToRuntime();
}

bool saveMalletProfileToFlash() {
    feedWatchdog();

    MalletFlashRecord rec;
    rec.magic = PROFILE_FLASH_MAGIC;
    memcpy(&rec.data, &malletProfile, sizeof(MalletBleProfile));
    rec.crc32 = computeCRC32((const uint8_t*)&rec, offsetof(MalletFlashRecord, crc32));

    mbed::FlashIAP flash;
    if (flash.init() != 0) return false;

    uint32_t sectorSize = flash.get_sector_size(PROFILE_FLASH_ADDR);
    int eraseRes = flash.erase(PROFILE_FLASH_ADDR, sectorSize);
    int progRes = -1;
    if (eraseRes == 0) {
        progRes = flash.program(&rec, PROFILE_FLASH_ADDR, sizeof(MalletFlashRecord));
    }

    bool verified = false;
    if (progRes == 0) {
        MalletFlashRecord checkRec;
        if (flash.read(&checkRec, PROFILE_FLASH_ADDR, sizeof(MalletFlashRecord)) == 0) {
            verified = (checkRec.magic == PROFILE_FLASH_MAGIC && checkRec.crc32 == rec.crc32);
        }
    }

    flash.deinit();
    feedWatchdog();
    return verified;
}

void sendBatteryUpdate() {
    analogReadResolution(12);
    pinMode(PIN_VBAT_ENABLE, OUTPUT); 
    digitalWrite(PIN_VBAT_ENABLE, LOW); 
    
    delay(2); 
    
    long adcSum = 0;
    const int sampleCount = 8;
    for (int i = 0; i < sampleCount; i++) {
        adcSum += analogRead(PIN_VBAT);
        delayMicroseconds(50);
    }

    int currentRawADC = adcSum / sampleCount;
    
    static float filteredADC = 0;
    
    if (filteredADC == 0) {
        filteredADC = currentRawADC;
    } else {
        filteredADC = (filteredADC * 0.90) + (currentRawADC * 0.10);
    }
    
    float batteryVolts = (filteredADC / 4095.0) * 3.3 * 2.96078;
    uint16_t voltage_mV = (uint16_t)(batteryVolts * 1000);

    uint8_t compressed_V = 0;
    if (voltage_mV > 3000) {
        compressed_V = (voltage_mV - 3000) / 5;
    }

    uint16_t availableStrikes = 5000; 

    uint8_t battPacket[5];
    battPacket[0] = 'B'; 
    battPacket[1] = compressed_V;                   
    
    bool usbPluggedIn = (NRF_POWER->USBREGSTATUS & 1) ? true : false;
    battPacket[2] = usbPluggedIn ? 1 : 0; 
    
    battPacket[3] = availableStrikes & 0xFF;        
    battPacket[4] = (availableStrikes >> 8) & 0xFF; 
    
    strikeChar.writeValue(battPacket, 5);
}

void updateLEDStateMachine() {
    unsigned long currentMillis = millis();
    
    if (strikeHoldEndTime > 0 && currentMillis < strikeHoldEndTime) { 
        if (currentMillis % 100 < 50) {
            if (lastStrikeLedColor == 2) setLEDColor(255, 0, 0);
            else setLEDColor(0, 255, 0);
        } else {
            setLEDColor(0, 0, 0);
        }
        return; 
    }

    switch(currentAppState) {
        case STATE_DISCONNECTED:
            if (currentMillis - lastLedBlinkTime >= 500) {
                lastLedBlinkTime = currentMillis;
                ledBlinkState = !ledBlinkState;
                if (ledBlinkState) setLEDColor(0, 0, 255); 
                else setLEDColor(0, 0, 0);
            } 
            break;
        case STATE_IDLE: 
            if (currentMillis % 2000 < 50) setLEDColor(0, 255, 0); 
            else setLEDColor(0, 0, 0);
            break;
        case STATE_CALIBRATING: setLEDColor(255, 0, 0); break;
        case STATE_STEADYING: setLEDColor(255, 0, 0); break;

        case STATE_ARMED:
        case STATE_SWINGING:
            if (!led_guidance_enabled) {
                setLEDColor(0, 0, 0);
            } else {
                if (liveFeedbackState == 3) { 
                    if (currentMillis % 150 < 75) setLEDColor(255, 0, 0);
                    else setLEDColor(0, 0, 0); 
                } else {
                    float currentPitchDeg = prevPitchRads * RAD_TO_DEG;
                    
                    // 1. Reset the grade when the mallet passes backwards over the virtual ball (0 degrees)
                    if (prevOmegaSigned < 0.0f && currentPitchDeg <= 0.0f) {
                        hasGradedThisPass = false;
                        swingGrade = 1; // Reset to green (ready) for the backswing
                    }
                    
                    // 2. Grade the swing ONLY after a real backswing (>2 deg) as it passes forward through 0 degrees
                    if (!hasGradedThisPass && minPitch < -0.035f && prevOmegaSigned > 0.0f && currentPitchDeg >= 0.0f) {
                        if (fabs(currentTwist_deg) > twistTolerance_deg) {
                            swingGrade = 2;
                        } else {
                            swingGrade = 1;
                        }
                        hasGradedThisPass = true;
                    }
                    
                    if (swingGrade == 1) {
                        setLEDColor(0, 255, 0); 
                    } else {
                        setLEDColor(255, 0, 0); 
                    }
                }
            } 
            break;
        default: setLEDColor(0, 0, 0); break;
    }
}

void injectGravitySnapshot() {
    float snapAx = myIMU.readFloatAccelY(); 
    float snapAy = myIMU.readFloatAccelX();
    float snapAz = -myIMU.readFloatAccelZ();
    
    filter.setBeta(10.0f);
    for(int i = 0; i < 2000; i++) filter.updateIMU(0, 0, 0, snapAx, snapAy, snapAz);
    filter.setBeta(2.0f);
    for(int i = 0; i < 2000; i++) filter.updateIMU(0, 0, 0, snapAx, snapAy, snapAz);
    filter.setBeta(0.2f);
    for(int i = 0; i < 2000; i++) filter.updateIMU(0, 0, 0, snapAx, snapAy, snapAz);
    filter.setBeta(0.01f); 
}

void handleBleCommand(const uint8_t* data, int len, unsigned long currentMillis, unsigned long currentMicros) {
    if (len <= 0) return;

    if (data[0] == 'R') { 
        setLEDColor(255, 0, 0);
        if (bleInitialized) {
            BLE.disconnect();
            BLE.stopAdvertise();
            delay(50);
        }
        flushPendingFlashSave(false);
        pendingReboot = true;
        rebootTriggerTime = currentMillis;
    }
    else if (data[0] == 'L') { 
        currentAppState = STATE_IDLE;
    }
    else if (data[0] == 'W') { 
        resetMalletProfileToDefaults();
        applyMalletProfileToRuntime();
        syncProfileToBleCharacteristics();
        pendingFlashSave = true;

        setLEDColor(255, 0, 0); 
        delay(500); 
        setLEDColor(0, 0, 0);
        sendBatteryUpdate();
    }
    else if (data[0] == 'D') { 
        if (currentAppState == STATE_IDLE || currentAppState == STATE_REVIEW) {
            setLEDColor(0, 0, 255);
            delay(200);
            setLEDColor(0, 0, 0);
        }
    }
    else if (data[0] == 'Z') { 
        currentAppState = STATE_CALIBRATING;
        isCalibratingBias = true; 
        biasSamples = 0; 
        gyroBiasX = 0; 
        gyroBiasY = 0; 
        gyroBiasZ = 0;
        prevPitchRads = 0.01;
        previousImuMicros = currentMicros; 
        sendBatteryUpdate();
    }
    else if (data[0] == 'G') { 
        if (isCalibratingBias) {
            if (biasSamples > 0) { 
                gyroBiasX /= biasSamples;
                gyroBiasY /= biasSamples; 
                gyroBiasZ /= biasSamples; 
            }
            isCalibratingBias = false;
        }
        isArmed = true;
        isSwinging = false; 
        strikeHoldEndTime = 0; 
        currentAppState = STATE_ARMED;

        tareTwistNextFrame = true;

        liveFeedbackState = 1; 
        swingGrade = 1;
        hasGradedThisPass = false;
        previousImuMicros = currentMicros; 
        pitchOffset = getCalibratedPitchDeg();
        yawOffset = filter.getYaw();     
        
        minPitch = 0.0; 
        maxPitch = 0.0;
        zVelocity = 0.0; 
        peakPush = 0.0; 
        appliedForceIndex = 0;
        currentAppliedForce = 0;
        topOfBackswingTime = 0;

        for(int i = 0; i < 5; i++) { 
            tmPitch[i] = 0;
            tmQ0[i] = 1.0; 
            tmQ1[i] = 0; 
            tmQ2[i] = 0;
            tmQ3[i] = 0; 
            tmVel[i] = 0; 
            tmAppForce[i] = 0;
            tmPushForce[i] = 0.0;
        }
        armedStateStartTime = currentMillis; 
    }
    else if (data[0] == 'H') { liveFeedbackState = 1; } 
    else if (data[0] == 'I') { liveFeedbackState = 2; } 
    else if (data[0] == 'J') { liveFeedbackState = 3; } 
    else if (data[0] == 'O') { 
        isArmed = false;
        isSwinging = false; 
        currentAppState = STATE_IDLE; 
        strikeHoldEndTime = 0; 
    }
    else if (data[0] == 'C' && len >= 9) { 
        radius_m = data[1] / 100.0;
        mass_kg = (data[2] * 10.0) / 1000.0; 
        impactThreshold = data[3] / 10.0; 
        offset_m = data[4] / 1000.0;
        inactivityTimeout_ms = data[5] * 60000UL; 
        sweetSpot_cm = data[6] / 10.0; 
        led_guidance_enabled = (data[7] == 1); 
        twistTolerance_deg = data[8] / 10.0;

        if (impactThreshold < 1.0) impactThreshold = 1.0;
        
        String verStr = String("V") + FW_VERSION;
        strikeChar.writeValue((const uint8_t*)verStr.c_str(), verStr.length()); 
        delay(10); 
        sendBatteryUpdate(); 
    }
    else if (data[0] == 'U') { 
        setLEDColor(255, 0, 255); 
        if (bleInitialized) {
            BLE.disconnect();
            BLE.stopAdvertise();
            delay(50);
        }
        flushPendingFlashSave(false);
        NRF_POWER->GPREGRET2 = 0xA5; 
        pendingReboot = true;
        rebootTriggerTime = currentMillis;
    }
    else if (data[0] == 'P') { 
        sendBatteryUpdate(); 
    }
    else if (data[0] == 'X') { 
        feedWatchdog(); 

        setLEDColor(0, 0, 255);
        delay(1000);

        if (bleInitialized) {
            BLE.disconnect();
            BLE.stopAdvertise();
            delay(100);
        }
        flushPendingFlashSave(false);
        
        bool isActuallyPluggedIn = true;
        for (int i = 0; i < 5; i++) {
            if (!(NRF_POWER->USBREGSTATUS & 1)) {
                isActuallyPluggedIn = false; 
                break;
            }
            delay(10);
        }

        if (isActuallyPluggedIn) {
            enterSafeChargingMode();
        } else {
            NRF_POWER->GPREGRET = 0x88;
            NVIC_SystemReset();
        }
    }
}

void updateKinematics(unsigned long currentMillis, unsigned long currentMicros, bool connected) {
    if (currentMicros - previousImuMicros >= IMU_INTERVAL_MICROS) {
        float actualDt = (currentMicros - previousImuMicros) / 1000000.0f;
        previousImuMicros = currentMicros;
        if (actualDt < 0.001f) actualDt = 0.001f;

        float rawAx = myIMU.readFloatAccelX(); 
        float rawAy = myIMU.readFloatAccelY();
        float rawAz = myIMU.readFloatAccelZ();
        float rawGx = myIMU.readFloatGyroX(); 
        float rawGy = myIMU.readFloatGyroY(); 
        float rawGz = myIMU.readFloatGyroZ();
        
        ax = rawAy;
        ay = rawAx; 
        az = -rawAz;
    
        float gx, gy, gz;
        if (isCalibratingBias) {
            gyroBiasX += rawGy; 
            gyroBiasY += rawGx;
            gyroBiasZ += -rawGz; 
            biasSamples++;
            
            if (biasSamples >= 1000) {
                gyroBiasX /= 1000.0;
                gyroBiasY /= 1000.0; 
                gyroBiasZ /= 1000.0; 
                isCalibratingBias = false;
                
                filter.setBeta(10.0f);
                for(int i = 0; i < 1000; i++) filter.updateIMU(0, 0, 0, ax, ay, az);
                filter.setBeta(0.01f);
                if (currentAppState == STATE_CALIBRATING) currentAppState = STATE_STEADYING; 
            }
            gx = 0.0; gy = 0.0; gz = 0.0; 
        } else { 
            gx = rawGy - gyroBiasX;
            gy = rawGx - gyroBiasY;
            gz = -rawGz - gyroBiasZ;
        }

        float accelMag = sqrt(ax*ax + ay*ay + az*az);
        float gyroMag = sqrt(gx*gx + gy*gy + gz*gz); 
        float deltaG = fabs(accelMag - prevAccelMag);

        static int connectionStillnessCounter = 0;
        
        if (needsConnectionCalibration && currentAppState == STATE_IDLE) {
            if (deltaG < 0.015 && fabs(accelMag - 1.0) < 0.1) {
                connectionStillnessCounter++;
            } else {
                connectionStillnessCounter = 0;
            }

            if (connectionStillnessCounter > 500) {
                isCalibratingBias = true;
                biasSamples = 0;
                gyroBiasX = 0;
                gyroBiasY = 0;
                gyroBiasZ = 0;
                
                needsConnectionCalibration = false; 
                connectionStillnessCounter = 0;
            }
        }

        if (gyroMag > 30.0 || deltaG > 0.2) { 
            if (connected) {
                lastActivityTime = currentMillis;
            }
        }

        if (isArmed && gyroMag > WAKE_GYRO_THRESHOLD && currentAppState != STATE_SWINGING) { 
            isSwinging = true;
            currentAppState = STATE_SWINGING; 
        } 

        static int stillnessCount = 0; 
        
        if (accelMag > HIGH_MOTION_ACCEL_THRESHOLD || gyroMag > HIGH_MOTION_GYRO_THRESHOLD) { 
            filter.setBeta(0.0f);
            stillnessCount = 0; 
        } 
        else if (fabs(accelMag - 1.0) < IDLE_ACCEL_TOLERANCE && gyroMag < IDLE_GYRO_THRESHOLD) { 
            filter.setBeta(0.1f);
            stillnessCount++; 
        } 
        else { 
            filter.setBeta(0.01f);
            stillnessCount = 0; 
        }

        if (!inImpactWindow) { 
            filter.begin(1.0f / actualDt);
            filter.updateIMU(gx, gy, gz, ax, ay, az); 
        }

        float raw_q0 = filter.q0;
        float raw_q1 = filter.q1;
        float raw_q2 = filter.q2;
        float raw_q3 = filter.q3;

        float f_q0 = raw_q0 * hardwareMatrix.w - raw_q1 * hardwareMatrix.x - raw_q2 * hardwareMatrix.y - raw_q3 * hardwareMatrix.z;
        float f_q1 = raw_q0 * hardwareMatrix.x + raw_q1 * hardwareMatrix.w + raw_q2 * hardwareMatrix.z - raw_q3 * hardwareMatrix.y;
        float f_q2 = raw_q0 * hardwareMatrix.y - raw_q1 * hardwareMatrix.z + raw_q2 * hardwareMatrix.w + raw_q3 * hardwareMatrix.x;
        float f_q3 = raw_q0 * hardwareMatrix.z + raw_q1 * hardwareMatrix.y - raw_q2 * hardwareMatrix.x + raw_q3 * hardwareMatrix.w;

        float f_norm = sqrt(f_q0*f_q0 + f_q1*f_q1 + f_q2*f_q2 + f_q3*f_q3);
        if (f_norm > 0.0f) {
            f_q0 /= f_norm; f_q1 /= f_norm; f_q2 /= f_norm; f_q3 /= f_norm;
        }
        cal_q0 = f_q0; cal_q1 = f_q1; cal_q2 = f_q2; cal_q3 = f_q3;

        // --- RECORD TO TRACE BUFFER EVERY 4ms ---
        static bool traceTick = false;
        traceTick = !traceTick; 
        if (!inImpactWindow && traceTick) {
            traceBuffer[traceHead].q0 = (int16_t)(f_q0 * 10000.0f);
            traceBuffer[traceHead].q1 = (int16_t)(f_q1 * 10000.0f);
            traceBuffer[traceHead].q2 = (int16_t)(f_q2 * 10000.0f);
            traceBuffer[traceHead].q3 = (int16_t)(f_q3 * 10000.0f);
            traceHead = (traceHead + 1) % 40;
        }

        float calPitch = getCalibratedPitchDeg() - pitchOffset;        
        float pitchRads = calPitch * DEG_TO_RAD;
        float omegaMag = gyroMag * DEG_TO_RAD;

        currentAccelMag = accelMag;
        currentOmegaMag = omegaMag;

        float currentSpeed = omegaMag * radius_m;
        float omegaSigned = (pitchRads > prevPitchRads) ? omegaMag : -omegaMag;

        Quat rawQ = {f_q2, -f_q3, -f_q1, f_q0};
        Quat x180 = {1.0f, 0.0f, 0.0f, 0.0f};
        Quat impact = multQuat(rawQ, x180);
        
        float imp_len = sqrt(impact.x*impact.x + impact.y*impact.y + impact.z*impact.z + impact.w*impact.w);
        if(imp_len > 0.0f) { impact.x/=imp_len; impact.y/=imp_len; impact.z/=imp_len; impact.w/=imp_len; }

        bool doTare = tareTwistNextFrame;
        if (doTare) {
            float sqx = impact.x * impact.x;
            float sqy = impact.y * impact.y;
            float sqz = impact.z * impact.z;
            float sqw = impact.w * impact.w;
            float yaw = atan2(2.0f * (impact.x * impact.z + impact.y * impact.w), sqw - sqx - sqy + sqz);
            
            Quat initialHeading = {0.0f, sin(yaw * 0.5f), 0.0f, cos(yaw * 0.5f)};
            baseQuatInverse = invertQuat(initialHeading);
            tareTwistNextFrame = false;
        }

        Quat iQuat = multQuat(baseQuatInverse, impact);

        Vec3 v = applyQuat({0.0f, 0.0f, 1.0f}, iQuat);
        Vec3 up = applyQuat({0.0f, 1.0f, 0.0f}, iQuat);
        
        float dotZ = up.z; 
        Vec3 projZ = {0.0f - dotZ * up.x, 0.0f - dotZ * up.y, 1.0f - dotZ * up.z};
        
        float deg = 0.0f;
        float lenSq = projZ.x*projZ.x + projZ.y*projZ.y + projZ.z*projZ.z;
        if (lenSq >= 0.0001f) {
            normVec(projZ);
            float dot_vp = dotVec(v, projZ);
            if(dot_vp > 1.0f) dot_vp = 1.0f;
            if(dot_vp < -1.0f) dot_vp = -1.0f;
            float angle = acos(dot_vp);
            
            Vec3 c = crossVec(projZ, v);
            if (dotVec(c, up) < 0.0f) angle = -angle;
            
            deg = angle * RAD_TO_DEG;
            if (deg > 90.0f) deg -= 180.0f;
            else if (deg < -90.0f) deg += 180.0f;
        }

        if (doTare) twistOffset_deg = deg;
        currentTwist_deg = deg - twistOffset_deg;

        if (!inImpactWindow) {
            if (omegaSigned < 0.0f && prevOmegaSigned >= 0.0f && pitchRads > -0.087f) {
                startOfBackswingTime = currentMillis;
                minPitch = pitchRads;
                topOfBackswingTime = 0;
                zVelocity = 0.0;
            }

            static float maxAngularAccel = 0.0f;
            static float smoothedAccel = 0.0f;

            if (pitchRads < minPitch) {
                minPitch = pitchRads;
                topOfBackswingTime = currentMillis;
                currentAppliedForce = 0;
                maxAngularAccel = 0.0f;
                smoothedAccel = 0.0f; 
            }

            if (omegaSigned > 0.0f && pitchRads < 0.0f) {
                float raw_accel = (currentOmegaMag - fabs(prevOmegaSigned)) / actualDt;
                smoothedAccel = (smoothedAccel * 0.90f) + (raw_accel * 0.10f);
                if (smoothedAccel > maxAngularAccel) {
                    maxAngularAccel = smoothedAccel;
                }
            }

            if (topOfBackswingTime > 0 && omegaSigned > 0 && pitchRads < 0.0) {
                float exact_gravity_accel = (9.81f / radius_m) * sin(fabs(minPitch));
                float extra_effort = maxAngularAccel - exact_gravity_accel; 
                currentAppliedForce = (int8_t)constrain((int)extra_effort, -128, 127);
            }
            
            tmPitch[tmIdx] = calPitch; 
            tmQ0[tmIdx] = f_q0;
            tmQ1[tmIdx] = f_q1;
            tmQ2[tmIdx] = f_q2; 
            tmQ3[tmIdx] = f_q3;    
            tmVel[tmIdx] = currentSpeed; 
            tmAppForce[tmIdx] = currentAppliedForce; 
            tmPushForce[tmIdx] = peakPush;
            tmIdx = (tmIdx + 1) % 5;
        }

        if (pitchRads > maxPitch) maxPitch = pitchRads;
    
        if (isArmed) {
            if (pitchRads < 0.0 && pitchRads > -(PI/2.0) && omegaSigned > 0) { 
                if (currentSpeed > zVelocity) { 
                    zVelocity = currentSpeed;
                    appliedForceIndex = currentAppliedForce; 
                } 
            }
        
            bool validImpact = isArmed;

            if (!inImpactWindow && validImpact && deltaG >= impactThreshold && (currentMillis - lastImpactTime > 500)) {
                inImpactWindow = true;
                strikePacketSent = false;
                impactStartTime = currentMillis; 
                impactPeakG = accelMag; 
                impactPeakTwist = gz;
                impactDwellSamples = 1;

                impactPeakFaceG = max(fabs(ax), fabs(ay)); 
                impactPeakShaftG = fabs(az); 

                int oldIdx = (tmIdx + 1) % 5;
                pristinePitch = tmPitch[oldIdx]; 
                pristineQ0 = tmQ0[oldIdx]; 
                pristineQ1 = tmQ1[oldIdx]; 
                pristineQ2 = tmQ2[oldIdx];
                pristineQ3 = tmQ3[oldIdx];
                pristineVel = tmVel[oldIdx]; 
                pristineAppForce = tmAppForce[oldIdx]; 
                pristinePushForce = tmPushForce[oldIdx];
            }
        }

        if (inImpactWindow) {
            unsigned long elapsed = currentMillis - impactStartTime;
            if (elapsed <= 25) {
                if (accelMag > impactPeakG) {
                    impactPeakG = accelMag;
                    impactPeakFaceG = max(fabs(ax), fabs(ay)); 
                    impactPeakShaftG = fabs(az);
                }
                if (fabs(gz) > fabs(impactPeakTwist)) impactPeakTwist = gz;
                
                if (accelMag > 2.0) impactDwellSamples++;
            } else if (elapsed > 25 && !strikePacketSent) {
                
                if (isArmed) {
                
                    float backArc = fabs(minPitch) * radius_m * 100.0;
                    int dwellMs = impactDwellSamples * 2;
                    
                    if (isnan(pristineVel) || isinf(pristineVel)) pristineVel = 0.0;

                    uint16_t swingTime = 0;
                    if (impactStartTime > topOfBackswingTime && topOfBackswingTime > 0) {
                        swingTime = (uint16_t)(impactStartTime - topOfBackswingTime);
                    }
                    
                    int8_t computedDecel = 0;
                    if (zVelocity > 0.1) {
                        float ratio = ((pristineVel - zVelocity) / zVelocity) * 100.0f;
                        computedDecel = (int8_t)constrain(ratio, -128, 127);
                    }

                    Quat pristineRaw = {pristineQ2, -pristineQ3, -pristineQ1, pristineQ0};
                    Quat x180_q = {1.0f, 0.0f, 0.0f, 0.0f};
                    Quat pImpact = multQuat(pristineRaw, x180_q);

                    float p_len = sqrt(pImpact.x*pImpact.x + pImpact.y*pImpact.y + pImpact.z*pImpact.z + pImpact.w*pImpact.w);
                    if(p_len > 0.0f) { pImpact.x/=p_len; pImpact.y/=p_len; pImpact.z/=p_len; pImpact.w/=p_len; }

                    Quat pQuat = multQuat(baseQuatInverse, pImpact);

                    Vec3 pv = applyQuat({0.0f, 0.0f, 1.0f}, pQuat);
                    Vec3 pup = applyQuat({0.0f, 1.0f, 0.0f}, pQuat);
                    
                    float pdotZ = pup.z; 
                    Vec3 pprojZ = {0.0f - pdotZ * pup.x, 0.0f - pdotZ * pup.y, 1.0f - pdotZ * pup.z};
                    
                    float pristineTwist_deg = 0.0f;
                    float plenSq = pprojZ.x*pprojZ.x + pprojZ.y*pprojZ.y + pprojZ.z*pprojZ.z;
                    if (plenSq >= 0.0001f) {
                        normVec(pprojZ);
                        float pdot_vp = dotVec(pv, pprojZ);
                        if(pdot_vp > 1.0f) pdot_vp = 1.0f;
                        if(pdot_vp < -1.0f) pdot_vp = -1.0f;
                        float pangle = acos(pdot_vp);
                        
                        Vec3 pc = crossVec(pprojZ, pv);
                        if (dotVec(pc, pup) < 0.0f) pangle = -pangle;
                        
                        pristineTwist_deg = pangle * RAD_TO_DEG;
                        if (pristineTwist_deg > 90.0f) pristineTwist_deg -= 180.0f;
                        else if (pristineTwist_deg < -90.0f) pristineTwist_deg += 180.0f;
                    }
                    pristineTwist_deg -= twistOffset_deg;

                    StrikePacket sp; 
                    sp.header = 'S';
                    sp.peakG = (int16_t)(impactPeakG * 100.0);
                    sp.peakTwist = (int16_t)(impactPeakTwist * 10.0);
                    sp.dwell = (uint8_t)constrain(dwellMs, 0, 255); 
                    sp.backArc = (int16_t)(backArc * 10.0); 
                    sp.faceAngle = (int16_t)(pristineTwist_deg * 10.0);
                    sp.zVel = (int16_t)(pristineVel * 100.0); 
                    sp.appliedForce = pristineAppForce;
                    
                    uint16_t upTime = 0;
                    if (topOfBackswingTime > startOfBackswingTime && startOfBackswingTime > 0) {
                        upTime = (uint16_t)(topOfBackswingTime - startOfBackswingTime);
                    }
                    sp.backswingTime = upTime;

                    sp.q0 = (int16_t)(pristineQ0 * 10000.0f);
                    sp.q1 = (int16_t)(pristineQ1 * 10000.0f); 
                    sp.q2 = (int16_t)(pristineQ2 * 10000.0f); 
                    sp.q3 = (int16_t)(pristineQ3 * 10000.0f);
                    sp.matchTime = currentMatchTime;
                    sp.strikeTimeOffset = 0;
                    sp.downwardSwingTime = swingTime;
                    sp.decelFactor = computedDecel;
                
                    if (connected) strikeChar.writeValue((uint8_t*)&sp, sizeof(sp));
                
                    strikePacketSent = true;

                    // --- BURST THE TRACE BUFFER IN 14 CHUNKS ---
                    if (connected) {
                        TracePoint orderedBuffer[40];
                        for (int i = 0; i < 40; i++) {
                            orderedBuffer[i] = traceBuffer[(traceHead + i) % 40];
                        }

                        for (uint8_t chunk = 0; chunk < 14; chunk++) {
                            uint8_t pkt[32] = {0};
                            pkt[0] = 'T';
                            pkt[1] = chunk;
                            
                            int quatOffset = chunk * 3;
                            for (int q = 0; q < 3; q++) {
                                if (quatOffset + q < 40) {
                                    int byteOffset = 2 + (q * 8);
                                    TracePoint tp = orderedBuffer[quatOffset + q];
                                    memcpy(&pkt[byteOffset], &tp.q0, 2);
                                    memcpy(&pkt[byteOffset + 2], &tp.q1, 2);
                                    memcpy(&pkt[byteOffset + 4], &tp.q2, 2);
                                    memcpy(&pkt[byteOffset + 6], &tp.q3, 2);
                                }
                            }
                            traceChar.writeValue(pkt, 32);
                            BLE.poll();
                            delay(8); 
                        }
                    }
                    
                    if (fabs(pristineTwist_deg) > twistTolerance_deg) {
                        lastStrikeLedColor = 2;
                    } else {
                        lastStrikeLedColor = 1;
                    }
                    
                    strikeHoldEndTime = currentMillis + 3000; 
                    currentAppState = STATE_REVIEW;
                    
                } else {
                    inImpactWindow = false;
                    lastImpactTime = currentMillis; 
                    previousBleMillis = currentMillis; 
                    minPitch = 0.0; maxPitch = 0.0; peakPush = 0.0; zVelocity = 0.0;
                    appliedForceIndex = 0; topOfBackswingTime = 0;
                    
                    isArmed = false;
                    isSwinging = false;
                    currentAppState = STATE_IDLE; 
                }
            } else if (elapsed > 150) {
                inImpactWindow = false;
                lastImpactTime = currentMillis; 
                previousBleMillis = currentMillis; 
                minPitch = 0.0; maxPitch = 0.0; peakPush = 0.0; zVelocity = 0.0;
                appliedForceIndex = 0; topOfBackswingTime = 0;
                
                isArmed = false;
                isSwinging = false;
            }
        }
        prevAccelMag = accelMag;
        prevPitchRads = pitchRads; 
        prevOmegaSigned = omegaSigned;
    }
}

void setupBLEIdentity() {
    String mac = BLE.address(); 
    String shortMac = "0000";
    if (mac.length() >= 17) { 
        shortMac = mac.substring(12, 14) + mac.substring(15, 17);
        shortMac.toUpperCase();
    }
    
    snprintf(bleDeviceName, sizeof(bleDeviceName), "LVE Mallet %s", shortMac.c_str());
    
    BLE.setLocalName(bleDeviceName); 
    BLE.setDeviceName(bleDeviceName);
    
    if (currentAppState == STATE_DISCONNECTED) {
        identityChar.writeValue(mac);
    }
}

void setup() {
    // 0. Immediately pull P0.14 LOW and cut IMU power on every boot
    pinMode(PIN_VBAT_ENABLE, OUTPUT);
    digitalWrite(PIN_VBAT_ENABLE, LOW);

    pinMode(PIN_LSM6DS3TR_C_POWER, OUTPUT);
    digitalWrite(PIN_LSM6DS3TR_C_POWER, LOW);

    // 1. Ensure hardware QSPI is off so we can manually control the pins
    NRF_QSPI->ENABLE = 0;
    
    // 2. Take manual control of the CS, Clock, and MOSI (IO0) pins
    pinMode(PIN_QSPI_CS, OUTPUT);
    pinMode(PIN_QSPI_SCK, OUTPUT);
    pinMode(PIN_QSPI_IO0, OUTPUT);

    digitalWrite(PIN_QSPI_CS, HIGH);
    digitalWrite(PIN_QSPI_SCK, LOW);
    
    // 3. Select the flash chip by pulling CS LOW
    digitalWrite(PIN_QSPI_CS, LOW);
    delayMicroseconds(1);
    
    // 4. Bit-bang the 0xB9 (10111001) Deep Power Down command
    uint8_t cmd = 0xB9; 
    for (int i = 7; i >= 0; i--) {
        digitalWrite(PIN_QSPI_IO0, (cmd >> i) & 1);
        digitalWrite(PIN_QSPI_SCK, HIGH);
        delayMicroseconds(1);
        digitalWrite(PIN_QSPI_SCK, LOW);
        delayMicroseconds(1);
    }
    
    // 5. Deselect the flash chip to execute the command
    digitalWrite(PIN_QSPI_CS, HIGH);
    delayMicroseconds(1);

    // 6. Safely park all QSPI pins as pulldowns to prevent floating leaks
    pinMode(PIN_QSPI_SCK, INPUT_PULLDOWN);
    pinMode(PIN_QSPI_IO0, INPUT_PULLDOWN);
    pinMode(PIN_QSPI_IO1, INPUT_PULLDOWN);
    pinMode(PIN_QSPI_IO2, INPUT_PULLDOWN);
    pinMode(PIN_QSPI_IO3, INPUT_PULLDOWN);

    if (NRF_POWER->GPREGRET == 0x88) {
        NRF_POWER->GPREGRET = 0; 
        if (!(NRF_POWER->USBREGSTATUS & 1)) {
            powerDown();
        }
    }

    if (NRF_POWER->USBREGSTATUS & 1) {
        enterSafeChargingMode();
    }

    pinMode(LEDR, OUTPUT); pinMode(LEDG, OUTPUT); pinMode(LEDB, OUTPUT);
    setLEDColor(255, 0, 0);
    delay(250);
    NRF_POWER->RESETREAS = 0xFFFFFFFF; 

    setLEDColor(0, 255, 0);
    delay(250);

    pinMode(PIN_WIRE_SDA, INPUT);
    pinMode(PIN_WIRE_SCL, OUTPUT);
    for (int i = 0; i < 9; i++) {
        digitalWrite(PIN_WIRE_SCL, HIGH);
        delayMicroseconds(10);
        digitalWrite(PIN_WIRE_SCL, LOW);
        delayMicroseconds(10);
    }
    pinMode(PIN_WIRE_SCL, INPUT);
    
    setLEDColor(0, 0, 255);
    delay(250);
    
    if (ENABLE_WATCHDOG) {
        NRF_WDT->CONFIG = 0x01;       
        NRF_WDT->CRV = 32768 * 10;  
        NRF_WDT->RREN = 0x01;         
        NRF_WDT->TASKS_START = 1;     
    }  

    pinMode(PIN_WIRE_SDA, OUTPUT); digitalWrite(PIN_WIRE_SDA, LOW);
    pinMode(PIN_WIRE_SCL, OUTPUT); digitalWrite(PIN_WIRE_SCL, LOW);
    
    setLEDColor(255, 0, 0);
    delay(250);

    pinMode(IMU_INT_PIN, INPUT_PULLDOWN);
    pinMode(PIN_LSM6DS3TR_C_POWER, OUTPUT);
    digitalWrite(PIN_LSM6DS3TR_C_POWER, LOW);
    delay(100); 
    digitalWrite(PIN_LSM6DS3TR_C_POWER, HIGH);
    delay(250); 

    setLEDColor(0, 255, 0);
    delay(250);

    pinMode(PIN_WIRE_SDA, INPUT);
    pinMode(PIN_WIRE_SCL, INPUT);

    setLEDColor(0, 0, 255);
    delay(250);

    // Load saved calibration matrix & physical mallet profile from internal flash
    loadMalletProfileFromFlash();

    myIMU.settings.accelRange = 16;  
    myIMU.settings.gyroRange = 2000; 

    if (myIMU.begin() != 0) while (1);

    Wire.setClock(400000);

    setLEDColor(255, 0, 0);
    delay(250);

    setLEDColor(0, 255, 0); 
    delay(250);
    
    gyroBiasX = 0; gyroBiasY = 0; gyroBiasZ = 0;
    for(int i = 0; i < 200; i++) {
        gyroBiasX += myIMU.readFloatGyroY(); 
        gyroBiasY += myIMU.readFloatGyroX(); 
        gyroBiasZ += -myIMU.readFloatGyroZ();
        delay(5);
    }
    gyroBiasX /= 200.0; gyroBiasY /= 200.0; gyroBiasZ /= 200.0;
    
    filter.q0 = 1.0f; filter.q1 = 0.0f; filter.q2 = 0.0f; filter.q3 = 0.0f;
    filter.begin(500.0f); 
    injectGravitySnapshot();              

    if (!BLE.begin()) while (1);
    bleInitialized = true;
    
    setupBLEIdentity();
  
    telemetryService.addCharacteristic(telemetryChar);
    telemetryService.addCharacteristic(commandChar); 
    telemetryService.addCharacteristic(strikeChar);
    telemetryService.addCharacteristic(calibrationChar); 
    telemetryService.addCharacteristic(identityChar);
    telemetryService.addCharacteristic(traceChar);
    telemetryService.addCharacteristic(profileChar);
    BLE.addService(telemetryService);

    // Populate initial GATT read values so connecting apps can read them immediately
    syncProfileToBleCharacteristics();

    BLE.setAdvertisingInterval(160); 
    BLE.advertise();
    lastActivityTime = millis(); 
    previousImuMicros = micros();
} 

void flushPendingFlashSave(bool resumeAdvertising) {
    if (!pendingFlashSave) return;

    if (bleInitialized) {
        BLE.stopAdvertise();
        delay(20);
    }

    if (saveMalletProfileToFlash()) {
        pendingFlashSave = false;
        setLEDColor(0, 255, 0);
        delay(100);
        setLEDColor(0, 0, 0);
    } else {
        pendingFlashSave = false; // Prevent infinite retry loop if flash fails
        setLEDColor(255, 0, 0);
        delay(150);
        setLEDColor(0, 0, 0);
    }

    if (resumeAdvertising && bleInitialized && currentAppState == STATE_DISCONNECTED) {
        BLE.setAdvertisingInterval(160);
        BLE.advertise();
    }
}

void loop() {
    feedWatchdog();  

    if (pendingReboot && (millis() - rebootTriggerTime > 500)) {
        NVIC_SystemReset(); 
    }

    // Commit deferred internal flash writes only when disconnected (with advertising paused)
    if (pendingFlashSave && !inImpactWindow && currentAppState == STATE_DISCONNECTED) {
        flushPendingFlashSave(true);
    }

    BLEDevice central = BLE.central();
    unsigned long currentMillis = millis();
    unsigned long currentMicros = micros();
    bool connected = central && central.connected();

    if (currentAppState == STATE_ARMED && (currentMillis - armedStateStartTime > ARMED_TIMEOUT_MS)) {
        isArmed = false;
        isSwinging = false;
        currentAppState = STATE_IDLE;
        strikeHoldEndTime = 0;
    }

    if (!connected) {
        if (currentAppState != STATE_DISCONNECTED) { 
            currentAppState = STATE_DISCONNECTED;
            strikeHoldEndTime = 0; 
            lastActivityTime = currentMillis; 
            BLE.stopAdvertise();
            BLE.setAdvertisingInterval(160); 
            BLE.advertise();
        }
        
        if (currentMillis - lastActivityTime > BLE_DISCONNECT_TIMEOUT_MS) {
            if (NRF_POWER->USBREGSTATUS & 1) {
                enterSafeChargingMode();
            } else {
                NRF_POWER->GPREGRET = 0x88;
                NVIC_SystemReset(); 
            }
        }
    } else {
        if (currentAppState == STATE_DISCONNECTED) {
            currentAppState = STATE_IDLE;
            isArmed = false; isSwinging = false;
            previousBleMillis = currentMillis; 
            previousImuMicros = currentMicros;
            needsConnectionCalibration = true;

            lastActivityTime = currentMillis;
        }
      
        if (currentAppState == STATE_IDLE || currentAppState == STATE_REVIEW) {
            if (inactivityTimeout_ms > 0 && (currentMillis - lastActivityTime > inactivityTimeout_ms)) {
                if (bleInitialized) {
                    BLE.disconnect();
                    BLE.stopAdvertise();
                    delay(100);
                }
                flushPendingFlashSave(false);

                if (NRF_POWER->USBREGSTATUS & 1) {
                    enterSafeChargingMode();
                } else {
                    NRF_POWER->GPREGRET = 0x88;
                    NVIC_SystemReset();
                }
            }
        }
      
        if (calibrationChar.written()) {
            lastActivityTime = currentMillis;
            if (calibrationChar.valueLength() == 16) {
                CalibrationMatrix incomingMat;
                memcpy(&incomingMat, calibrationChar.value(), 16);
                float qNorm = sqrt(incomingMat.w * incomingMat.w + incomingMat.x * incomingMat.x +
                                   incomingMat.y * incomingMat.y + incomingMat.z * incomingMat.z);
                if (isfinite(qNorm) && fabs(qNorm - 1.0f) < 0.05f) {
                    hardwareMatrix = incomingMat;
                    malletProfile.w = hardwareMatrix.w;
                    malletProfile.x = hardwareMatrix.x;
                    malletProfile.y = hardwareMatrix.y;
                    malletProfile.z = hardwareMatrix.z;
                    malletProfile.isCalibrated = 1;
                    syncProfileToBleCharacteristics();
                    pendingFlashSave = true;
                } else {
                    syncProfileToBleCharacteristics();
                }
            }
        }

        if (profileChar.written()) {
            lastActivityTime = currentMillis;
            if (profileChar.valueLength() == sizeof(MalletBleProfile)) {
                MalletBleProfile incoming;
                memcpy(&incoming, profileChar.value(), sizeof(MalletBleProfile));
                float qNorm = sqrt(incoming.w * incoming.w + incoming.x * incoming.x +
                                   incoming.y * incoming.y + incoming.z * incoming.z);

                if (isfinite(qNorm) && fabs(qNorm - 1.0f) < 0.05f &&
                    isfinite(incoming.mass_g) && incoming.mass_g > 0.0f &&
                    isfinite(incoming.headLength_cm) && incoming.headLength_cm > 0.0f &&
                    isfinite(incoming.faceWidth_cm) && incoming.faceWidth_cm > 0.0f &&
                    isfinite(incoming.handleLength_cm) && incoming.handleLength_cm > 0.0f) {
                    memcpy(&malletProfile, &incoming, sizeof(MalletBleProfile));
                    malletProfile.version = PROFILE_SCHEMA_VER;
                    applyMalletProfileToRuntime();
                    syncProfileToBleCharacteristics();
                    pendingFlashSave = true;
                } else {
                    // Reject corrupt payload and restore valid GATT read values
                    syncProfileToBleCharacteristics();
                }
            }
        }

        if (commandChar.written()) {
            const uint8_t* data = commandChar.value(); 
            int len = commandChar.valueLength();
            
            if (len > 0 && data[0] != 'P') {
                lastActivityTime = currentMillis; 
            }
            
            handleBleCommand(data, len, currentMillis, currentMicros);
        }
    }

    updateLEDStateMachine();
    updateKinematics(currentMillis, currentMicros, connected);

    if (connected && !inImpactWindow) {

        long currentBleInterval = (currentAppState == STATE_IDLE) ? 1000 : 40;

       if (currentMillis - previousBleMillis >= currentBleInterval) {
            previousBleMillis = currentMillis;
            
            float dynR = radius_m;

            if (currentOmegaMag > 2.0) {
                float dynamic_ac = currentAccelMag - cos(filter.getPitch() * DEG_TO_RAD);
                if (dynamic_ac < 0) dynamic_ac = 0; 
                dynR = (dynamic_ac * 9.81) / (currentOmegaMag * currentOmegaMag);
            }
            
            TelemetryPacket pkt;
            pkt.timestamp = (uint16_t)(currentMillis & 0xFFFF);
            pkt.q0 = (int16_t)(tmQ0[(tmIdx+4)%5] * 10000.0f);
            pkt.q1 = (int16_t)(tmQ1[(tmIdx+4)%5] * 10000.0f); 
            pkt.q2 = (int16_t)(tmQ2[(tmIdx+4)%5] * 10000.0f);
            pkt.q3 = (int16_t)(tmQ3[(tmIdx+4)%5] * 10000.0f);
            pkt.ax = (int16_t)(ax * 100);
            pkt.ay = (int16_t)(ay * 100); 
            pkt.az = (int16_t)(az * 100);
            pkt.appliedForce = currentAppliedForce; 
            
            pkt.appState = (uint8_t)currentAppState;
            pkt.dynRadius = (uint16_t)(constrain(dynR * 1000.0f, 0, 65535)); 
            
            telemetryChar.writeValue((uint8_t*)&pkt, sizeof(pkt));
        }
    }

    __WFE();
}

void enterSafeChargingMode() {
    feedWatchdog();

    pinMode(PIN_VBAT_ENABLE, OUTPUT);
    digitalWrite(PIN_VBAT_ENABLE, LOW);

    pinMode(PIN_LSM6DS3TR_C_POWER, OUTPUT);
    digitalWrite(PIN_LSM6DS3TR_C_POWER, LOW);
    NRF_P0->PIN_CNF[PIN_WIRE_SDA] = 2; 
    NRF_P0->PIN_CNF[PIN_WIRE_SCL] = 2; 

    NRF_PWM0->ENABLE = 0;
    NRF_PWM1->ENABLE = 0;
    NRF_PWM2->ENABLE = 0;
    NRF_PWM3->ENABLE = 0;
    pinMode(LEDR, OUTPUT);
    pinMode(LEDG, OUTPUT);
    pinMode(LEDB, OUTPUT);
    digitalWrite(LEDR, HIGH);
    digitalWrite(LEDG, HIGH);
    digitalWrite(LEDB, HIGH);

    if (bleInitialized) {
        BLE.disconnect();
        BLE.stopAdvertise();
        delay(200);
        BLE.end();
        bleInitialized = false;
    }

    while (NRF_POWER->USBREGSTATUS & 1) {
        feedWatchdog();
        __WFE();
        delay(250); 
    }

    NRF_POWER->GPREGRET = 0x88;
    NVIC_SystemReset();
}

void powerDown() {
    pinMode(PIN_LSM6DS3TR_C_POWER, OUTPUT);
    digitalWrite(PIN_LSM6DS3TR_C_POWER, LOW);

    NRF_P0->PIN_CNF[PIN_WIRE_SDA] = 2; 
    NRF_P0->PIN_CNF[PIN_WIRE_SCL] = 2; 
    NRF_P0->PIN_CNF[PIN_PDM_CLK] = 2;
    NRF_P0->PIN_CNF[PIN_PDM_DIN] = 2;

    NRF_QSPI->TASKS_DEACTIVATE = 1;
    NRF_QSPI->ENABLE = 0;
    pinMode(PIN_QSPI_CS, OUTPUT);
    digitalWrite(PIN_QSPI_CS, HIGH);
    pinMode(PIN_QSPI_SCK, INPUT_PULLDOWN);
    pinMode(PIN_QSPI_IO0, INPUT_PULLDOWN);
    pinMode(PIN_QSPI_IO1, INPUT_PULLDOWN);
    pinMode(PIN_QSPI_IO2, INPUT_PULLDOWN);
    pinMode(PIN_QSPI_IO3, INPUT_PULLDOWN);

    pinMode(PIN_VBAT_ENABLE, OUTPUT);
    digitalWrite(PIN_VBAT_ENABLE, LOW);

    for (int i = 0; i < 32; i++) { 
        if (i == 18) continue;
        NRF_P0->PIN_CNF[i] &= ~(GPIO_PIN_CNF_SENSE_Msk); 
    }
    for (int i = 0; i < 16; i++) { 
        NRF_P1->PIN_CNF[i] &= ~(GPIO_PIN_CNF_SENSE_Msk); 
    }
    NRF_P0->LATCH = 0xFFFFFFFF;
    NRF_P1->LATCH = 0xFFFFFFFF;
    
    __set_FPSCR(__get_FPSCR() & ~(0x0000009F));
    (void) __get_FPSCR();
    NVIC_ClearPendingIRQ(FPU_IRQn);

    NRF_PWM0->ENABLE = 0; NRF_PWM1->ENABLE = 0; 
    NRF_PWM2->ENABLE = 0; NRF_PWM3->ENABLE = 0;
    pinMode(LEDR, OUTPUT); pinMode(LEDG, OUTPUT); pinMode(LEDB, OUTPUT);

    digitalWrite(LEDR, LOW);
    digitalWrite(LEDG, LOW);
    digitalWrite(LEDB, LOW);
    
    for(volatile long i = 0; i < 15000000; i++);
    
    digitalWrite(LEDR, HIGH);
    digitalWrite(LEDG, HIGH);
    digitalWrite(LEDB, HIGH);
    
    for(volatile long i = 0; i < 100000; i++);
    __DSB();

    for (int i = 0; i < 48; i++) {
        NVIC_DisableIRQ((IRQn_Type)i);
        NVIC_ClearPendingIRQ((IRQn_Type)i);
    }
    SysTick->CTRL = 0;
    NRF_RTC0->TASKS_STOP = 1;
    NRF_RTC1->TASKS_STOP = 1;
    NRF_RTC2->TASKS_STOP = 1;

    /* for (int i = 0; i < 8; i++) {
        NRF_POWER->RAM[i].POWER = 0;
        // Apparently it is better not to do this as the shutdown will handle it itself.
    } */

    __DSB();     
    NRF_POWER->SYSTEMOFF = 1;  
    __DSB();     
    __ISB();

    while(1) {
        __WFE(); 
    }
}