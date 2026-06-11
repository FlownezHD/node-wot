"use strict";

const http = require("http");

const port = Number(process.env.OLD_METER_PORT || 9102);

const meter = {
    id: "meter-old-01",
    manufacturer: "Legacy Grid Instruments",
    model: "LM-100",
    serialNumber: "LM100-44291",
    energyImportKwh: 18422.73,
    energyExportKwh: 211.54,
    activePowerKw: 13.8,
    voltage: {
        l1: 230.4,
        l2: 229.9,
        l3: 231.1
    },
    updatedAt: new Date().toISOString()
};

function updateMeterState() {
    const activePowerKw = 10 + Math.random() * 7;
    const elapsedHours = 2 / 3600;

    meter.activePowerKw = round(activePowerKw, 2);
    meter.energyImportKwh = round(meter.energyImportKwh + activePowerKw * elapsedHours, 3);
    meter.voltage = {
        l1: round(229 + Math.random() * 3, 1),
        l2: round(229 + Math.random() * 3, 1),
        l3: round(229 + Math.random() * 3, 1)
    };
    meter.updatedAt = new Date().toISOString();
}

function createThingDescription(host) {
    const base = `http://${host}`;

    return {
        "@context": "https://www.w3.org/2022/wot/td/v1.1",
        title: "OldElectricityMeter01",
        id: "urn:poc:meter:old:01",
        description: "Legacy electricity meter that is reachable through the existing HTTP integration.",
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
                forms: [{ href: `${base}/api/v1/meter/reading`, contentType: "application/json" }]
            },
            activePowerKw: {
                type: "number",
                unit: "kW",
                readOnly: true,
                forms: [{ href: `${base}/api/v1/meter/power`, contentType: "application/json" }]
            },
            voltage: {
                type: "object",
                readOnly: true,
                forms: [{ href: `${base}/api/v1/meter/voltage`, contentType: "application/json" }]
            }
        }
    };
}

function handleRequest(req, res) {
    updateMeterState();

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/.well-known/wot-thing-description") {
        sendJson(res, 200, createThingDescription(req.headers.host));
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/meter/reading") {
        sendJson(res, 200, {
            id: meter.id,
            serialNumber: meter.serialNumber,
            energyImportKwh: meter.energyImportKwh,
            energyExportKwh: meter.energyExportKwh,
            updatedAt: meter.updatedAt
        });
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/meter/power") {
        sendJson(res, 200, meter.activePowerKw);
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/meter/voltage") {
        sendJson(res, 200, meter.voltage);
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/status") {
        sendJson(res, 200, meter);
        return;
    }

    sendJson(res, 404, { error: "Not found." });
}

function sendJson(res, statusCode, value) {
    const body = JSON.stringify(value, null, 2);

    res.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body)
    });
    res.end(body);
}

function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

const server = http.createServer(handleRequest);

server.listen(port, () => {
    console.log(`Old meter HTTP API listening on http://localhost:${port}`);
});

process.on("SIGINT", () => {
    server.close(() => process.exit(0));
});
