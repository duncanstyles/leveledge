/* =====================================================================================
 * PROJECT: LevelEdge Croquet
 * FILE: LevelEdge_9001.ino
 * VERSION: 9.0.01 (Face-to-Path Physics Engine - Axis Corrected & Hardware Safe)
 * ===================================================================================== */

#include <ArduinoBLE.h>
#include <LSM6DS3.h>
#include <Wire.h>
#include "FastMadgwick.h" 

// --- MBED FLASH STORAGE ---
#include <mbed.h>
#include <kvstore_global_api.h>

struct CalibrationMatrix {
    float w;
    float x;
    float y;
    float z;
};
CalibrationMatrix hardwareMatrix = {1.0f, 0.0f, 0.0f, 0.0f};

// --- Restored True 32-Byte Payload ---
struct __attribute__((packed)) StrikePacket {
    uint8_t header;     
    int16_t peakG;
    int16_t peakTwist;
    uint8_t dwell;
    int16_t backArc;    
    int16_t fwdArc;
    int16_t zVel;       
    int8_t appliedForce; 
    int16_t pushForce;  
    int16_t q0; 
    int16_t q1;
    int16_t q2;
    int16_t q3;  
    uint32_t matchTime;
    uint16_t strikeTimeOffset; 
    uint16_t downwardSwingTime;
    int8_t decelFactor;         
};

const uint16_t MAX_STRIKES = 5000;
const uint8_t STRIKES_PER_CHUNK = 16;

uint16_t storedStrikeCount = 0; 
uint32_t currentMatchTime = 0; 
unsigned long matchStartMillis = 0;
unsigned long lastGameActivityTime = 0;
unsigned long armedStateStartTime = 0;
const uint16_t MAX_PENDING_STRIKES = 250;
StrikePacket pendingStrikesBuffer[MAX_PENDING_STRIKES];
uint16_t pendingStrikeCount = 0; 
bool chunkDirty = false;
unsigned long lastStrikeTime = 0;
const unsigned long IDLE_SAVE_DELAY_MS = 30000; 

const char* FW_VERSION = "9.0.01";
int currentBatteryPct = 100; 
// FIX: Removed dangerous Pin 5 charging pin declaration

unsigned long inactivityTimeout_ms = 300000;
unsigned long lastActivityTime = 0;
// FIX: Use the actual internal IMU interrupt pin to avoid hardware clashes
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

const float GAME_MODE_AUTO_STOP_MS = 300000; 
const unsigned long ABANDONED_MATCH_TIMEOUT_MS = 3600000; 

BLEService telemetryService("19B30000-E8F2-537E-4F6C-D104768A1214");
BLECharacteristic telemetryChar("19B30001-E8F2-537E-4F6C-D104768A1214", BLERead | BLENotify, 20); 
BLECharacteristic commandChar("19B30002-E8F2-537E-4F6C-D104768A1214", BLEWrite | BLEWriteWithoutResponse, 32);
BLECharacteristic strikeChar("19B30003-E8F2-537E-4F6C-D104768A1214", BLERead | BLENotify, 32);
BLECharacteristic calibrationChar("19B30004-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite, 16); 
BLEStringCharacteristic identityChar("19B30005-E8F2-537E-4F6C-D104768A1214", BLERead, 20);

unsigned long previousBleMillis = 0;
unsigned long previousImuMicros = 0;
const long BLE_INTERVAL = 40; 
const long IMU_INTERVAL_MICROS = 2000;

float radius_m = 1.27;
float mass_kg = 1.0;
float impactThreshold = 4.0;
float offset_m = 0.055;  
float sweetSpot_cm = 1.5; 
float twistTolerance_deg = 1.0;
float pitchOffset = 0.0;
float yawOffset = 0.0;
bool led_guidance_enabled = true; 

float prevAccelMag = 1.0;
float prevPitchRads = 0.0;
float prevOmegaSigned = 0.0;
float filtAlphaPush = 0.0;
float minPitch = 0.0; 
float maxPitch = 0.0;
float currentTwist_deg = 0.0;
bool tareTwistNextFrame = false;

// --- MATCH MODE FACE-TO-PATH VARIABLES ---
bool gameModeInSweep = false;
bool gameModeFaultTripped = false;
unsigned long gameModeLedEndTime = 0;
uint8_t gameModeLedState = 0; // 0=Off, 1=Green, 2=Red

// --- NEW: C++ PORT OF THREE.JS MATH ENGINE ---
struct Quat { float x, y, z, w; };
struct Vec3 { float x, y, z; };

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
// ---------------------------------------------

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
    STATE_STEADYING    = 6,
    STATE_GAME_MODE    = 7
};

