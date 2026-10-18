/**
 * LevelEdge BLE Manager
 * Abstracts all hardware communication, Web Bluetooth connections, 
 * and packet parsing away from the UI/Kinematics engine.
 */
class LevelEdgeBLEManager {
    constructor() {
        // --- UUID Definitions ---
        this.SERVICE_UUID = "19b30000-e8f2-537e-4f6c-d104768a1214"; 
        this.TELEMETRY_UUID = "19b30001-e8f2-537e-4f6c-d104768a1214"; 
        this.COMMAND_UUID = "19b30002-e8f2-537e-4f6c-d104768a1214"; 
        this.STRIKE_UUID = "19b30003-e8f2-537e-4f6c-d104768a1214";
        this.IDENTITY_UUID = "19b30005-e8f2-537e-4f6c-d104768a1214";
        this.TRACE_UUID = "19b30006-e8f2-537e-4f6c-d104768a1214";

        // --- Hardware State ---
        this.device = null;
        this.server = null;
        this.commandChar = null;
        this.deviceName = "Unknown Mallet";
        this._traceBuffer = new Array(40).fill(null);
        this._chunksReceived = 0;

        // --- Telemetry Tracking ---
        this._lastRawTs = -1;
        this._tsOffset = 0;

        // --- UI Callbacks (To be assigned by main app) ---
        this.onStateChange = null;       // (isConnected, deviceName)
        this.onBatteryUpdate = null;     // (batteryPct, isCharging, availStrikes)
        this.onFirmwareVersion = null;   // (versionString)
        this.onTelemetryData = null;     // (telemetryObject)
        this.onLiveStrike = null;        // (parsedStrikeObject)
        this.onHistoricalStrike = null;  // (parsedStrikeObject)
        this.onError = null;             // (errorMessage)
        this.onTraceData = null; // (assembledTraceArray)

        // --- For bluetooth auto re-connect
        this.intentionalDisconnect = false;
        this.reconnectInterval = null;
    }

    async _setupGATT() {
        this.server = await this.device.gatt.connect();
        const service = await this.server.getPrimaryService(this.SERVICE_UUID);

        const telemetryChar = await service.getCharacteristic(this.TELEMETRY_UUID); 
        await telemetryChar.startNotifications(); 
        telemetryChar.addEventListener('characteristicvaluechanged', (e) => this._parseTelemetryPacket(e));

        const strikeChar = await service.getCharacteristic(this.STRIKE_UUID); 
        await strikeChar.startNotifications(); 
        strikeChar.addEventListener('characteristicvaluechanged', (e) => this._parseStrikePacket(e));

        const traceChar = await service.getCharacteristic(this.TRACE_UUID);
        await traceChar.startNotifications();
        traceChar.addEventListener('characteristicvaluechanged', (e) => this._parseTracePacket(e));

        this.commandChar = await service.getCharacteristic(this.COMMAND_UUID);

        this._lastRawTs = -1;
        this._tsOffset = 0;

        if (this.onStateChange) this.onStateChange(true, this.deviceName);
    }

    /**
     * Triggers the browser's Bluetooth picker and establishes the GATT connection.
     */
    async connect() {
        if (this.device && this.device.gatt && this.device.gatt.connected) {
            this.intentionalDisconnect = true; // Mark as intentional
            this.disconnect();
            return;
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
            
            this.intentionalDisconnect = false; // User initiated a real connection
            await this._setupGATT(); // Call the abstracted method here

        } catch (error) {
            if (this.onError) this.onError(error.message);
        }
    }

    disconnect() {
        this.intentionalDisconnect = true; // Mark as intentional
        if (this.reconnectInterval) clearInterval(this.reconnectInterval);
        if (this.device && this.device.gatt && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        }
    }

    _handleDisconnect() {
        this.commandChar = null;
        if (this.onStateChange) this.onStateChange(false, null);
        
        // Trigger auto-reconnect if it was accidental
        if (!this.intentionalDisconnect && this.device) {
            this._autoReconnect();
        }
    }

