/**
 * LevelEdge BLE Manager
 * Abstracts all hardware communication, Web Bluetooth connections, 
 * and packet parsing away from the UI/Kinematics engine.
 */
class LevelEdgeBLEManager {
    constructor() {
        // --- UUID Definitions ---
        this.SERVICE_UUID     = "19b30000-e8f2-537e-4f6c-d104768a1214"; 
        this.TELEMETRY_UUID   = "19b30001-e8f2-537e-4f6c-d104768a1214"; 
        this.COMMAND_UUID     = "19b30002-e8f2-537e-4f6c-d104768a1214"; 
        this.STRIKE_UUID      = "19b30003-e8f2-537e-4f6c-d104768a1214";
        this.CALIBRATION_UUID = "19b30004-e8f2-537e-4f6c-d104768a1214";
        this.IDENTITY_UUID    = "19b30005-e8f2-537e-4f6c-d104768a1214";
        this.TRACE_UUID       = "19b30006-e8f2-537e-4f6c-d104768a1214";
        this.PROFILE_UUID     = "19b30007-e8f2-537e-4f6c-d104768a1214";

        // --- Hardware State ---
        this.device = null;
        this.server = null;
        this.commandChar = null;
        this.calibrationChar = null;
        this.profileChar = null;
        this.deviceName = "Unknown Mallet";
        this.deviceMac = null;
        this.hardwareProfile = null;

        this._traceBuffer = new Array(40).fill(null);
        this._chunksReceived = 0;

        // --- Telemetry Tracking ---
        this._lastRawTs = -1;
        this._tsOffset = 0;

        // --- UI Callbacks (Assigned by main.js) ---
        this.onStateChange = null;       // (isConnected, deviceName, deviceMac, hardwareProfile)
        this.onBatteryUpdate = null;     // (voltage_mV, isCharging, availStrikes)
        this.onFirmwareVersion = null;   // (versionString)
        this.onTelemetryData = null;     // (telemetryObject)
        this.onLiveStrike = null;        // (parsedStrikeObject)
        this.onHistoricalStrike = null;  // (parsedStrikeObject)
        this.onError = null;             // (errorMessage)
        this.onTraceData = null;         // (assembledTraceArray)

        // --- Auto-Reconnect & Concurrency State ---
        this.intentionalDisconnect = false;
        this.reconnectInterval = null;
        this._isConnecting = false;
        this._gattQueue = Promise.resolve();

        // --- Bound Handlers for Event Listener Cleanups ---
        this._boundParseTelemetry = this._parseTelemetryPacket.bind(this);
        this._boundParseStrike = this._parseStrikePacket.bind(this);
        this._boundParseTrace = this._parseTracePacket.bind(this);
    }

    isConnected() {
        return !!(this.device && this.device.gatt && this.device.gatt.connected);
    }

    _enqueueGatt(fn) {
        const next = this._gattQueue.then(() => fn(), () => fn());
        this._gattQueue = next.catch(() => {});
        return next;
    }

    _parseProfileDataView(dv) {
        if (!dv || dv.byteLength < 48) return null;
        const profile = {
            version: dv.getUint8(0),
            isCalibrated: dv.getUint8(1) === 1,
            w: dv.getFloat32(4, true),
            x: dv.getFloat32(8, true),
            y: dv.getFloat32(12, true),
            z: dv.getFloat32(16, true),
            headLength_cm: dv.getFloat32(20, true),
            faceWidth_cm: dv.getFloat32(24, true),
            handleLength_cm: dv.getFloat32(28, true),
            mass_g: dv.getFloat32(32, true),
            offsetY_cm: dv.getFloat32(36, true),
            offsetZ_cm: dv.getFloat32(40, true),
            sweetSpot_cm: dv.getFloat32(44, true)
        };
        this.hardwareProfile = profile;
        return profile;
    }

