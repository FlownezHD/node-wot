"use strict";

const path = require("path");

const coap = loadCoapModule();

const port = Number(process.env.NEW_METER_COAP_PORT || 5685);
const vendorToken = process.env.NEW_METER_TOKEN || "demo-token";

const meter = {
    id: "meter-new-01",
    manufacturer: "NextGrid Metering",
    model: "PM-2000",
    serialNumber: "PM2000-77412",
    energyImportWh: 18422841,
    energyExportWh: 211540,
    activePowerW: 12840,
    frequencyMilliHz: 49990,
    updatedAt: Date.now()
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

function updateMeterState() {
    const activePowerW = 9000 + Math.floor(Math.random() * 7000);
    const elapsedSeconds = 2;

    meter.activePowerW = activePowerW;
    meter.energyImportWh += Math.round((activePowerW * elapsedSeconds) / 3600);
    meter.frequencyMilliHz = 49950 + Math.floor(Math.random() * 120);
    meter.updatedAt = Date.now();
}

function createTelemetryFrame() {
    return [
        "PM2K",
        `id=${meter.id}`,
        `sn=${meter.serialNumber}`,
        `impWh=${meter.energyImportWh}`,
        `expWh=${meter.energyExportWh}`,
        `pW=${meter.activePowerW}`,
        `fMhz=${meter.frequencyMilliHz}`,
        `ts=${meter.updatedAt}`
    ].join(";");
}

function createMetadataFrame() {
    return [
        "PM2K-META",
        `manufacturer=${meter.manufacturer}`,
        `model=${meter.model}`,
        `serial=${meter.serialNumber}`,
        "protocol=proprietary-coap",
        "payload=semicolon-key-value-frame",
        "auth=query-token"
    ].join(";");
}

function isAuthorized(req) {
    const url = new URL(req.url, "coap://localhost");
    const token = url.searchParams.get("token");

    return token == null || token === vendorToken;
}

const server = coap.createServer();

server.on("request", (req, res) => {
    updateMeterState();

    const url = new URL(req.url, "coap://localhost");

    if (!isAuthorized(req)) {
        res.code = "4.01";
        res.end("PM2K-ERR;code=unauthorized");
        return;
    }

    if (req.method === "GET" && url.pathname === "/vendor/pm-2000/telemetry") {
        res.setOption("Content-Format", "text/plain");
        res.end(createTelemetryFrame());
        return;
    }

    if (req.method === "GET" && url.pathname === "/vendor/pm-2000/meta") {
        res.setOption("Content-Format", "text/plain");
        res.end(createMetadataFrame());
        return;
    }

    res.code = "4.04";
    res.end("PM2K-ERR;code=not_found");
});

server.listen(port, () => {
    console.log(`New proprietary CoAP meter listening on coap://localhost:${port}`);
    console.log(`Telemetry path: coap://localhost:${port}/vendor/pm-2000/telemetry`);
});

process.on("SIGINT", () => {
    server.close(() => process.exit(0));
});
