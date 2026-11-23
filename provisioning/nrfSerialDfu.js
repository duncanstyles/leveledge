// nrfSerialDfu.js — Self-contained Adafruit nRF52840 Web Serial DFU uploader

const SLIP_END     = 0xC0;
const SLIP_ESC     = 0xDB;
const SLIP_ESC_END = 0xDC;
const SLIP_ESC_ESC = 0xDD;

const DFU_INIT_PACKET      = 1;
const DFU_START_PACKET     = 3;
const DFU_DATA_PACKET      = 4;
const DFU_STOP_DATA_PACKET = 5;

const DFU_UPDATE_MODE_APP  = 4;
const HCI_PACKET_TYPE      = 14; // 0x0E
const DFU_PACKET_MAX_SIZE  = 512;

function uint32LE(val) {
    return new Uint8Array([
        val & 0xFF,
        (val >>> 8) & 0xFF,
        (val >>> 16) & 0xFF,
        (val >>> 24) & 0xFF
    ]);
}

function calcCrc16(bytes) {
    let crc = 0xFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = ((crc >> 8) & 0xFF) | ((crc << 8) & 0xFFFF);
        crc ^= bytes[i];
        crc ^= (crc & 0xFF) >> 4;
        crc ^= (crc << 8) << 4;
        crc ^= ((crc & 0xFF) << 4) << 1;
        crc &= 0xFFFF;
    }
    return crc;
}

function slipEncode(rawBytes) {
    const out = [SLIP_END];
    for (let i = 0; i < rawBytes.length; i++) {
        const b = rawBytes[i];
        if (b === SLIP_END) {
            out.push(SLIP_ESC, SLIP_ESC_END);
        } else if (b === SLIP_ESC) {
            out.push(SLIP_ESC, SLIP_ESC_ESC);
        } else {
            out.push(b);
        }
    }
    out.push(SLIP_END);
    return new Uint8Array(out);
}

function slipDecode(frameBytes) {
    const out = [];
    for (let i = 0; i < frameBytes.length; i++) {
        const b = frameBytes[i];
        if (b === SLIP_ESC && i + 1 < frameBytes.length) {
            const next = frameBytes[++i];
            if (next === SLIP_ESC_END) out.push(SLIP_END);
            else if (next === SLIP_ESC_ESC) out.push(SLIP_ESC);
        } else {
            out.push(b);
        }
    }
    return new Uint8Array(out);
}

class WebSerialDFU {
    constructor(port, options = {}) {
        this.port = port;
        this.baudRate = options.baudRate || 115200;
        this.onProgress = options.onProgress || (() => {});
        this.onLog = options.onLog || (() => {});
        this.seq = 0;
        this.rxBuffer = [];
        this.reader = null;
        this.writer = null;
    }

    _buildHciSlipPacket(payload) {
        this.seq = (this.seq + 1) % 8;
        const dip = 1; // Data Integrity Check Present
        const rp = 1;  // Reliable Packet
        const ack = 0;
        const len = payload.length;

        const b0 = (this.seq & 0x07) | ((ack & 0x07) << 3) | (dip << 6) | (rp << 7);
        const b1 = (HCI_PACKET_TYPE & 0x0F) | ((len & 0x0F) << 4);
        const b2 = (len >> 4) & 0xFF;
        const b3 = (~(b0 + b1 + b2) + 1) & 0xFF;

        const frame = new Uint8Array(4 + len + 2);
        frame[0] = b0;
        frame[1] = b1;
        frame[2] = b2;
        frame[3] = b3;
        frame.set(payload, 4);

        const crc = calcCrc16(frame.subarray(0, 4 + len));
        frame[4 + len] = crc & 0xFF;
        frame[4 + len + 1] = (crc >> 8) & 0xFF;

        return slipEncode(frame);
    }

