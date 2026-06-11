"use strict";

const http = require("http");

const port = Number(process.env.BATTERY_PORT || 9101);

const battery = {
    id: "battery-storage-01",
    manufacturer: "OpenEMS Demo Systems",
    model: "BS-50K",
    stateOfCharge: 72.4,
    powerKw: -8.7,
    capacityKwh: 50,
    mode: "grid-support",
    temperatureCelsius: 28.1,
    updatedAt: new Date().toISOString()
};

function updateBatteryState() {
    const direction = Math.random() > 0.45 ? -1 : 1;
    const delta = Math.random() * 0.18 * direction;

    battery.stateOfCharge = clamp(round(battery.stateOfCharge + delta, 2), 5, 98);
    battery.powerKw = round(-10 + Math.random() * 5, 2);
    battery.temperatureCelsius = round(27 + Math.random() * 3, 1);
    battery.updatedAt = new Date().toISOString();
}

function createThingDescription(host) {
    const base = `http://${host}`;

    return {
        "@context": "https://www.w3.org/2022/wot/td/v1.1",
        title: "BatteryStorage01",
        id: "urn:poc:battery-storage:01",
        description: "Battery storage that is already reachable through an existing HTTP API.",
        securityDefinitions: {
            nosec_sc: {
                scheme: "nosec"
            }
        },
        security: ["nosec_sc"],
        properties: {
            stateOfCharge: {
                type: "number",
                unit: "percent",
                readOnly: true,
                forms: [{ href: `${base}/api/v1/properties/stateOfCharge`, contentType: "application/json" }]
            },
            powerKw: {
                type: "number",
                unit: "kW",
                readOnly: true,
                forms: [{ href: `${base}/api/v1/properties/powerKw`, contentType: "application/json" }]
            },
            mode: {
                type: "string",
                readOnly: true,
                forms: [{ href: `${base}/api/v1/properties/mode`, contentType: "application/json" }]
            }
        },
        actions: {
            setMode: {
                input: {
                    type: "object",
                    properties: {
                        mode: { type: "string", enum: ["idle", "charge", "discharge", "grid-support"] }
                    },
                    required: ["mode"]
                },
                forms: [{ href: `${base}/api/v1/actions/setMode`, contentType: "application/json" }]
            }
        }
    };
}

function handleRequest(req, res) {
    updateBatteryState();

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/.well-known/wot-thing-description") {
        sendJson(res, 200, createThingDescription(req.headers.host));
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/status") {
        sendJson(res, 200, battery);
        return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/v1/properties/")) {
        const propertyName = url.pathname.split("/").pop();

        if (Object.prototype.hasOwnProperty.call(battery, propertyName)) {
            sendJson(res, 200, battery[propertyName]);
            return;
        }

        sendJson(res, 404, { error: `Unknown battery property '${propertyName}'.` });
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/actions/setMode") {
        readJsonBody(req)
            .then((body) => {
                const allowedModes = new Set(["idle", "charge", "discharge", "grid-support"]);

                if (!allowedModes.has(body.mode)) {
                    sendJson(res, 400, { error: "mode must be idle, charge, discharge, or grid-support." });
                    return;
                }

                battery.mode = body.mode;
                battery.updatedAt = new Date().toISOString();
                sendJson(res, 200, { ok: true, mode: battery.mode });
            })
            .catch((error) => sendJson(res, 400, { error: error.message }));
        return;
    }

    sendJson(res, 404, { error: "Not found." });
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";

        req.on("data", (chunk) => {
            data += chunk;
        });
        req.on("end", () => {
            try {
                resolve(data.length === 0 ? {} : JSON.parse(data));
            } catch (error) {
                reject(new Error("Invalid JSON request body."));
            }
        });
        req.on("error", reject);
    });
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

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

const server = http.createServer(handleRequest);

server.listen(port, () => {
    console.log(`Battery storage HTTP API listening on http://localhost:${port}`);
});

process.on("SIGINT", () => {
    server.close(() => process.exit(0));
});