AppState currentAppState = STATE_DISCONNECTED;
uint8_t liveFeedbackState = 1; 
bool isArmed = false;
bool isSwinging = false;
bool isGameMode = false;
unsigned long strikeHoldEndTime = 0;
bool inImpactWindow = false;
unsigned long topOfBackswingTime = 0;
bool strikePacketSent = false;
unsigned long impactStartTime = 0;
unsigned long lastImpactTime = 0;
float impactPeakG = 0;
float impactPeakTwist = 0;
int impactDwellSamples = 0;

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
// ---------------------------------

void enterGameModeSleep();
void injectGravitySnapshot();
void goToDeepSleep();

void setLEDColor(uint8_t r, uint8_t g, uint8_t b) {
    analogWrite(LEDR, 255 - r);
    analogWrite(LEDG, 255 - g);
    analogWrite(LEDB, 255 - b);
}

void sendBatteryUpdate() {
    analogReadResolution(12);
    pinMode(PIN_VBAT_ENABLE, OUTPUT); 
    digitalWrite(PIN_VBAT_ENABLE, LOW); 
    
    // Increased settling time for a stable reading
    delay(20); 
    
    // Multi-sampling loop to smooth out voltage sags from BLE bursts
    long adcSum = 0;
    const int sampleCount = 20;
    for (int i = 0; i < sampleCount; i++) {
        adcSum += analogRead(PIN_VBAT);
        delay(1); 
    }
    
    int rawADC = adcSum / sampleCount;
    
    digitalWrite(PIN_VBAT_ENABLE, HIGH); 
    pinMode(PIN_VBAT_ENABLE, INPUT);
    
    float batteryVolts = (rawADC / 4095.0) * 3.3 * 2.96078;
    uint16_t voltage_mV = (uint16_t)(batteryVolts * 1000);

    uint8_t compressed_V = 0;
    if (voltage_mV > 3000) {
        compressed_V = (voltage_mV - 3000) / 5;
    }

    uint16_t availableStrikes = MAX_STRIKES - (storedStrikeCount + pendingStrikeCount);

    uint8_t battPacket[5];
    battPacket[0] = 'B'; 
    battPacket[1] = compressed_V;                   
    
    // Check the nRF52840's internal USB voltage register.
    bool usbPluggedIn = (NRF_POWER->USBREGSTATUS & 1) ? true : false;
    battPacket[2] = usbPluggedIn ? 1 : 0; 
    
    battPacket[3] = availableStrikes & 0xFF;        
    battPacket[4] = (availableStrikes >> 8) & 0xFF; 
    
    strikeChar.writeValue(battPacket, 5);
}

void savePendingToFlash() {
    if (pendingStrikeCount == 0 || !chunkDirty) return;
    setLEDColor(255, 0, 0);

    StrikePacket tempChunk[STRIKES_PER_CHUNK];
    size_t actual_size = 0;
    uint16_t activeChunkIdx = 0xFFFF;

    for (uint16_t i = 0; i < pendingStrikeCount; i++) {
        uint16_t targetChunkIdx = storedStrikeCount / STRIKES_PER_CHUNK;
        uint16_t targetOffset = storedStrikeCount % STRIKES_PER_CHUNK;

        if (targetChunkIdx != activeChunkIdx) {
            activeChunkIdx = targetChunkIdx;
            if (targetOffset > 0) {
                char key[16];
                sprintf(key, "chk_%d", activeChunkIdx);
                kv_get(key, tempChunk, sizeof(tempChunk), &actual_size);
            } else {
                memset(tempChunk, 0, sizeof(tempChunk));
            }
        }

        tempChunk[targetOffset] = pendingStrikesBuffer[i];
        storedStrikeCount++;

        if ((storedStrikeCount % STRIKES_PER_CHUNK == 0) || (i == pendingStrikeCount - 1)) {
            char key[16];
            sprintf(key, "chk_%d", activeChunkIdx);
            uint16_t countInChunk = ((storedStrikeCount - 1) % STRIKES_PER_CHUNK) + 1;
            kv_set(key, tempChunk, sizeof(StrikePacket) * countInChunk, 0);
            kv_set("str_cnt", &storedStrikeCount, sizeof(storedStrikeCount), 0);
        }
    }
    pendingStrikeCount = 0;
    chunkDirty = false;
    setLEDColor(0, 0, 0);
}

