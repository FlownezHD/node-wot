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

type BatteryMode = "idle" | "charge" | "discharge" | "grid-support";

type BatteryStorage = {
    id: string;
    manufacturer: string;
    model: string;
    stateOfCharge: number;
    powerKw: number;
    capacityKwh: number;
    mode: BatteryMode;
    temperatureCelsius: number;
    updatedAt: string;
};

type SetModeInput = {
    mode?: BatteryMode;
};

const coap = loadCoapModule();

const port = Number(process.env.BATTERY_COAP_PORT || 5686);
const bindAddress = process.env.BATTERY_BIND_ADDRESS || "127.0.0.1";
const publicHost = process.env.BATTERY_HOST || "localhost";

const battery: BatteryStorage = {
    id: "battery-storage-01",
    manufacturer: "OpenEMS Demo Systems",
    model: "BS-50K",
    stateOfCharge: 72.4,
    powerKw: -8.7,
    capacityKwh: 50,
    mode: "grid-support",
    temperatureCelsius: 28.1,
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

function updateBatteryState(): void {
    const direction = Math.random() > 0.45 ? -1 : 1;
    const delta = Math.random() * 0.18 * direction;

    battery.stateOfCharge = clamp(round(battery.stateOfCharge + delta, 2), 5, 98);
    battery.powerKw = round(-10 + Math.random() * 5, 2);
    battery.temperatureCelsius = round(27 + Math.random() * 3, 1);
    battery.updatedAt = new Date().toISOString();
}

function createThingDescription(): Record<string, unknown> {
    const base = `coap://${publicHost}:${port}`;

    return {
        "@context": "https://www.w3.org/2022/wot/td/v1.1",
        title: "BatteryStorage01",
        id: "urn:poc:battery-storage:01",
        description: "Battery storage exposed as a standard WoT Thing over CoAP.",
        securityDefinitions: {
            nosec_sc: {
                scheme: "nosec",
            },
        },
        security: ["nosec_sc"],
        properties: {
            stateOfCharge: {
                type: "number",
                unit: "percent",
                readOnly: true,
                forms: [{ href: `${base}/properties/stateOfCharge`, contentType: "application/json", op: ["readproperty"] }],
            },
            powerKw: {
                type: "number",
                unit: "kW",
                readOnly: true,
                forms: [{ href: `${base}/properties/powerKw`, contentType: "application/json", op: ["readproperty"] }],
            },
            mode: {
                type: "string",
                readOnly: true,
                forms: [{ href: `${base}/properties/mode`, contentType: "application/json", op: ["readproperty"] }],
            },
        },
        actions: {
            setMode: {
                input: {
                    type: "object",
                    properties: {
                        mode: { type: "string", enum: ["idle", "charge", "discharge", "grid-support"] },
                    },
                    required: ["mode"],
                },
                forms: [{ href: `${base}/actions/setMode`, contentType: "application/json", op: ["invokeaction"] }],
            },
        },
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

        if (propertyName != null && Object.prototype.hasOwnProperty.call(battery, propertyName)) {
            sendJson(res, "2.05", (battery as Record<string, unknown>)[propertyName]);
            return;
        }

        sendJson(res, "4.04", { error: `Unknown battery property '${propertyName}'.` });
        return;
    }

    if (req.method === "POST" && url.pathname === "/actions/setMode") {
        readJsonBody<SetModeInput>(req)
            .then((body) => {
                const allowedModes = new Set<BatteryMode>(["idle", "charge", "discharge", "grid-support"]);

                if (body.mode == null || !allowedModes.has(body.mode)) {
                    sendJson(res, "4.00", { error: "mode must be idle, charge, discharge, or grid-support." });
                    return;
                }

                battery.mode = body.mode;
                battery.updatedAt = new Date().toISOString();
                sendJson(res, "2.05", { ok: true, mode: battery.mode });
            })
            .catch((error: unknown) => sendJson(res, "4.00", { error: error instanceof Error ? error.message : "Invalid request." }));
        return;
    }

    sendJson(res, "4.04", { error: "Not found." });
});

function readJsonBody<T>(req: Readable): Promise<T> {
    return new Promise((resolve, reject) => {
        let data = "";

        req.on("data", (chunk: Buffer | string) => {
            data += chunk.toString();
        });
        req.on("end", () => {
            try {
                resolve((data.length === 0 ? {} : JSON.parse(data)) as T);
            } catch {
                reject(new Error("Invalid JSON request body."));
            }
        });
        req.on("error", reject);
    });
}

function sendJson(res: CoapResponse, code: string, value: unknown, contentFormat = "application/json"): void {
    res.code = code;
    res.setOption("Content-Format", contentFormat);
    res.end(JSON.stringify(value, null, 2));
}

function round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

server.listen(port, bindAddress, () => {
    console.log(`Battery storage CoAP WoT Thing listening on coap://localhost:${port}`);
    console.log(`Thing Description: coap://localhost:${port}/.well-known/wot-thing-description`);
});

process.on("SIGINT", () => {
    server.close(() => process.exit(0));
});