    async _waitForAck(timeoutMs = 1000) {
        const expectedAck = (this.seq + 1) % 8;
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const firstEnd = this.rxBuffer.indexOf(SLIP_END);
            if (firstEnd !== -1) {
                const secondEnd = this.rxBuffer.indexOf(SLIP_END, firstEnd + 1);
                if (secondEnd !== -1) {
                    const rawFrame = this.rxBuffer.slice(firstEnd + 1, secondEnd);
                    this.rxBuffer.splice(0, secondEnd + 1);
                    if (rawFrame.length === 0) continue;

                    const decoded = slipDecode(rawFrame);
                    if (decoded.length >= 4) {
                        const ackNr = (decoded[0] >> 3) & 0x07;
                        if (ackNr === expectedAck) return ackNr;
                    }
                    continue;
                }
            }

            const remaining = deadline - Date.now();
            if (remaining <= 0) break;

            let timerId;
            const timeoutPromise = new Promise(resolve => {
                timerId = setTimeout(() => resolve({ timedOut: true }), remaining);
            });

            const res = await Promise.race([this.reader.read(), timeoutPromise]);
            clearTimeout(timerId);

            if (res.timedOut) break;
            if (res.done) throw new Error("Serial port closed unexpectedly during DFU.");
            if (res.value) {
                for (let i = 0; i < res.value.length; i++) this.rxBuffer.push(res.value[i]);
            }
        }
        return null;
    }

    // Matches adafruit-nrfutil: builds packet once and retransmits every 1s until ACK arrives
    async _sendReliablePacket(payload, maxAttempts = 15, ackTimeoutMs = 1000) {
        const slipPacket = this._buildHciSlipPacket(payload);
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await this.writer.write(slipPacket);
            const ack = await this._waitForAck(ackTimeoutMs);
            if (ack !== null) return ack;
        }
        throw new Error("Timed out waiting for bootloader ACK after retries.");
    }

    async flashZip(zipBuffer) {
        if (!window.JSZip) throw new Error("JSZip library not loaded.");
        const zip = await window.JSZip.loadAsync(zipBuffer);

        const manifestFile = zip.file("manifest.json");
        if (!manifestFile) throw new Error("Invalid DFU package: manifest.json missing.");
        const manifestJson = JSON.parse(await manifestFile.async("string"));
        const appEntry = manifestJson?.manifest?.application;
        if (!appEntry?.bin_file || !appEntry?.dat_file) {
            throw new Error("DFU manifest does not contain an application binary.");
        }

        const binBytes = new Uint8Array(await zip.file(appEntry.bin_file).async("arraybuffer"));
        const datBytes = new Uint8Array(await zip.file(appEntry.dat_file).async("arraybuffer"));
        this.onLog(`Unpacked ${appEntry.bin_file} (${binBytes.length} bytes) + ${appEntry.dat_file} (${datBytes.length} bytes).`);

        this.seq = 0;
        this.rxBuffer = [];

        await this.port.open({ baudRate: this.baudRate });
        await new Promise(r => setTimeout(r, 100));
        this.reader = this.port.readable.getReader();
        this.writer = this.port.writable.getWriter();

        try {
            // 1. Start Packet + Wait for nRF52840 Flash Page Erase
            const erasePages = Math.floor(binBytes.length / 4096) + 1;
            const eraseWaitMs = Math.max(600, erasePages * 95);
            this.onLog(`Sending DFU Start packet (erasing ${erasePages} flash pages, ~${(eraseWaitMs / 1000).toFixed(1)}s)...`);

            const startPayload = new Uint8Array(20);
            startPayload.set(uint32LE(DFU_START_PACKET), 0);
            startPayload.set(uint32LE(DFU_UPDATE_MODE_APP), 4);
            startPayload.set(uint32LE(0), 8);               // SoftDevice size
            startPayload.set(uint32LE(0), 12);              // Bootloader size
            startPayload.set(uint32LE(binBytes.length), 16); // Application size
            await this._sendReliablePacket(startPayload, 10, 1000);

            await new Promise(r => setTimeout(r, eraseWaitMs));

            // 2. Init Packet (.dat + required 2-byte 0x0000 padding)
            this.onLog("Sending DFU Init packet...");
            const initPayload = new Uint8Array(4 + datBytes.length + 2);
            initPayload.set(uint32LE(DFU_INIT_PACKET), 0);
            initPayload.set(datBytes, 4);
            await this._sendReliablePacket(initPayload, 15, 1000);

            // 3. Firmware Data Chunks (512 bytes each; pause 105ms every 8 chunks for 4KB page write)
            this.onLog("Writing application firmware...");
            let offset = 0;
            let packetCount = 0;
            while (offset < binBytes.length) {
                const chunk = binBytes.subarray(offset, offset + DFU_PACKET_MAX_SIZE);
                const dataPayload = new Uint8Array(4 + chunk.length);
                dataPayload.set(uint32LE(DFU_DATA_PACKET), 0);
                dataPayload.set(chunk, 4);
                await this._sendReliablePacket(dataPayload, 10, 1000);

                offset += chunk.length;
                packetCount++;
                this.onProgress(offset, binBytes.length);

                if (packetCount % 8 === 0 && offset < binBytes.length) {
                    await new Promise(r => setTimeout(r, 105));
                }
            }

            // 4. Stop & Validate CRC Packet
            this.onLog("Validating firmware checksum on device...");
            await this._sendReliablePacket(uint32LE(DFU_STOP_DATA_PACKET), 10, 1500);
        } finally {
            try { this.reader?.releaseLock(); } catch (_) {}
            try { this.writer?.releaseLock(); } catch (_) {}
            try { await this.port.close(); } catch (_) {}
        }
    }
}
window.WebSerialDFU = WebSerialDFU;
