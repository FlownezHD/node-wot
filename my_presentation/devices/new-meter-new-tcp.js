"use strict";

const net = require("net");

const port = Number(process.env.NEW_METER_NEW_PORT || 9103);
const bindAddress = process.env.NEW_METER_BIND_ADDRESS || "127.0.0.1";
const publicHost = process.env.NEW_METER_HOST || "localhost";
const thingPath = "new-electricity-meter-01";

const meter = {
    id: "meter-new-01",
    manufacturer: "NextGrid Metering",
    model: "PM-2000",
    serialNumber: "PM2000-77412",
    energyImportKwh: 18422.841,
    energyExportKwh: 211.54,
    activePowerKw: 12.84,
    frequencyHz: 49.99,
    updatedAt: new Date().toISOString()
};

function updateMeterState() {
    const activePowerKw = round(9 + Math.random() * 7, 2);
    const elapsedHours = 2 / 3600;

    meter.activePowerKw = activePowerKw;
    meter.energyImportKwh = round(meter.energyImportKwh + activePowerKw * elapsedHours, 3);
    meter.frequencyHz = round(49.95 + Math.random() * 0.12, 3);
    meter.updatedAt = new Date().toISOString();
}

function createThingDescription() {
    const base = `new://${publicHost}:${port}/${thingPath}`;

    return {
        "@context": "https://www.w3.org/2022/wot/td/v1.1",
        title: "NewElectricityMeter01",
        id: "urn:poc:meter:new:01",
        description: "Replacement electricity meter exposed through the custom raw TCP new-binding protocol.",
        securityDefinitions: {
            nosec_sc: {
                scheme: "nosec"
            }
        },
        security: ["nosec_sc"],
        properties: {
            reading: {
                type: "object",
                readOnly: true,
                forms: [{ href: `${base}/properties/reading`, contentType: "application/json", op: ["readproperty"] }]
            },
            activePowerKw: {
                type: "number",
                unit: "kW",
                readOnly: true,
                forms: [{ href: `${base}/properties/activePowerKw`, contentType: "application/json", op: ["readproperty"] }]
            },
            frequencyHz: {
                type: "number",
                unit: "Hz",
                readOnly: true,
                forms: [{ href: `${base}/properties/frequencyHz`, contentType: "application/json", op: ["readproperty"] }]
            }
        }
    };
}

const server = net.createServer((socket) => {
    void handleSocket(socket);
});

async function handleSocket(socket) {
    try {
        updateMeterState();

        const request = await readJsonLine(socket);
        const response = handleMessage(request);
        socket.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
        socket.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unknown error" })}\n`);
    } finally {
        socket.end();
    }
}

function handleMessage(request) {
    if (request.path !== thingPath) {
        return { ok: false, error: "Thing not found." };
    }

    if (request.op === "readThingDescription") {
        return toWire(createThingDescription(), "application/td+json");
    }

    if (request.op === "readProperty") {
        if (request.name === "reading") {
            return toWire({
                id: meter.id,
                serialNumber: meter.serialNumber,
                energyImportKwh: meter.energyImportKwh,
                energyExportKwh: meter.energyExportKwh,
                updatedAt: meter.updatedAt
            });
        }

        if (request.name === "activePowerKw") {
            return toWire(meter.activePowerKw);
        }

        if (request.name === "frequencyHz") {
            return toWire(meter.frequencyHz);
        }

        return { ok: false, error: `Unknown meter property '${request.name}'.` };
    }

    return { ok: false, error: `Unsupported operation '${request.op}'.` };
}

function readJsonLine(socket) {
    return new Promise((resolve, reject) => {
        let buffer = "";
        let completed = false;

        function finish(line) {
            if (completed) {
                return;
            }

            completed = true;

            try {
                resolve(JSON.parse(line));
            } catch (error) {
                reject(error);
            }
        }

        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
            buffer += chunk;
            const newlineIndex = buffer.indexOf("\n");

            if (newlineIndex === -1) {
                return;
            }

            finish(buffer.slice(0, newlineIndex));
        });
        socket.on("error", reject);
        socket.on("end", () => {
            if (buffer.length > 0) {
                finish(buffer);
            }
        });
    });
}

function toWire(value, contentType = "application/json") {
    return {
        ok: true,
        contentType,
        body: Buffer.from(JSON.stringify(value)).toString("base64")
    };
}

function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

server.listen(port, bindAddress, () => {
    console.log(`New meter raw TCP WoT Thing listening on new://localhost:${port}/${thingPath}`);
});

process.on("SIGINT", () => {
    server.close(() => process.exit(0));
});
