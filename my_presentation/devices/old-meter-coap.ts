import { createRequire } from "module";
import path from "path";
import { Readable } from "stream";

const requireModule = createRequire(__filename);

type CoapRequest = Readable & {
    method: string;
    url: string;
};

type CoapResponse = {
    code: string;
    setOption(name: string, value: string): void;
    end(body: string): void;
};

type CoapServer = {
    on(event: "request", handler: (req: CoapRequest, res: CoapResponse) => void): void;
    listen(port: number, address: string, callback: () => void): void;
    close(callback: () => void): void;
};

type CoapModule = {
    createServer(): CoapServer;
};

type VoltageReading = {
    l1: number;
    l2: number;
    l3: number;
};

type OldMeter = {
    id: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
    energyImportKwh: number;
    energyExportKwh: number;
    activePowerKw: number;
    voltage: VoltageReading;
    updatedAt: string;
};

const coap = loadCoapModule();

const port = Number(process.env.OLD_METER_COAP_PORT || 5687);
const bindAddress = process.env.OLD_METER_BIND_ADDRESS || "127.0.0.1";
const publicHost = process.env.OLD_METER_HOST || "localhost";

const meter: OldMeter = {
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
        l3: 231.1,
    },
    updatedAt: new Date().toISOString(),
};

function loadCoapModule(): CoapModule {
    const candidates = [
        "coap",
        path.resolve(__dirname, "..", "..", "packages", "binding-coap", "node_modules", "coap"),
    ];

    let lastError: unknown;

    for (const candidate of candidates) {
        try {
            return requireModule(candidate) as CoapModule;
        } catch (error) {
            lastError = error;
        }
    }

    const message = lastError instanceof Error ? lastError.message : "unknown error";
    throw new Error(`Unable to load coap module. Last error: ${message}`);
}

function updateMeterState(): void {
    const activePowerKw = 10 + Math.random() * 7;
    const elapsedHours = 2 / 3600;

    meter.activePowerKw = round(activePowerKw, 2);
    meter.energyImportKwh = round(meter.energyImportKwh + activePowerKw * elapsedHours, 3);
    meter.voltage = {
        l1: round(229 + Math.random() * 3, 1),
        l2: round(229 + Math.random() * 3, 1),
        l3: round(229 + Math.random() * 3, 1),
    };
    meter.updatedAt = new Date().toISOString();
}

function createThingDescription(): Record<string, unknown> {
    const base = `coap://${publicHost}:${port}`;

    return {
        "@context": "https://www.w3.org/2022/wot/td/v1.1",
        title: "OldElectricityMeter01",
        id: "urn:poc:meter:old:01",
        description: "Legacy electricity meter exposed as a standard WoT Thing over CoAP.",
        securityDefinitions: {
            nosec_sc: {
                scheme: "nosec",
            },
        },
        security: ["nosec_sc"],
        properties: {
            reading: {
                type: "object",
                readOnly: true,
                forms: [{ href: `${base}/properties/reading`, contentType: "application/json", op: ["readproperty"] }],
            },
            activePowerKw: {
                type: "number",
                unit: "kW",
                readOnly: true,
                forms: [{ href: `${base}/properties/activePowerKw`, contentType: "application/json", op: ["readproperty"] }],
            },
            voltage: {
                type: "object",
                readOnly: true,
                forms: [{ href: `${base}/properties/voltage`, contentType: "application/json", op: ["readproperty"] }],
            },
        },
    };
}

const server = coap.createServer();

server.on("request", (req, res) => {
    updateMeterState();

    const url = new URL(req.url, "coap://localhost");

    if (req.method === "GET" && url.pathname === "/.well-known/wot-thing-description") {
        sendJson(res, "2.05", createThingDescription(), "application/td+json");
        return;
    }

    if (req.method === "GET" && url.pathname === "/properties/reading") {
        sendJson(res, "2.05", {
            id: meter.id,
            serialNumber: meter.serialNumber,
            energyImportKwh: meter.energyImportKwh,
            energyExportKwh: meter.energyExportKwh,
            updatedAt: meter.updatedAt,
        });
        return;
    }

    if (req.method === "GET" && url.pathname === "/properties/activePowerKw") {
        sendJson(res, "2.05", meter.activePowerKw);
        return;
    }

    if (req.method === "GET" && url.pathname === "/properties/voltage") {
        sendJson(res, "2.05", meter.voltage);
        return;
    }

    if (req.method === "GET" && url.pathname === "/status") {
        sendJson(res, "2.05", meter);
        return;
    }

    sendJson(res, "4.04", { error: "Not found." });
});

function sendJson(res: CoapResponse, code: string, value: unknown, contentFormat = "application/json"): void {
    res.code = code;
    res.setOption("Content-Format", contentFormat);
    res.end(JSON.stringify(value, null, 2));
}

function round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

server.listen(port, bindAddress, () => {
    console.log(`Old meter CoAP WoT Thing listening on coap://localhost:${port}`);
    console.log(`Thing Description: coap://localhost:${port}/.well-known/wot-thing-description`);
});

process.on("SIGINT", () => {
    server.close(() => process.exit(0));
});
