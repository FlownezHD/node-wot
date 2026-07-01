"use strict";

const path = require("path");

const coap = loadCoapModule();

const port = Number(process.env.BATTERY_COAP_PORT || 5686);
const bindAddress = process.env.BATTERY_BIND_ADDRESS || "127.0.0.1";
const publicHost = process.env.BATTERY_HOST || "localhost";

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

function loadCoapModule() {
    const candidates = [
        "coap",
        path.resolve(__dirname, "..", "..", "packages", "binding-coap", "node_modules", "coap")
    ];

    let lastError;

    for (const candidate of candidates) {
        try {
            return require(candidate);
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(`Unable to load coap module. Last error: ${lastError.message}`);
}

function updateBatteryState() {
    const direction = Math.random() > 0.45 ? -1 : 1;
    const delta = Math.random() * 0.18 * direction;

    battery.stateOfCharge = clamp(round(battery.stateOfCharge + delta, 2), 5, 98);
    battery.powerKw = round(-10 + Math.random() * 5, 2);
    battery.temperatureCelsius = round(27 + Math.random() * 3, 1);
    battery.updatedAt = new Date().toISOString();
}

function createThingDescription() {
    const base = `coap://${publicHost}:${port}`;

    return {
        "@context": "https://www.w3.org/2022/wot/td/v1.1",
        title: "BatteryStorage01",
        id: "urn:poc:battery-storage:01",
        description: "Battery storage exposed as a standard WoT Thing over CoAP.",
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
                forms: [{ href: `${base}/properties/stateOfCharge`, contentType: "application/json", op: ["readproperty"] }]
            },
            powerKw: {
                type: "number",
                unit: "kW",
                readOnly: true,
                forms: [{ href: `${base}/properties/powerKw`, contentType: "application/json", op: ["readproperty"] }]
            },
            mode: {
                type: "string",
                readOnly: true,
                forms: [{ href: `${base}/properties/mode`, contentType: "application/json", op: ["readproperty"] }]
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
                forms: [{ href: `${base}/actions/setMode`, contentType: "application/json", op: ["invokeaction"] }]
            }
        }
    };
}

const server = coap.createServer();

server.on("request", (req, res) => {
    updateBatteryState();

    const url = new URL(req.url, "coap://localhost");

    if (req.method === "GET" && url.pathname === "/.well-known/wot-thing-description") {
        sendJson(res, "2.05", createThingDescription(), "application/td+json");
        return;
    }

    if (req.method === "GET" && url.pathname === "/status") {
        sendJson(res, "2.05", battery);
        return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/properties/")) {
        const propertyName = url.pathname.split("/").pop();

        if (Object.prototype.hasOwnProperty.call(battery, propertyName)) {
            sendJson(res, "2.05", battery[propertyName]);
            return;
        }

        sendJson(res, "4.04", { error: `Unknown battery property '${propertyName}'.` });
        return;
    }

    if (req.method === "POST" && url.pathname === "/actions/setMode") {
        readJsonBody(req)
            .then((body) => {
                const allowedModes = new Set(["idle", "charge", "discharge", "grid-support"]);

                if (!allowedModes.has(body.mode)) {
                    sendJson(res, "4.00", { error: "mode must be idle, charge, discharge, or grid-support." });
                    return;
                }

                battery.mode = body.mode;
                battery.updatedAt = new Date().toISOString();
                sendJson(res, "2.05", { ok: true, mode: battery.mode });
            })
            .catch((error) => sendJson(res, "4.00", { error: error.message }));
        return;
    }

    sendJson(res, "4.04", { error: "Not found." });
});

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

function sendJson(res, code, value, contentFormat = "application/json") {
    res.code = code;
    res.setOption("Content-Format", contentFormat);
    res.end(JSON.stringify(value, null, 2));
}

function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

server.listen(port, bindAddress, () => {
    console.log(`Battery storage CoAP WoT Thing listening on coap://localhost:${port}`);
    console.log(`Thing Description: coap://localhost:${port}/.well-known/wot-thing-description`);
});

process.on("SIGINT", () => {
    server.close(() => process.exit(0));
});
