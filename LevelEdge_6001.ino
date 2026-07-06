/* =====================================================================================
 * PROJECT: LevelEdge Croquet
 * FILE: Firmware.ino
 * VERSION: 6.0.01 (Lab-Grade Positional Engine Baseline)
 * ===================================================================================== */

#include <ArduinoBLE.h>
#include <LSM6DS3.h>
#include <Wire.h>
#include "FastMadgwick.h" 

const char* FW_VERSION = "6.0.01";
int currentBatteryPct = 100; 
const int CHARGING_PIN = 5;

unsigned long inactivityTimeout_ms = 300000;
unsigned long lastActivityTime = 0;
const int IMU_INT_PIN = 11; 

LSM6DS3 myIMU(I2C_MODE, 0x6A);
FastMadgwick filter;

// Global IMU Parameter Cache
float ax = 0.0;
float ay = 0.0;
float az = 1.0;

// --- BLUETOOTH SERVICES & CHARACTERISTICS ---
BLEService telemetryService("19B30000-E8F2-537E-4F6C-D104768A1214");
BLECharacteristic telemetryChar("19B30001-E8F2-537E-4F6C-D104768A1214", BLERead | BLENotify, 20); 
BLECharacteristic commandChar("19B30002-E8F2-537E-4F6C-D104768A1214", BLEWrite | BLEWriteWithoutResponse, 32);
BLECharacteristic strikeChar("19B30003-E8F2-537E-4F6C-D104768A1214", BLERead | BLENotify, 32);

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

// --- TIME MACHINE BUFFER ---
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
uint8_t currentAppState = 0; 
uint8_t liveFeedbackState = 1; 
bool isArmed = false;
bool isSwinging = false;
unsigned long strikeHoldEndTime = 0;

bool inImpactWindow = false;
bool strikePacketSent = false;
unsigned long impactStartTime = 0;
unsigned long lastImpactTime = 0;
float impactPeakG = 0;
float impactPeakTwist = 0;
int impactDwellSamples = 0;

// --- NON-BLOCKING CALIBRATION VARIABLES ---
float gyroBiasX = 0, gyroBiasY = 0, gyroBiasZ = 0;
bool isCalibratingBias = false;
int biasSamples = 0;

unsigned long lastLedBlinkTime = 0;
bool ledBlinkState = false;

// --- EXACT 20-BYTE PAYLOAD ---
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
};

void setLEDColor(uint8_t r, uint8_t g, uint8_t b) {
    analogWrite(LEDR, 255 - r);
    analogWrite(LEDG, 255 - g);
    analogWrite(LEDB, 255 - b);
}

void sendBatteryUpdate() {
    analogReadResolution(12);
    pinMode(PIN_VBAT_ENABLE, OUTPUT); digitalWrite(PIN_VBAT_ENABLE, LOW); delay(5); 
    int rawADC = analogRead(PIN_VBAT); digitalWrite(PIN_VBAT_ENABLE, HIGH); pinMode(PIN_VBAT_ENABLE, INPUT);
    float batteryVolts = (rawADC / 4095.0) * 3.3 * 2.96078;
    currentBatteryPct = constrain(map((int)(batteryVolts * 100), 340, 400, 0, 100), 0, 100);
    
    uint8_t battPacket[3];
    battPacket[0] = 66; // 'B' Header
    battPacket[1] = currentBatteryPct;
    battPacket[2] = (digitalRead(CHARGING_PIN) == HIGH) ? 1 : 0;
    strikeChar.writeValue(battPacket, 3);
}

void updateLEDStateMachine() {
    unsigned long currentMillis = millis();
    if (strikeHoldEndTime > 0 && currentMillis < strikeHoldEndTime) {
        setLEDColor(0, 0, 255); 
        return;
    }

    switch(currentAppState) {
        case 0: // DISCONNECTED
            if (currentMillis - lastLedBlinkTime >= 500) {
                lastLedBlinkTime = currentMillis;
                ledBlinkState = !ledBlinkState;
                if (ledBlinkState) setLEDColor(0, 0, 255);
                else setLEDColor(0, 0, 0);
            }
            break;
        case 1: // CONNECTED (Idle)
            setLEDColor(0, 0, 255);
            break;
        case 2: // CALIBRATING BIAS (RED)
            setLEDColor(255, 0, 0);
            break;
        case 6: // SETTLING (ORANGE)
            setLEDColor(255, 80, 0); 
            break;
        case 3: // ARMED
            setLEDColor(0, 255, 0);
            break;
        case 4: // LIVE SWING ZONE (JS CONTROLLED)
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
        case 5: // FINISHED
            setLEDColor(0, 0, 255); 
            break;
        default: 
            setLEDColor(0, 0, 0); 
            break;
    }
}