    async _setupGATT() {
        if (this._isConnecting) return;
        this._isConnecting = true;

        try {
            await this._enqueueGatt(async () => {
                this.server = await this.device.gatt.connect();
                const service = await this.server.getPrimaryService(this.SERVICE_UUID);

                // 1. Read unique hardware BLE MAC address from identityChar (19B30005)
                try {
                    const identityChar = await service.getCharacteristic(this.IDENTITY_UUID);
                    const idView = await identityChar.readValue();
                    const rawMac = new TextDecoder().decode(idView).replace(/\0/g, '').trim().toUpperCase();
                    this.deviceMac = rawMac || this.device.id || this.deviceName;
                } catch (e) {
                    console.warn("Could not read identityChar, falling back to device name:", e);
                    this.deviceMac = this.deviceName.toUpperCase();
                }

                // 2. Bind Calibration & 48-Byte Flash Profile characteristics
                try {
                    this.calibrationChar = await service.getCharacteristic(this.CALIBRATION_UUID);
                } catch (e) {
                    this.calibrationChar = null;
                }

                try {
                    this.profileChar = await service.getCharacteristic(this.PROFILE_UUID);
                    const dv = await this.profileChar.readValue();
                    this.hardwareProfile = this._parseProfileDataView(dv);
                } catch (e) {
                    console.warn("Firmware does not expose 19B30007 profileChar:", e);
                    this.profileChar = null;
                    this.hardwareProfile = null;
                }

                // 3. Subscribe to notifications
                const telemetryChar = await service.getCharacteristic(this.TELEMETRY_UUID); 
                await telemetryChar.startNotifications(); 
                telemetryChar.removeEventListener('characteristicvaluechanged', this._boundParseTelemetry);
                telemetryChar.addEventListener('characteristicvaluechanged', this._boundParseTelemetry);

                const strikeChar = await service.getCharacteristic(this.STRIKE_UUID); 
                await strikeChar.startNotifications(); 
                strikeChar.removeEventListener('characteristicvaluechanged', this._boundParseStrike);
                strikeChar.addEventListener('characteristicvaluechanged', this._boundParseStrike);

                const traceChar = await service.getCharacteristic(this.TRACE_UUID);
                await traceChar.startNotifications();
                traceChar.removeEventListener('characteristicvaluechanged', this._boundParseTrace);
                traceChar.addEventListener('characteristicvaluechanged', this._boundParseTrace);

                this.commandChar = await service.getCharacteristic(this.COMMAND_UUID);

                this._lastRawTs = -1;
                this._tsOffset = 0;
            });

            if (this.onStateChange) {
                this.onStateChange(true, this.deviceName, this.deviceMac, this.hardwareProfile);
            }
        } finally {
            this._isConnecting = false;
        }
    }

    /**
     * Reads the 48-byte MalletBleProfile struct stored in the Xiao's internal flash.
     */
    async readMalletProfile() {
        if (!this.profileChar) return null;
        return this._enqueueGatt(async () => {
            try {
                const dv = await this.profileChar.readValue();
                return this._parseProfileDataView(dv);
            } catch (e) {
                console.error("Failed reading mallet flash profile:", e);
                return null;
            }
        });
    }

    /**
     * Writes the full 48-byte MalletBleProfile struct to the Xiao (triggers internal flash commit).
     */
    async writeMalletProfile(p) {
        if (!this.profileChar) {
            // Fallback for older firmware: write 16-byte calibration matrix only
            return await this.writeCalibrationMatrix(p.w, p.x, p.y, p.z);
        }
        return this._enqueueGatt(async () => {
            try {
                const buffer = new ArrayBuffer(48);
                const dv = new DataView(buffer);
                dv.setUint8(0, 1); // Schema version 1
                dv.setUint8(1, p.isCalibrated ? 1 : 0);
                dv.setUint16(2, 0, true);
                dv.setFloat32(4, p.w ?? 1.0, true);
                dv.setFloat32(8, p.x ?? 0.0, true);
                dv.setFloat32(12, p.y ?? 0.0, true);
                dv.setFloat32(16, p.z ?? 0.0, true);
                dv.setFloat32(20, p.headLength_cm ?? 27.6, true);
                dv.setFloat32(24, p.faceWidth_cm ?? 6.0, true);
                dv.setFloat32(28, p.handleLength_cm ?? 91.4, true);
                dv.setFloat32(32, p.mass_g ?? 1000.0, true);
                dv.setFloat32(36, p.offsetY_cm ?? 5.5, true);
                dv.setFloat32(40, p.offsetZ_cm ?? 10.0, true);
                dv.setFloat32(44, p.sweetSpot_cm ?? 1.5, true);

                await new Promise(resolve => setTimeout(resolve, 35));
                await this.profileChar.writeValueWithResponse(buffer);
                this.hardwareProfile = { ...p, version: 1, isCalibrated: !!p.isCalibrated };
                return true;
            } catch (e) {
                console.error("Failed writing mallet flash profile:", e);
                return false;
            }
        });
    }