    async _autoReconnect() {
        if (this.reconnectInterval) clearInterval(this.reconnectInterval);
        
        this.reconnectInterval = setInterval(async () => {
            if (this.device.gatt.connected) {
                clearInterval(this.reconnectInterval);
                return;
            }
            
            try {
                await this._setupGATT();
                clearInterval(this.reconnectInterval);
            } catch(e) {
                // Silently fail and wait for the next interval tick indefinitely
            }
        }, 5000);
    }

    /**
     * Sends a command byte array to the Mallet.
     * @param {Array} cmdArray - e.g. [82] for 'R'eset
     * @param {Boolean} withResponse - Require ACK from firmware
     */
    async sendCommand(cmdArray, withResponse = false) {
        if (!this.commandChar) return false;
        try {
            // Guarantee 35ms delay to prevent choking the BLE buffer
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
    }

    // --- INTERNAL PARSERS ---

    _parseTelemetryPacket(event) {
        if (!this.onTelemetryData) return;
        const data = event.target.value; 
        if (data.byteLength < 20) return;

        // Manage hardware microsecond overflow
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
            appState: isGameMode ? 7 : rawAppState, // 7 corresponds to STATE_GAME_MODE
            isGameMode: isGameMode,
            gameSubState: isGameMode ? (rawAppState - 80) : 0,
            dynRadius: data.getUint16(18, true) / 1000.0 // not using this as the values are wild
        };

        this.onTelemetryData(telemetryObject);
    }

    _parseStrikePacket(event) {
        const data = event.target.value; 
        if (data.byteLength === 0) return;

        const header = data.getUint8(0);

        // Header 'V' (86): Firmware Version String
        if (header === 86) { 
            const rawBytes = new Uint8Array(data.buffer, data.byteOffset + 1, data.byteLength - 1); 
            if (this.onFirmwareVersion) this.onFirmwareVersion(new TextDecoder().decode(rawBytes));
            return; 
        }

        // Header 'B' (66): Battery Status (Compressed 5-Byte Payload)
        if (header === 66 && data.byteLength >= 5) { 
            const compressed_V = data.getUint8(1); 
            
            // DECOMPRESSION: Multiply by 5 and add the 3000mV baseline back
            const voltage_mV = (compressed_V * 5) + 3000;
            
            const isCharging = data.getUint8(2) === 1; 
            const availStrikes = data.getUint16(3, true); 
            
            if (this.onBatteryUpdate) this.onBatteryUpdate(voltage_mV, isCharging, availStrikes);
            return;
        }

        // Must be exactly 32 bytes for the full structural payload
        if (data.byteLength < 32) return;
        if (header !== 72 && header !== 83) return;

        // Unpack the 32-byte payload exactly
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
            // 'H' - Mass Download / Historical Strike
            if (this.onHistoricalStrike) this.onHistoricalStrike(parsedStrike);
        } else {
            // 'S' - Live Strike
            if (this.onLiveStrike) this.onLiveStrike(parsedStrike);
        }
    }

    _parseTracePacket(event) {
        const data = event.target.value; 
        // Ensure it's exactly 32 bytes and starts with 'T' (ASCII 84)
        if (data.byteLength < 32 || data.getUint8(0) !== 84) return;

        const chunkIndex = data.getUint8(1);

        // Reset the buffer if this is the first chunk of a new trace
        if (chunkIndex === 0) {
            this._traceBuffer = new Array(40).fill(null);
            this._chunksReceived = 0;
        }

        // Each packet holds up to 3 quaternions (8 bytes each)
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

        // There are 40 samples at 3 per chunk = 13 chunks of 3, plus 1 chunk of 1 (14 total)
        if (this._chunksReceived === 14) {
            if (this.onTraceData) {
                this.onTraceData(this._traceBuffer);
            }
        }
    }
}

// Attach to window object for easy global access
window.bleManager = new LevelEdgeBLEManager();