void setup() {
  Serial.begin(115200);

  pinMode(LEDR, OUTPUT); pinMode(LEDG, OUTPUT); pinMode(LEDB, OUTPUT);
  setLEDColor(0, 0, 0);
  pinMode(CHARGING_PIN, INPUT);
  if (myIMU.begin() != 0) while (1);

  // --- BOOT SEQUENCE WITH GRACE PERIOD ---
  setLEDColor(0, 255, 0); 
  delay(3000); 

  gyroBiasX = 0; gyroBiasY = 0; gyroBiasZ = 0;
  for(int i=0; i<200; i++) {
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
  float snapAx = myIMU.readFloatAccelY();
  float snapAy = myIMU.readFloatAccelX();
  float snapAz = -myIMU.readFloatAccelZ();
  
  filter.begin(500.0f);
  filter.setBeta(10.0f);
  for(int i=0; i<2000; i++) filter.updateIMU(0, 0, 0, snapAx, snapAy, snapAz);
  filter.setBeta(2.0f);
  for(int i=0; i<2000; i++) filter.updateIMU(0, 0, 0, snapAx, snapAy, snapAz);
  filter.setBeta(0.2f);
  for(int i=0; i<2000; i++) filter.updateIMU(0, 0, 0, snapAx, snapAy, snapAz);
  filter.setBeta(0.01f); 

  setLEDColor(0, 0, 255);
  delay(300); setLEDColor(0, 0, 0);
  
  if (!BLE.begin()) while (1);
  String mac = BLE.address(); 
  String shortMac = "0000";
  if (mac.length() >= 17) {
      shortMac = mac.substring(12, 14) + mac.substring(15, 17);
      shortMac.toUpperCase();
  }
  String bleDeviceName = "LVE Mallet " + shortMac;
  BLE.setLocalName(bleDeviceName.c_str()); BLE.setDeviceName(bleDeviceName.c_str());
  
  BLE.setAdvertisedService(telemetryService);
  telemetryService.addCharacteristic(telemetryChar); 
  telemetryService.addCharacteristic(commandChar); 
  telemetryService.addCharacteristic(strikeChar);
  BLE.addService(telemetryService);

  BLE.setAdvertisingInterval(160); BLE.advertise();
  lastActivityTime = millis(); previousImuMicros = micros(); 
}

void loop() {
  BLEDevice central = BLE.central();
  unsigned long globalMillis = millis();
  
  if (!central) {
    currentAppState = 0; 
    strikeHoldEndTime = 0;
    updateLEDStateMachine();
    if (inactivityTimeout_ms > 0 && (globalMillis - lastActivityTime > inactivityTimeout_ms)) {
        goToDeepSleep();
    }
    delay(5); 
  }

  if (central) {
    if (currentAppState == 0) currentAppState = 1;
    isArmed = false;
    isSwinging = false;
    previousBleMillis = millis();
    previousImuMicros = micros();
    
    while (central.connected()) {
      unsigned long currentMillis = millis();
      unsigned long currentMicros = micros();

      if (currentAppState == 1 || currentAppState == 5) {
          if (inactivityTimeout_ms > 0 && (currentMillis - lastActivityTime > inactivityTimeout_ms)) {
              goToDeepSleep(); 
          }
      }

      updateLEDStateMachine();
      
      if (commandChar.written()) {
        lastActivityTime = currentMillis;
        const uint8_t* data = commandChar.value();
        int len = commandChar.valueLength();
        
        if (len > 0) {
            if (data[0] == 82) { 
                setLEDColor(255, 0, 0);
                delay(200); NVIC_SystemReset(); 
            } 
            else if (data[0] == 90) { 
                currentAppState = 2;
                isCalibratingBias = true;
                biasSamples = 0;
                gyroBiasX = 0; gyroBiasY = 0; gyroBiasZ = 0;
                prevPitchRads = 0.01;
                previousImuMicros = micros();
                sendBatteryUpdate();
            }
            else if (data[0] == 71) { 
                if (isCalibratingBias) {
                    if (biasSamples > 0) {
                        gyroBiasX /= biasSamples; gyroBiasY /= biasSamples; gyroBiasZ /= biasSamples;
                    }
                    isCalibratingBias = false;
                }
                
                isArmed = true; isSwinging = false; strikeHoldEndTime = 0;
                currentAppState = 3; liveFeedbackState = 1; 
                previousImuMicros = micros();
                
                pitchOffset = filter.getPitch(); yawOffset = filter.getYaw();     
                minPitch = 0.0; maxPitch = 0.0; zVelocity = 0.0; peakPush = 0.0; 
                appliedForceIndex = 0; currentAppliedForce = 0;
                for(int i=0; i<5; i++) { 
                    tmPitch[i] = 0; tmQ0[i] = 1.0; tmQ1[i] = 0; tmQ2[i] = 0; tmQ3[i] = 0; tmVel[i] = 0; tmAppForce[i] = 0; tmPushForce[i] = 0.0;
                }
            }
            else if (data[0] == 72) { liveFeedbackState = 1; } 
            else if (data[0] == 73) { liveFeedbackState = 2; } 
            else if (data[0] == 74) { liveFeedbackState = 3; } 
            else if (data[0] == 79) { 
                isArmed = false; isSwinging = false; currentAppState = 1; strikeHoldEndTime = 0;
            }
            else if (data[0] == 67 && len >= 9) { 
                radius_m = data[1] / 100.0;
                mass_kg = (data[2] * 10.0) / 1000.0;
                impactThreshold = data[3] / 10.0;
                offset_m = data[4] / 1000.0;
                inactivityTimeout_ms = data[5] * 60000UL;
                sweetSpot_cm = data[6] / 10.0;
                led_guidance_enabled = (data[7] == 1);
                twistTolerance_deg = data[8] / 10.0;
                if (impactThreshold < 1.0) impactThreshold = 1.0;
                
                strikeChar.writeValue((const uint8_t*)" ", 1); delay(5); 
                String verStr = String("V") + FW_VERSION;
                strikeChar.writeValue((const uint8_t*)verStr.c_str(), verStr.length());
                delay(10);
                sendBatteryUpdate(); 
            }
        }
      }

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

        ax = rawAy; ay = rawAx; az = -rawAz;
        
        float gx, gy, gz;
        
        if (isCalibratingBias) {
            gyroBiasX += rawGy; gyroBiasY += rawGx; gyroBiasZ += -rawGz;
            biasSamples++;

            if (biasSamples >= 1000) {
                gyroBiasX /= 1000.0; gyroBiasY /= 1000.0; gyroBiasZ /= 1000.0;
                isCalibratingBias = false;
                filter.setBeta(10.0f);
                for(int i=0; i<1000; i++) filter.updateIMU(0, 0, 0, ax, ay, az);
                filter.setBeta(0.01f);
                
                if (currentAppState == 2) currentAppState = 6; 
            }
            gx = 0.0; gy = 0.0; gz = 0.0; 
        } else {
            gx = rawGy - gyroBiasX; gy = rawGx - gyroBiasY; gz = -rawGz - gyroBiasZ;
        }

        float accelMag = sqrt(ax*ax + ay*ay + az*az);
        float gyroMag = sqrt(gx*gx + gy*gy + gz*gz);
        float deltaG = abs(accelMag - prevAccelMag);
        
        if (isArmed || gyroMag > 60.0) {
            lastActivityTime = currentMillis;
            if (isArmed && gyroMag > 60.0 && currentAppState != 4) {
                isSwinging = true; currentAppState = 4; 
            }
        }

        if (accelMag > 2.5 || gyroMag > 800.0) { filter.setBeta(0.0f); } 
        else if (abs(accelMag - 1.0) < 0.1 && gyroMag < 5.0) { filter.setBeta(0.1f); } 
        else { filter.setBeta(0.01f); }

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
            tmQ0[tmIdx] = filter.q0; tmQ1[tmIdx] = filter.q1; tmQ2[tmIdx] = filter.q2; tmQ3[tmIdx] = filter.q3;    
            tmVel[tmIdx] = currentSpeed; tmAppForce[tmIdx] = currentAppliedForce; tmPushForce[tmIdx] = peakPush;      
            tmIdx = (tmIdx + 1) % 5;
        }

        if (pitchRads < minPitch) minPitch = pitchRads;
        if (pitchRads > maxPitch) maxPitch = pitchRads;
        
        if (isArmed) {
            if (pitchRads < 0.0 && pitchRads > -(PI/2.0) && omegaSigned > 0) {
                if (currentSpeed > zVelocity) { zVelocity = currentSpeed; appliedForceIndex = currentAppliedForce; }
            }

            if (!inImpactWindow && deltaG >= impactThreshold && (currentMillis - lastImpactTime > 500)) {
                inImpactWindow = true; strikePacketSent = false;
                impactStartTime = currentMillis; impactPeakG = accelMag; impactPeakTwist = gyroMag; impactDwellSamples = 1; 

                int oldIdx = (tmIdx + 1) % 5;
                pristinePitch = tmPitch[oldIdx];
                pristineQ0 = tmQ0[oldIdx]; pristineQ1 = tmQ1[oldIdx]; pristineQ2 = tmQ2[oldIdx]; pristineQ3 = tmQ3[oldIdx];
                pristineVel = tmVel[oldIdx]; pristineAppForce = tmAppForce[oldIdx]; pristinePushForce = tmPushForce[oldIdx];
            }
        }

        if (inImpactWindow) {
            unsigned long elapsed = currentMillis - impactStartTime;
            if (elapsed <= 25) {
                if (accelMag > impactPeakG) impactPeakG = accelMag;
                if (gyroMag > impactPeakTwist) impactPeakTwist = gyroMag;
                if (accelMag > 2.0) impactDwellSamples++;
            } else if (elapsed > 25 && !strikePacketSent) {
                float backArc = abs(minPitch) * radius_m * 100.0; float fwdArc = abs(maxPitch) * radius_m * 100.0; int dwellMs = impactDwellSamples * 2;
                if (isnan(pristineVel) || isinf(pristineVel)) pristineVel = 0.0;

                StrikePacket sp; sp.header = 83;
                sp.peakG = (int16_t)(impactPeakG * 100.0); sp.peakTwist = (int16_t)(impactPeakTwist * 10.0);
                sp.dwell = (uint8_t)constrain(dwellMs, 0, 255); sp.backArc = (int16_t)(backArc * 10.0); sp.fwdArc = (int16_t)(fwdArc * 10.0);
                sp.zVel = (int16_t)(pristineVel * 100.0); sp.appliedForce = pristineAppForce; sp.pushForce = (int16_t)(pristinePushForce * 10.0);
                sp.q0 = (int16_t)(pristineQ0 * 10000.0f); sp.q1 = (int16_t)(pristineQ1 * 10000.0f); sp.q2 = (int16_t)(pristineQ2 * 10000.0f); sp.q3 = (int16_t)(pristineQ3 * 10000.0f);
                strikeChar.writeValue((uint8_t*)&sp, sizeof(sp));
                
                strikePacketSent = true; strikeHoldEndTime = currentMillis + 10000; currentAppState = 5; 
            } else if (elapsed > 150) {
                inImpactWindow = false; lastImpactTime = currentMillis; previousBleMillis = currentMillis; 
                minPitch = 0.0; maxPitch = 0.0; peakPush = 0.0; zVelocity = 0.0; appliedForceIndex = 0; isArmed = false; isSwinging = false;
            }
        }
        prevAccelMag = accelMag; prevPitchRads = pitchRads; prevOmegaSigned = omegaSigned;
      }

      if (currentMillis - previousBleMillis >= BLE_INTERVAL) {
        previousBleMillis = currentMillis;
        
        if (!inImpactWindow) {
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
            
            pkt.q0 = (int16_t)(filter.q0 * 10000.0f); pkt.q1 = (int16_t)(filter.q1 * 10000.0f);
            pkt.q2 = (int16_t)(filter.q2 * 10000.0f); pkt.q3 = (int16_t)(filter.q3 * 10000.0f);
            
            pkt.ax = (int16_t)(ax * 100); pkt.ay = (int16_t)(ay * 100); pkt.az = (int16_t)(az * 100); 
            
            pkt.appliedForce = currentAppliedForce;
            pkt.appState = currentAppState; 
            pkt.dynRadius = (uint16_t)(constrain(dynR * 1000.0f, 0, 65535)); 
            
            telemetryChar.writeValue((uint8_t*)&pkt, sizeof(pkt));
        }
      }
    }
    setLEDColor(0, 0, 0); lastActivityTime = millis();
  }
}

void goToDeepSleep() {
  setLEDColor(0, 0, 0);
  BLE.disconnect(); BLE.end();
  myIMU.writeRegister(0x11, 0x00); myIMU.writeRegister(0x10, 0x20); 
  myIMU.writeRegister(0x58, 0x80); myIMU.writeRegister(0x5B, 0x3F);
  myIMU.writeRegister(0x5C, 0x00);
  myIMU.writeRegister(0x5E, 0x20); 
  uint8_t clearInterrupt;
  myIMU.readRegister(&clearInterrupt, 0x1C); myIMU.readRegister(&clearInterrupt, 0x1D); 
  pinMode(IMU_INT_PIN, INPUT);
  nrf_gpio_cfg_sense_input(IMU_INT_PIN, NRF_GPIO_PIN_PULLDOWN, NRF_GPIO_PIN_SENSE_HIGH);
  NRF_POWER->SYSTEMOFF = 1; 
}