    /**
     * Writes the 16-byte CalibrationMatrix quaternion directly to 19B30004.
     */
    async writeCalibrationMatrix(w, x, y, z) {
        if (!this.calibrationChar) return false;
        return this._enqueueGatt(async () => {
            try {
                const buffer = new ArrayBuffer(16);
                const view = new Float32Array(buffer);
                view[0] = w;
                view[1] = x;
                view[2] = y;
                view[3] = z;
                await new Promise(resolve => setTimeout(resolve, 35));
                await this.calibrationChar.writeValueWithResponse(buffer);
                return true;
            } catch (e) {
                console.error("Failed writing calibration matrix:", e);
                return false;
            }
        });
    }

    /**
     * Triggers the browser's Bluetooth picker and establishes the GATT connection.
     */
    async connect() {
        if (this._isConnecting) return;

        if (this.isConnected()) {
            this.intentionalDisconnect = true;
            this.disconnect();
            return;
        }

        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }

        if (!navigator.bluetooth) {
            if (this.onError) this.onError("Web Bluetooth is not supported on this browser.");
            return;
        }

        try {
            this.device = await navigator.bluetooth.requestDevice({ 
                filters: [{ namePrefix: 'LVE' }, { namePrefix: 'Phan' }], 
                optionalServices: [this.SERVICE_UUID] 
            });

            this.deviceName = this.device.name || "LVE Mallet";
            this.device.addEventListener('gattserverdisconnected', () => this._handleDisconnect());
            
            this.intentionalDisconnect = false;
            await this._setupGATT();

        } catch (error) {
            if (error.name !== 'NotFoundError' && this.onError) {
                this.onError(error.message);
            }
        }
    }

    disconnect() {
        this.intentionalDisconnect = true;
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
        if (this.isConnected()) {
            this.device.gatt.disconnect();
        }
    }

    _handleDisconnect() {
        this.commandChar = null;
        this.calibrationChar = null;
        this.profileChar = null;
        const disconnectedMac = this.deviceMac;
        this.deviceMac = null;
        this.hardwareProfile = null;

        if (this.onStateChange) this.onStateChange(false, null, disconnectedMac, null);
        
        if (!this.intentionalDisconnect && this.device) {
            this._autoReconnect();
        }
    }

    async _autoReconnect() {
        if (this.reconnectInterval) clearInterval(this.reconnectInterval);
        
        this.reconnectInterval = setInterval(async () => {
            if (this.isConnected()) {
                clearInterval(this.reconnectInterval);
                this.reconnectInterval = null;
                return;
            }
            if (this._isConnecting) return;
            
            try {
                await this._setupGATT();
                clearInterval(this.reconnectInterval);
                this.reconnectInterval = null;
            } catch(e) {
                // Retry on next interval tick
            }
        }, 5000);
    }

    /**
     * Sends a command byte array to the Mallet.
     */
    async sendCommand(cmdArray, withResponse = false) {
        if (!this.commandChar) return false;
        return this._enqueueGatt(async () => {
            if (!this.commandChar) return false;
            try {
                await new Promise(resolve => setTimeout(resolve, 35));
                if (withResponse) {
                    await this.commandChar.writeValueWithResponse(new Uint8Array(cmdArray));
                } else {
                    await this.commandChar.writeValueWithoutResponse(new Uint8Array(cmdArray));
                }
                return true;
            } catch(e) {
                return false;
            }
        });
    }

    // --- INTERNAL PARSERS ---

    _parseTelemetryPacket(event) {
        if (!this.onTelemetryData) return;
        const data = event.target.value; 
        if (data.byteLength < 20) return;

        const rawTs = data.getUint16(0, true); 
        if (this._lastRawTs !== -1 && rawTs < this._lastRawTs - 30000) { 
            this._tsOffset += 65536; 
        }
        this._lastRawTs = rawTs; 

        const rawAppState = data.getUint8(17);
        const isGameMode = rawAppState >= 80;

        const telemetryObject = {
            hwTimestamp: rawTs + this._tsOffset,
            q0: data.getInt16(2, true) / 10000.0,
            q1: data.getInt16(4, true) / 10000.0,
            q2: data.getInt16(6, true) / 10000.0,
            q3: data.getInt16(8, true) / 10000.0,
            ax: data.getInt16(10, true) / 100.0,
            ay: data.getInt16(12, true) / 100.0,
            az: data.getInt16(14, true) / 100.0,
            appliedForce: data.getInt8(16),
            rawAppState: rawAppState,
            appState: isGameMode ? 7 : rawAppState,
            isGameMode: isGameMode,
            gameSubState: isGameMode ? (rawAppState - 80) : 0,
            dynRadius: data.getUint16(18, true) / 1000.0
        };

        this.onTelemetryData(telemetryObject);
    }

    _parseStrikePacket(event) {
        const data = event.target.value; 
        if (data.byteLength === 0) return;

        const header = data.getUint8(0);

        if (header === 86) { 
            const rawBytes = new Uint8Array(data.buffer, data.byteOffset + 1, data.byteLength - 1); 
            if (this.onFirmwareVersion) this.onFirmwareVersion(new TextDecoder().decode(rawBytes));
            return; 
        }

        if (header === 66 && data.byteLength >= 5) { 
            const compressed_V = data.getUint8(1); 
            const voltage_mV = (compressed_V * 5) + 3000;
            const isCharging = data.getUint8(2) === 1; 
            const availStrikes = data.getUint16(3, true); 
            
            if (this.onBatteryUpdate) this.onBatteryUpdate(voltage_mV, isCharging, availStrikes);
            return;
        }

        if (data.byteLength < 32) return;
        if (header !== 72 && header !== 83) return;

        const parsedStrike = {
            peakG: data.getInt16(1, true) / 100.0,
            peakTwist: data.getInt16(3, true) / 10.0,
            dwell: data.getUint8(5),
            backArc: data.getInt16(6, true) / 10.0,   
            faceAngle: data.getInt16(8, true) / 10.0,
            zVel: data.getInt16(10, true) / 100.0,
            appliedForce: data.getInt8(12),
            backswingTime: data.getUint16(13, true),
            q0: data.getInt16(15, true) / 10000.0,
            q1: data.getInt16(17, true) / 10000.0,
            q2: data.getInt16(19, true) / 10000.0,
            q3: data.getInt16(21, true) / 10000.0,
            matchID: data.getUint32(23, true),
            secondsIntoMatch: data.getUint16(27, true),
            downwardSwingTime: data.getUint16(29, true),
            decelFactor: data.getInt8(31),
            timestamp: Date.now()
        };

        if (header === 72) {
            if (this.onHistoricalStrike) this.onHistoricalStrike(parsedStrike);
        } else {
            if (this.onLiveStrike) this.onLiveStrike(parsedStrike);
        }
    }

    _parseTracePacket(event) {
        const data = event.target.value; 
        if (data.byteLength < 32 || data.getUint8(0) !== 84) return;

        const chunkIndex = data.getUint8(1);

        if (chunkIndex === 0) {
            this._traceBuffer = new Array(40).fill(null);
            this._chunksReceived = 0;
        }

        let quatOffset = chunkIndex * 3;
        for (let q = 0; q < 3; q++) {
            if (quatOffset + q < 40) {
                let byteOffset = 2 + (q * 8);
                this._traceBuffer[quatOffset + q] = {
                    q0: data.getInt16(byteOffset, true) / 10000.0,
                    q1: data.getInt16(byteOffset + 2, true) / 10000.0,
                    q2: data.getInt16(byteOffset + 4, true) / 10000.0,
                    q3: data.getInt16(byteOffset + 6, true) / 10000.0
                };
            }
        }

        this._chunksReceived++;

        // Fire when the final chunk arrives (even if 1-2 mid-burst packets dropped over BLE)
        if (chunkIndex === 13 && this._chunksReceived >= 10) {
            if (this.onTraceData) {
                this.onTraceData(this._traceBuffer);
            }
        }
    }
}

window.bleManager = new LevelEdgeBLEManager();