void updateLEDStateMachine() {
    if (chunkDirty && pendingStrikeCount > 0 && (millis() - lastStrikeTime >= IDLE_SAVE_DELAY_MS)) return;
    unsigned long currentMillis = millis();
    if (strikeHoldEndTime > 0 && currentMillis < strikeHoldEndTime) { 
        setLEDColor(0, 0, 255);
        return;
    }

    switch(currentAppState) {
        case STATE_DISCONNECTED:
            if ((NRF_POWER->USBREGSTATUS & 1) && inactivityTimeout_ms > 0 && (currentMillis - lastActivityTime > inactivityTimeout_ms)) {
                setLEDColor(0, 0, 0);
            } else {
                if (currentMillis - lastLedBlinkTime >= 500) {
                    lastLedBlinkTime = currentMillis;
                    ledBlinkState = !ledBlinkState;
                    if (ledBlinkState) setLEDColor(0, 0, 255); 
                    else setLEDColor(0, 0, 0);
                } 
            }
            break;
        case STATE_IDLE: setLEDColor(0, 0, 255); break;
        case STATE_CALIBRATING: setLEDColor(255, 0, 0); break;
        case STATE_STEADYING: setLEDColor(255, 0, 0); break;
        case STATE_ARMED:
        case STATE_SWINGING:
        case STATE_GAME_MODE: // <-- NEW: Allow Game Mode to use the live guidance block!
            if (!led_guidance_enabled) {
                setLEDColor(0, 0, 0);
            } else {
                // NEW: Priority check for Game Mode's 1.5-second post-swing result flash
                if (currentAppState == STATE_GAME_MODE && (currentMillis < gameModeLedEndTime)) {
                    if (gameModeLedState == 1) setLEDColor(0, 255, 0);      // Clean shot
                    else if (gameModeLedState == 2) setLEDColor(255, 0, 0); // Fault detected
                    break; // Skip the live tracking while showing the final grade
                }

                // ... Keep your existing live guidance code exactly as is ...
                if (liveFeedbackState == 3) { 
                    if (currentMillis % 150 < 75) setLEDColor(255, 0, 0);
                    else setLEDColor(0, 0, 0); 
                } else {
                    // Memory Latch
                    static int swingGrade = 1; // 1 = Green, 2 = Red
                    static bool wasOutsideZone = true;
                    
                    float currentPitchDeg = prevPitchRads * (180.0f / PI);
                    
                    if (fabs(currentPitchDeg) > 25.0f) {
                        // Freeze color outside impact zone
                        wasOutsideZone = true;
                    } else {
                        // In impact zone
                        if (wasOutsideZone) {
                            swingGrade = 1; 
                            wasOutsideZone = false;
                        }
                        
                        // Strict Grading
                        if (fabs(currentTwist_deg) > twistTolerance_deg) {
                            swingGrade = 2; // Downgrade to Red
                        }
                    }
                    
                    // Display latched grade
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

volatile bool imuAwakeFlag = false;
void imuWakeISR() {
    imuAwakeFlag = true;
}

void enterGameModeSleep() {
    setLEDColor(0, 0, 0);
    if (pendingStrikeCount > 0) savePendingToFlash();

    BLE.disconnect();
    BLE.stopAdvertise();
    delay(200);
    BLE.end();

    myIMU.writeRegister(0x58, 0x80); 
    myIMU.writeRegister(0x5B, 0x02); 
    myIMU.writeRegister(0x5E, 0x20); 

    imuAwakeFlag = false;
    attachInterrupt(digitalPinToInterrupt(IMU_INT_PIN), imuWakeISR, RISING);

    while (!imuAwakeFlag) {
        __WFI(); 
    }

    detachInterrupt(digitalPinToInterrupt(IMU_INT_PIN));
    myIMU.writeRegister(0x5E, 0x00); 

    BLE.begin();
    String mac = BLE.address(); 
    String shortMac = "0000";
    if (mac.length() >= 17) { 
        shortMac = mac.substring(12, 14) + mac.substring(15, 17);
        shortMac.toUpperCase();
    }
    String bleDeviceName = "LVE Mallet " + shortMac;
    BLE.setLocalName(bleDeviceName.c_str()); 
    BLE.setDeviceName(bleDeviceName.c_str());
    BLE.setAdvertisedService(telemetryService);
    BLE.setAdvertisingInterval(160); 
    BLE.advertise();

    injectGravitySnapshot(); 

    unsigned long nowMs = millis();
    lastGameActivityTime = nowMs;
    lastActivityTime = nowMs;
    previousBleMillis = nowMs;
    previousImuMicros = micros();
}

void handleBleCommand(const uint8_t* data, int len, unsigned long currentMillis, unsigned long currentMicros) {
    if (len <= 0) return;

    if (data[0] == 'R') { 
        if (pendingStrikeCount > 0) savePendingToFlash();
        setLEDColor(255, 0, 0);
        delay(200); 
        NVIC_SystemReset();
    } 
    
else if (data[0] == 'K') { 
    if (len >= 5) {
        currentMatchTime = (uint32_t)data[1] |
                           ((uint32_t)data[2] << 8) | ((uint32_t)data[3] << 16) | ((uint32_t)data[4] << 24);
        kv_set("match_time", &currentMatchTime, sizeof(currentMatchTime), 0);
    }
    matchStartMillis = currentMillis;
    isGameMode = true; 
    isArmed = false; 
    inImpactWindow = false;

    // --- FIX: Calibrate Pitch & Yaw Offsets for Match Mode ---
    pitchOffset = filter.getPitch();
    yawOffset = filter.getYaw();
    tareTwistNextFrame = true;

    minPitch = 0.0; 
    maxPitch = 0.0; 
    zVelocity = 0.0;
    peakPush = 0.0; 
    appliedForceIndex = 0; 
    currentAppliedForce = 0;
    topOfBackswingTime = 0;

    gameModeInSweep = false;
    gameModeFaultTripped = false;
    gameModeLedEndTime = 0;
    gameModeLedState = 0;

    lastGameActivityTime = currentMillis; 
    lastStrikeTime = currentMillis; 
    currentAppState = STATE_GAME_MODE;
}

    else if (data[0] == 'L') { 
        isGameMode = false;
        currentAppState = STATE_IDLE;
        if (pendingStrikeCount > 0) savePendingToFlash();
    }
    else if (data[0] == 'W') { 
        hardwareMatrix = {1.0f, 0.0f, 0.0f, 0.0f};
        kv_set("cal_matrix", &hardwareMatrix, sizeof(hardwareMatrix), 0);
        storedStrikeCount = 0; 
        pendingStrikeCount = 0;
        kv_set("str_cnt", &storedStrikeCount, sizeof(storedStrikeCount), 0);
        currentMatchTime = 0;
        kv_set("match_time", &currentMatchTime, sizeof(currentMatchTime), 0);
        chunkDirty = false; 
        
        setLEDColor(255, 0, 0); 
        delay(500); 
        setLEDColor(0, 0, 0);
        sendBatteryUpdate();
    }
    else if (data[0] == 'D') { 
        if (currentAppState == STATE_IDLE || currentAppState == STATE_REVIEW) {
            if (pendingStrikeCount > 0) savePendingToFlash();

            StrikePacket readBuffer[STRIKES_PER_CHUNK];
            uint16_t lastLoadedChunkIdx = 0xFFFF;
        
            for (uint16_t i=0; i<storedStrikeCount; i++) {
                if ((i / 8) % 2 == 0) setLEDColor(128, 0, 128); 
                else setLEDColor(0, 0, 255);                    

                uint16_t chunkIdx = i / STRIKES_PER_CHUNK;
                uint16_t offset = i % STRIKES_PER_CHUNK;
            
                if (chunkIdx != lastLoadedChunkIdx) {
                    char key[16];
                    sprintf(key, "chk_%d", chunkIdx); 
                    size_t actual = 0;
                    kv_get(key, readBuffer, sizeof(readBuffer), &actual);
                    lastLoadedChunkIdx = chunkIdx;
                }
            
                StrikePacket hsp = readBuffer[offset];
                hsp.header = 'H'; 
                strikeChar.writeValue((uint8_t*)&hsp, sizeof(hsp));
                delay(35);
            }
            setLEDColor(0, 0, 255);
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
        previousImuMicros = currentMicros; 
        pitchOffset = filter.getPitch();
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
        armedStateStartTime = currentMillis; // Track when it was armed
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
        
        strikeChar.writeValue((const uint8_t*)" ", 1); 
        delay(5); 
        
        String verStr = String("V") + FW_VERSION;
        strikeChar.writeValue((const uint8_t*)verStr.c_str(), verStr.length()); 
        delay(10); 
        sendBatteryUpdate(); 
    }
    else if (data[0] == 'U') { 
        if (pendingStrikeCount > 0) savePendingToFlash();
        setLEDColor(255, 0, 255); 
        delay(200);
        NRF_POWER->GPREGRET = 0x57; 
        NVIC_SystemReset();
    }
    else if (data[0] == 'P') { 
        sendBatteryUpdate(); 
    }
}

// --- ON-DEVICE QUATERNION MATH SYSTEM ---
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

        if (gyroMag > 30.0 || deltaG > 0.2) { 
            lastActivityTime = currentMillis;
            if (isGameMode) lastGameActivityTime = currentMillis; 
        }

        if (isArmed && gyroMag > WAKE_GYRO_THRESHOLD && currentAppState != STATE_SWINGING) { 
            isSwinging = true;
            currentAppState = STATE_SWINGING; 
        } 

        if (isGameMode) {
            if (currentMillis - lastStrikeTime > ABANDONED_MATCH_TIMEOUT_MS) {
                isGameMode = false;
                currentAppState = STATE_IDLE;
                goToDeepSleep(); 
            } else if (currentMillis - lastGameActivityTime > GAME_MODE_AUTO_STOP_MS) {
                enterGameModeSleep();
            }
        }

        if (accelMag > HIGH_MOTION_ACCEL_THRESHOLD || gyroMag > HIGH_MOTION_GYRO_THRESHOLD) { 
            filter.setBeta(0.0f);
        } 
        else if (fabs(accelMag - 1.0) < IDLE_ACCEL_TOLERANCE && gyroMag < IDLE_GYRO_THRESHOLD) { 
            filter.setBeta(0.1f);
        } 
        else { 
            filter.setBeta(0.01f);
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

        float calPitch = atan2(2.0f * (f_q0*f_q1 + f_q2*f_q3), 1.0f - 2.0f * (f_q1*f_q1 + f_q2*f_q2)) * (180.0f / PI) - pitchOffset;
        
        float pitchRads = calPitch * (PI / 180.0);
        float omegaMag = gyroMag * (PI / 180.0);
        float currentSpeed = omegaMag * radius_m;
        float omegaSigned = (pitchRads > prevPitchRads) ? omegaMag : -omegaMag;

        // =========================================================================
        // MATCH MODE FACE-TO-PATH EVALUATION ENGINE (PURE PHYSICS)
        // =========================================================================
        if (isGameMode) {
            if (calPitch > -20.0f && calPitch < 20.0f) {
                if (omegaSigned > 0.5f) { 
                    if (!gameModeInSweep) {
                        gameModeInSweep = true;
                        gameModeFaultTripped = false;
                    }
                    
                    Quat hwQ = {hardwareMatrix.x, hardwareMatrix.y, hardwareMatrix.z, hardwareMatrix.w};
                    Vec3 rawGyroVec = {gx, gy, gz};
                    Vec3 calGyro = applyQuat(rawGyroVec, hwQ);
                    
                    float swingSpeed = fabs(calGyro.x);
                    
                    if (swingSpeed > 20.0f) { 
                        float faceToPathDeg = atan2(fabs(calGyro.z), swingSpeed) * (180.0f / PI);
                        if (faceToPathDeg > twistTolerance_deg) {
                            gameModeFaultTripped = true;
                        }
                    }
                }
            } 
            else {
                if (gameModeInSweep) {
                    // FIX: Exit gate lowered to 10.0f
                    if (calPitch >= 10.0f) {
                        gameModeLedState = gameModeFaultTripped ? 2 : 1; 
                        gameModeLedEndTime = currentMillis + 1500;
                    }
                    gameModeInSweep = false;
                }
            }
        }
        // =========================================================================

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
            
            deg = angle * (180.0f / PI);
            if (deg > 90.0f) deg -= 180.0f;
            else if (deg < -90.0f) deg += 180.0f;
        }

        if (doTare) twistOffset_deg = deg;
        currentTwist_deg = deg - twistOffset_deg;

        float alphaRads = (omegaSigned - prevOmegaSigned) / actualDt;
        float alphaGrav = -(9.81 / radius_m) * sin(pitchRads);
        float alphaPush = alphaRads - alphaGrav;
        
        filtAlphaPush = (filtAlphaPush * 0.95) + (alphaPush * 0.05);
        float currentPush = mass_kg * radius_m * filtAlphaPush;
    
        if (fabs(currentPush) > fabs(peakPush)) peakPush = currentPush;
        
        float r_sensor = radius_m - offset_m;
        float expected_G = cos(pitchRads) + ((omegaMag * omegaMag * r_sensor) / 9.81);
        float force_N = 0.0;
        
        if (omegaMag > 2.0 && currentSpeed > 0.5) { 
            float g_diff = expected_G - accelMag;
            force_N = g_diff * 9.81 * mass_kg; 
        }
        currentAppliedForce = (int8_t)constrain(force_N, -128, 127);
        
        if (!inImpactWindow) {
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
        
        if (pitchRads < minPitch) {
            minPitch = pitchRads;
            topOfBackswingTime = currentMillis; 
        }
        if (pitchRads > maxPitch) maxPitch = pitchRads;
    
        if (isArmed || isGameMode) {
            if (pitchRads < 0.0 && pitchRads > -(PI/2.0) && omegaSigned > 0) { 
                if (currentSpeed > zVelocity) { 
                    zVelocity = currentSpeed;
                    appliedForceIndex = currentAppliedForce; 
                } 
            }
        
            // --- FIX: Ensure validImpact triggers reliably in Match Mode ---
            bool validImpact = isArmed || (isGameMode && (zVelocity > 0.5 || deltaG >= impactThreshold));

            if (!inImpactWindow && validImpact && deltaG >= impactThreshold && (currentMillis - lastImpactTime > 500)) {
                inImpactWindow = true;
                strikePacketSent = false;
                impactStartTime = currentMillis; 
                impactPeakG = accelMag; 
                impactPeakTwist = gyroMag; 
                impactDwellSamples = 1;

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
                if (accelMag > impactPeakG) impactPeakG = accelMag;
                if (gyroMag > impactPeakTwist) impactPeakTwist = gyroMag;
                if (accelMag > 2.0) impactDwellSamples++;
            } else if (elapsed > 25 && !strikePacketSent) {
                float backArc = fabs(minPitch) * radius_m * 100.0;
                float fwdArc = fabs(maxPitch) * radius_m * 100.0; 
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

                StrikePacket sp; 
                sp.header = 'S';
                sp.peakG = (int16_t)(impactPeakG * 100.0);
                sp.peakTwist = (int16_t)(impactPeakTwist * 10.0);
                sp.dwell = (uint8_t)constrain(dwellMs, 0, 255); 
                sp.backArc = (int16_t)(backArc * 10.0); 
                sp.fwdArc = (int16_t)(fwdArc * 10.0);
                sp.zVel = (int16_t)(pristineVel * 100.0); 
                sp.appliedForce = pristineAppForce; 
                sp.pushForce = (int16_t)(pristinePushForce * 10.0);
                sp.q0 = (int16_t)(pristineQ0 * 10000.0f);
                sp.q1 = (int16_t)(pristineQ1 * 10000.0f); 
                sp.q2 = (int16_t)(pristineQ2 * 10000.0f); 
                sp.q3 = (int16_t)(pristineQ3 * 10000.0f);
                sp.matchTime = currentMatchTime;
                
                if (isGameMode) {
                    sp.strikeTimeOffset = (uint16_t)((currentMillis - matchStartMillis) / 1000);
                } else {
                    sp.strikeTimeOffset = 0;
                }
            
                sp.downwardSwingTime = swingTime;
                sp.decelFactor = computedDecel;
            
                if (connected) strikeChar.writeValue((uint8_t*)&sp, sizeof(sp));

                if ((storedStrikeCount + pendingStrikeCount) < MAX_STRIKES) {
                    if (pendingStrikeCount < MAX_PENDING_STRIKES) {
                        pendingStrikesBuffer[pendingStrikeCount] = sp;
                        pendingStrikeCount++;
                        chunkDirty = true;
                        lastStrikeTime = currentMillis; 
                    } else {
                        savePendingToFlash();
                        pendingStrikesBuffer[pendingStrikeCount] = sp;
                        pendingStrikeCount++;
                        chunkDirty = true;
                        lastStrikeTime = currentMillis; 
                    }
                }
            
                strikePacketSent = true;
                if (!isGameMode) { 
                    strikeHoldEndTime = currentMillis + 10000;
                    currentAppState = STATE_REVIEW;
                }
            } else if (elapsed > 150) {
                inImpactWindow = false;
                lastImpactTime = currentMillis; 
                previousBleMillis = currentMillis; 
                minPitch = 0.0; maxPitch = 0.0; peakPush = 0.0; zVelocity = 0.0;
                appliedForceIndex = 0; topOfBackswingTime = 0;
                
                if (!isGameMode) { 
                    isArmed = false;
                    isSwinging = false;
                }
            }
        }
        prevAccelMag = accelMag;
        prevPitchRads = pitchRads; 
        prevOmegaSigned = omegaSigned;
    }
}

void setup() {
    Serial.begin(115200);
    setLEDColor(0, 0, 0); 
    
    // FIX: Safely power the internal Sense IMU to prevent latch-up short
    pinMode(IMU_INT_PIN, INPUT);
    pinMode(PIN_LSM6DS3TR_C_POWER, OUTPUT);
    digitalWrite(PIN_LSM6DS3TR_C_POWER, HIGH);
    delay(50); // Give power time to stabilize before IMU begin

    if (myIMU.begin() != 0) while (1);

    size_t actual_size = 0;
    int kvStatus = kv_get("str_cnt", &storedStrikeCount, sizeof(storedStrikeCount), &actual_size);
    
    if (kvStatus != 0 && kvStatus != MBED_ERROR_ITEM_NOT_FOUND) {
        kv_reset("/kv/"); 
        hardwareMatrix = {1.0f, 0.0f, 0.0f, 0.0f};
        storedStrikeCount = 0;
        currentMatchTime = 0;
        kv_set("cal_matrix", &hardwareMatrix, sizeof(hardwareMatrix), 0);
        kv_set("str_cnt", &storedStrikeCount, sizeof(storedStrikeCount), 0);
        kv_set("match_time", &currentMatchTime, sizeof(currentMatchTime), 0);
    } else {
        if (kvStatus == MBED_ERROR_ITEM_NOT_FOUND) { storedStrikeCount = 0; }
        if (kv_get("cal_matrix", &hardwareMatrix, sizeof(hardwareMatrix), &actual_size) != 0) { 
            hardwareMatrix = {1.0f, 0.0f, 0.0f, 0.0f};
        }
        if (kv_get("match_time", &currentMatchTime, sizeof(currentMatchTime), &actual_size) != 0) { 
            currentMatchTime = 0;
        }
    }

    pendingStrikeCount = 0; 
    setLEDColor(0, 255, 0); 
    delay(1000);
    
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

    delay(500);

    if (!BLE.begin()) while (1);
    
    String mac = BLE.address(); 
    String shortMac = "0000";
    if (mac.length() >= 17) { 
        shortMac = mac.substring(12, 14) + mac.substring(15, 17);
        shortMac.toUpperCase();
    }

    calibrationChar.writeValue((uint8_t*)&hardwareMatrix, sizeof(hardwareMatrix));
    identityChar.writeValue(mac);
    String bleDeviceName = "LVE Mallet " + shortMac;
    BLE.setLocalName(bleDeviceName.c_str()); 
    BLE.setDeviceName(bleDeviceName.c_str());
  
    BLE.setAdvertisedService(telemetryService);
    telemetryService.addCharacteristic(telemetryChar);
    telemetryService.addCharacteristic(commandChar); 
    telemetryService.addCharacteristic(strikeChar);
    telemetryService.addCharacteristic(calibrationChar); 
    telemetryService.addCharacteristic(identityChar);
    BLE.addService(telemetryService);

    BLE.setAdvertisingInterval(160); 
    BLE.advertise();
    lastActivityTime = millis(); 
    previousImuMicros = micros();
}

void loop() {
    BLEDevice central = BLE.central();
    unsigned long currentMillis = millis();
    unsigned long currentMicros = micros();
    bool connected = central && central.connected();

    // Hardware-level failsafe: Force disarm if stuck in ARMED for over 30 seconds
    if (currentAppState == STATE_ARMED && (currentMillis - armedStateStartTime > 30000)) {
        isArmed = false;
        isSwinging = false;
        currentAppState = STATE_IDLE;
        strikeHoldEndTime = 0;
    }
    
    if (!connected) {
        if (!isGameMode) {
            if (currentAppState != STATE_DISCONNECTED) { 
                currentAppState = STATE_DISCONNECTED;
                strikeHoldEndTime = 0; 
            }
            
            // NEW: Force deep sleep if USB is plugged in to charge the battery.
            // BUT wait 15 seconds first to allow for Arduino IDE firmware updates!
            if (NRF_POWER->USBREGSTATUS & 1) {
                if (currentMillis - lastActivityTime > 15000) {
                    goToDeepSleep();
                }
            }
            
            // Standard inactivity timeout if running on battery
            if (inactivityTimeout_ms > 0 && (currentMillis - lastActivityTime > inactivityTimeout_ms)) {
                if (!(NRF_POWER->USBREGSTATUS & 1)) {
                    goToDeepSleep(); 
                }
            }
        }
    } else {
        if (currentAppState == STATE_DISCONNECTED && !isGameMode) {
            currentAppState = STATE_IDLE;
            isArmed = false; isSwinging = false;
            previousBleMillis = currentMillis; 
            previousImuMicros = currentMicros;
        }
      
        if (!isGameMode && (currentAppState == STATE_IDLE || currentAppState == STATE_REVIEW)) {
            if (inactivityTimeout_ms > 0 && (currentMillis - lastActivityTime > inactivityTimeout_ms)) {
                if (!(NRF_POWER->USBREGSTATUS & 1)) {
                    goToDeepSleep(); 
                }
            }
        }
      
        if (calibrationChar.written()) {
            lastActivityTime = currentMillis;
            if (calibrationChar.valueLength() == 16) {
                memcpy(&hardwareMatrix, calibrationChar.value(), 16);
                kv_set("cal_matrix", &hardwareMatrix, sizeof(hardwareMatrix), 0);
                setLEDColor(0, 255, 0); delay(150); setLEDColor(0, 0, 0);
            }
        }

        if (commandChar.written()) {
            const uint8_t* data = commandChar.value(); 
            int len = commandChar.valueLength();
            
            // Only reset the inactivity timer if the command is NOT a battery poll ('P')
            if (len > 0 && data[0] != 'P') {
                lastActivityTime = currentMillis; 
            }
            
            handleBleCommand(data, len, currentMillis, currentMicros);
        }
    }

    updateLEDStateMachine();
    updateKinematics(currentMillis, currentMicros, connected);

    // --- FIX: Allow telemetry during Match Mode ---
    if (connected && !inImpactWindow) {
        if (currentMillis - previousBleMillis >= BLE_INTERVAL) {
            previousBleMillis = currentMillis;
            
            float omegaMag = sqrt(pow(myIMU.readFloatGyroX(), 2) + pow(myIMU.readFloatGyroY(), 2) + pow(myIMU.readFloatGyroZ(), 2)) * (PI / 180.0);
            float currentAccelMag = sqrt(ax*ax + ay*ay + az*az); 
            float dynR = radius_m;

            if (omegaMag > 2.0) {
                float dynamic_ac = currentAccelMag - cos(filter.getPitch() * (PI / 180.0));
                if (dynamic_ac < 0) dynamic_ac = 0; 
                dynR = (dynamic_ac * 9.81) / (omegaMag * omegaMag);
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

    if (chunkDirty && pendingStrikeCount > 0) {
        if (currentMillis - lastStrikeTime >= IDLE_SAVE_DELAY_MS) {
            savePendingToFlash();
        }
    }
}

void goToDeepSleep() {
    setLEDColor(0, 0, 0);
    BLE.disconnect(); 
    BLE.end();
    delay(100);
    
    if (pendingStrikeCount > 0) savePendingToFlash();
    delay(100);
    
    // RESTORED FROM V6: Gracefully put the IMU to sleep via software commands
    // This prevents the backward power leak through the I2C pull-up resistors!
    myIMU.writeRegister(0x11, 0x00); // Turn off gyro
    myIMU.writeRegister(0x10, 0x20); // Set accel to low power mode
    myIMU.writeRegister(0x58, 0x80); 
    myIMU.writeRegister(0x5B, 0x3F);
    myIMU.writeRegister(0x5C, 0x00);
    myIMU.writeRegister(0x5E, 0x20); 
    
    // Clear any lingering IMU interrupts so it is ready to wake on motion
    uint8_t clearInterrupt;
    myIMU.readRegister(&clearInterrupt, 0x1C); 
    myIMU.readRegister(&clearInterrupt, 0x1D); 
    
    // Configure the IMU interrupt pin to safely wake the nRF52840
    pinMode(IMU_INT_PIN, INPUT);
    nrf_gpio_cfg_sense_input(IMU_INT_PIN, NRF_GPIO_PIN_PULLDOWN, NRF_GPIO_PIN_SENSE_HIGH);
    
    // Halt the main CPU (Total System Off)
    NRF_POWER->SYSTEMOFF = 1; 
}