/* =====================================================================================
 * PROJECT: LevelEdge Croquet
 * FILE: Firmware.ino
 * VERSION: 7.6.01 (Dual-Path Sleep, Abandoned Match Rescue, 32-Byte Payload)
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

// --- RESTORED TRUE 32-BYTE PAYLOAD ---
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
    uint16_t downwardSwingTime; // Ms elapsed from backswing peak to impact
    int8_t decelFactor;         // Percentage velocity drop-off (+/-)
};

// --- STORAGE & GAME MODE GLOBALS ---
const uint16_t MAX_STRIKES = 5000;
const uint8_t STRIKES_PER_CHUNK = 16;

uint16_t storedStrikeCount = 0; 
uint32_t currentMatchTime = 0; 
unsigned long matchStartMillis = 0;
unsigned long lastGameActivityTime = 0;

// --- MASSIVE RAM BUFFER & IDLE GATEKEEPER ---
const uint16_t MAX_PENDING_STRIKES = 250;
StrikePacket pendingStrikesBuffer[MAX_PENDING_STRIKES];
uint16_t pendingStrikeCount = 0; 
bool chunkDirty = false;
unsigned long lastStrikeTime = 0;
const unsigned long IDLE_SAVE_DELAY_MS = 30000; 

const char* FW_VERSION = "7.6.01";
int currentBatteryPct = 100; 
const int CHARGING_PIN = 5;

unsigned long inactivityTimeout_ms = 300000;
unsigned long lastActivityTime = 0;
const int IMU_INT_PIN = 11; 

LSM6DS3 myIMU(I2C_MODE, 0x6A);
FastMadgwick filter;

float ax = 0.0;
float ay = 0.0;
float az = 1.0;

// --- KINEMATIC TUNING CONSTANTS ---
const float WAKE_GYRO_THRESHOLD = 60.0;
const float HIGH_MOTION_GYRO_THRESHOLD = 800.0;
const float HIGH_MOTION_ACCEL_THRESHOLD = 2.5;
const float IDLE_GYRO_THRESHOLD = 5.0;
const float IDLE_ACCEL_TOLERANCE = 0.1;

// --- GAME MODE TIMEOUTS ---
const float GAME_MODE_AUTO_STOP_MS = 300000; // 5-Minute Tactical Pause
const unsigned long ABANDONED_MATCH_TIMEOUT_MS = 3600000; // 60-Minute Hard Kill

// --- BLUETOOTH SERVICES & CHARACTERISTICS ---
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

// --- CORES & CONFIGURATIONS ---
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
float zVelocity = 0.0;
int8_t appliedForceIndex = 0;
int8_t currentAppliedForce = 0;
float peakPush = 0.0;

float tmPitch[5] = {0};
float tmQ0[5] = {0}, tmQ1[5] = {0}, tmQ2[5] = {0}, tmQ3[5] = {0};
float tmVel[5] = {0};
int8_t tmAppForce[5] = {0};
float tmPushForce[5] = {0};
int tmIdx = 0;

float pristinePitch = 0.0;
float pristineQ0 = 1.0, pristineQ1 = 0.0, pristineQ2 = 0.0, pristineQ3 = 0.0;
float pristineVel = 0.0;
int8_t pristineAppForce = 0;
float pristinePushForce = 0.0;

// --- STATE MACHINE REGISTERS ---
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

// --- FORWARD DECLARATIONS ---
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
    delay(5);
    int rawADC = analogRead(PIN_VBAT);
    digitalWrite(PIN_VBAT_ENABLE, HIGH); 
    pinMode(PIN_VBAT_ENABLE, INPUT);
    
    float batteryVolts = (rawADC / 4095.0) * 3.3 * 2.96078;
    currentBatteryPct = constrain(map((int)(batteryVolts * 100), 340, 400, 0, 100), 0, 100);

    uint16_t availableStrikes = MAX_STRIKES - (storedStrikeCount + pendingStrikeCount);

    uint8_t battPacket[5];
    battPacket[0] = 'B'; 
    battPacket[1] = currentBatteryPct;
    battPacket[2] = (digitalRead(CHARGING_PIN) == HIGH) ? 1 : 0;
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
            if (currentMillis - lastLedBlinkTime >= 500) {
                lastLedBlinkTime = currentMillis;
                ledBlinkState = !ledBlinkState;
                if (ledBlinkState) setLEDColor(0, 0, 255); 
                else setLEDColor(0, 0, 0);
            } 
            break;
        case STATE_IDLE: setLEDColor(0, 0, 255); break;
        case STATE_CALIBRATING: setLEDColor(255, 0, 0); break;
        case STATE_STEADYING: setLEDColor(255, 80, 0); break;
        case STATE_ARMED: setLEDColor(0, 255, 0); break;
        case STATE_SWINGING:
            if (!led_guidance_enabled) {
                setLEDColor(0, 0, 0);
            } else {
                if (liveFeedbackState == 1) setLEDColor(0, 255, 0);
                else if (liveFeedbackState == 2) setLEDColor(255, 0, 0);    
                else if (liveFeedbackState == 3) { 
                    if (currentMillis % 150 < 75) setLEDColor(255, 0, 0);
                    else setLEDColor(0, 0, 0); 
                }
            } 
            break;
        case STATE_REVIEW: setLEDColor(0, 0, 255); break;
        case STATE_GAME_MODE: 
            if (currentMillis % 2000 < 1000) setLEDColor(0, 255, 0);
            else setLEDColor(0, 0, 0);
            break;
        default: setLEDColor(0, 0, 0); break;
    }
}

// --- FAST KINEMATIC INJECTION ENGINE ---
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

// --- HARDWARE INTERRUPT HANDLER ---
volatile bool imuAwakeFlag = false;
void imuWakeISR() {
    imuAwakeFlag = true;
}

// --- LOW POWER PAUSE ENGINE ---
void enterGameModeSleep() {
    setLEDColor(0, 0, 0);
    if (pendingStrikeCount > 0) savePendingToFlash();

    BLE.disconnect();
    BLE.stopAdvertise();
    delay(200);
    BLE.end();

    // Configure low-power movement watchdog alerts on LSM6DS3 registers
    myIMU.writeRegister(0x58, 0x80); // TAP_CFG: Enable operational interrupts
    myIMU.writeRegister(0x5B, 0x02); // WAKE_UP_THS: Lower detection trigger ceiling
    myIMU.writeRegister(0x5E, 0x20); // MD1_CFG: Route wakeup signals to INT1 handler

    imuAwakeFlag = false;
    attachInterrupt(digitalPinToInterrupt(IMU_INT_PIN), imuWakeISR, RISING);

    while (!imuAwakeFlag) {
        __WFI(); // Enter Mbed OS system suspend mode until movement wakes CPU
    }

    detachInterrupt(digitalPinToInterrupt(IMU_INT_PIN));
    myIMU.writeRegister(0x5E, 0x00); // Unbind interrupt pin maps

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

    injectGravitySnapshot(); // Execute fast calibration snap to clear math artifacts

    unsigned long nowMs = millis();
    lastGameActivityTime = nowMs;
    lastActivityTime = nowMs;
    previousBleMillis = nowMs;
    previousImuMicros = micros();
}

// --- COMMAND HANDLER ---
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

        minPitch = 0.0; 
        maxPitch = 0.0; 
        zVelocity = 0.0;
        peakPush = 0.0; 
        appliedForceIndex = 0; 
        currentAppliedForce = 0;
        topOfBackswingTime = 0;

        lastGameActivityTime = currentMillis; 
        lastStrikeTime = currentMillis; // Initialize 60-min abandonment clock
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
}

// --- KINEMATIC ENGINE ---
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
        float deltaG = abs(accelMag - prevAccelMag);

        // MOTION-BASED ACTIVITY MONITORING
        if (gyroMag > IDLE_GYRO_THRESHOLD || abs(accelMag - 1.0) > IDLE_ACCEL_TOLERANCE) { 
            lastActivityTime = currentMillis;
            if (isGameMode) {
                lastGameActivityTime = currentMillis; 
            }
        }

        // Isolate swing state check away from basic watch timers
        if (isArmed && gyroMag > WAKE_GYRO_THRESHOLD && currentAppState != STATE_SWINGING) { 
            isSwinging = true;
            currentAppState = STATE_SWINGING; 
        } 

        // AUTONOMOUS LOW-POWER HANDLER FOR ON-COURSE PAUSES
        if (isGameMode) {
            if (currentMillis - lastStrikeTime > ABANDONED_MATCH_TIMEOUT_MS) {
                // 60-Minute Abandonment Safeguard Triggered
                isGameMode = false;
                currentAppState = STATE_IDLE;
                goToDeepSleep(); // Safely commit RAM to flash and drop the guillotine
            } else if (currentMillis - lastGameActivityTime > GAME_MODE_AUTO_STOP_MS) {
                // Standard 5-Minute Tactical Pause
                enterGameModeSleep();
            }
        }

        if (accelMag > HIGH_MOTION_ACCEL_THRESHOLD || gyroMag > HIGH_MOTION_GYRO_THRESHOLD) { 
            filter.setBeta(0.0f);
        } 
        else if (abs(accelMag - 1.0) < IDLE_ACCEL_TOLERANCE && gyroMag < IDLE_GYRO_THRESHOLD) { 
            filter.setBeta(0.1f);
        } 
        else { 
            filter.setBeta(0.01f);
        }

        if (!inImpactWindow) { 
            filter.begin(1.0f / actualDt);
            filter.updateIMU(gx, gy, gz, ax, ay, az); 
        }

        float calPitch = filter.getPitch() - pitchOffset;
        float pitchRads = calPitch * (PI / 180.0);
        float omegaMag = gyroMag * (PI / 180.0);
        float currentSpeed = omegaMag * radius_m;
        float omegaSigned = (pitchRads > prevPitchRads) ? omegaMag : -omegaMag;
        
        float alphaRads = (omegaSigned - prevOmegaSigned) / actualDt;
        float alphaGrav = -(9.81 / radius_m) * sin(pitchRads);
        float alphaPush = alphaRads - alphaGrav;
        
        filtAlphaPush = (filtAlphaPush * 0.95) + (alphaPush * 0.05);
        float currentPush = mass_kg * radius_m * filtAlphaPush;
    
        if (abs(currentPush) > abs(peakPush)) peakPush = currentPush;
        
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
            tmQ0[tmIdx] = filter.q0;
            tmQ1[tmIdx] = filter.q1;
            tmQ2[tmIdx] = filter.q2; 
            tmQ3[tmIdx] = filter.q3;    
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
        
            bool validImpact = isArmed || (isGameMode && zVelocity > 1.0);

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
                float backArc = abs(minPitch) * radius_m * 100.0;
                float fwdArc = abs(maxPitch) * radius_m * 100.0; 
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
                        lastStrikeTime = currentMillis; // Reset 60-min match abandonment clock
                    } else {
                        savePendingToFlash();
                        pendingStrikesBuffer[pendingStrikeCount] = sp;
                        pendingStrikeCount++;
                        chunkDirty = true;
                        lastStrikeTime = currentMillis; // Reset 60-min match abandonment clock
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
    
    pinMode(LEDR, OUTPUT); 
    pinMode(LEDG, OUTPUT);
    pinMode(LEDB, OUTPUT);
    setLEDColor(0, 0, 0); 
    pinMode(CHARGING_PIN, INPUT);
    
    if (myIMU.begin() != 0) while (1);

    size_t actual_size = 0;
    int kvStatus = kv_get("str_cnt", &storedStrikeCount, sizeof(storedStrikeCount), &actual_size);
    
    if (kvStatus != 0 && kvStatus != MBED_ERROR_ITEM_NOT_FOUND) {
        for (int i = 0; i < 15; i++) { 
            setLEDColor(255, 0, 0); delay(100);
            setLEDColor(0, 255, 0); delay(100);
        }
        setLEDColor(0, 0, 0);
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
    delay(3000);
    
    gyroBiasX = 0; gyroBiasY = 0; gyroBiasZ = 0;
    for(int i = 0; i < 200; i++) {
        if ((i / 10) % 2 == 0) setLEDColor(255, 0, 0);
        else setLEDColor(0, 0, 0);
        gyroBiasX += myIMU.readFloatGyroY(); 
        gyroBiasY += myIMU.readFloatGyroX(); 
        gyroBiasZ += -myIMU.readFloatGyroZ();
        delay(10);
    }
    gyroBiasX /= 200.0; gyroBiasY /= 200.0; gyroBiasZ /= 200.0;
    
    filter.q0 = 0.0f; filter.q1 = 1.0f; filter.q2 = 0.0f; filter.q3 = 0.0f;
    setLEDColor(255, 0, 0);
    
    filter.begin(500.0f); 
    injectGravitySnapshot(); // Swapped slow iterations loop out for first-frame quick calibration injection

    setLEDColor(0, 0, 255); 
    delay(300);
    setLEDColor(0, 0, 0);
    
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
    
    if (!connected) {
        if (!isGameMode) {
            if (currentAppState != STATE_DISCONNECTED) { 
                currentAppState = STATE_DISCONNECTED;
                strikeHoldEndTime = 0; 
            }
            if (inactivityTimeout_ms > 0 && (currentMillis - lastActivityTime > inactivityTimeout_ms)) {
                goToDeepSleep(); // Calls original physical GUILLOTINE deep sleep command
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
                goToDeepSleep(); // Calls original physical GUILLOTINE deep sleep command
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
            lastActivityTime = currentMillis;
            const uint8_t* data = commandChar.value(); 
            int len = commandChar.valueLength();
            handleBleCommand(data, len, currentMillis, currentMicros);
        }
    }

    updateLEDStateMachine();
    updateKinematics(currentMillis, currentMicros, connected);

    if (connected && !isGameMode && !inImpactWindow) {
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
            pkt.q0 = (int16_t)(filter.q0 * 10000.0f);
            pkt.q1 = (int16_t)(filter.q1 * 10000.0f); 
            pkt.q2 = (int16_t)(filter.q2 * 10000.0f);
            pkt.q3 = (int16_t)(filter.q3 * 10000.0f);
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

// --- ORIGINAL DEEP SLEEP LOGIC (THE GUILLOTINE) ---
void goToDeepSleep() {
    setLEDColor(0, 0, 0);
    if (digitalRead(CHARGING_PIN) == HIGH) {
        lastActivityTime = millis();
        return; 
    }
    if (pendingStrikeCount > 0) savePendingToFlash();
    delay(1000);
    NRF_POWER->SYSTEMOFF = 1; 
}