import http from "http";
import net from "net";
import { readFile } from "fs/promises";
import path from "path";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type CheckResult = {
    active: boolean;
    label: string;
    message: string;
    details?: JsonValue;
};

type DeviceReadResult = {
    result?: boolean;
    title?: string;
    propertyName?: string;
    value?: JsonValue;
    message?: string;
};

type BindingLifecycleState = "not deployed" | "stored" | "active";

type BindingState = {
    id: string;
    state: Exclude<BindingLifecycleState, "not deployed">;
};

type BindingDeploymentStatus = CheckResult & {
    state: BindingLifecycleState;
};

type ProtocolInfo = {
    scheme: string;
    source: string;
    role: string;
    active: boolean;
};

const port = Number(process.env.VISUALIZER_PORT || 9200);
const runtimeBaseUrl = process.env.RUNTIME_HTTP || "http://localhost:8080";
const newMeterTdUri = process.env.NEW_METER_TD ?? "new://localhost:9103/new-electricity-meter-01";
const htmlPath = path.resolve(__dirname, "visualizer.html");
const newTcpBindingPath = path.resolve(__dirname, "../../my_bindings/new-tcp-binding");

const server = http.createServer((req, res) => {
    void handleRequest(req, res);
});

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") {
        await sendHtml(res, req.method === "HEAD");
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
        await sendJson(res, 200, await collectStatus());
        return;
    }

    const bindingAction = getBindingAction(url.pathname);

    if (req.method === "POST" && bindingAction != null) {
        const result = await executeBindingAction(bindingAction);
        await sendJson(res, result.ok ? 200 : 502, result.ok ? result.value : { result: false, message: result.error });
        return;
    }

    await sendJson(res, 404, { error: "Not found." });
}

async function sendHtml(res: http.ServerResponse, headOnly = false): Promise<void> {
    const html = await readFile(htmlPath, "utf8");

    res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(html),
    });
    res.end(headOnly ? undefined : html);
}

async function collectStatus(): Promise<Record<string, JsonValue>> {
    const runtimeStatus = await checkGet("/runtime/properties/status", "Runtime", "Management runtime HTTP endpoint");
    const appStatus = await checkGet("/energydemoapplication", "EnergyDemoApplication", "Presentation application Thing");
    const bindingStates = await getBindingStates();
    const protocols = await getSupportedProtocols();
    const newTcpBindingState = bindingStates.find((binding) => binding.id === "new-tcp-binding")?.state ?? "not deployed";
    const newTcpBindingActive = newTcpBindingState === "active";
    const newTcpBindingStatus = getNewTcpBindingStatus(newTcpBindingState);
    const coapProtocols = protocols.filter((protocol) => protocol.scheme === "coap");
    const coapSupported = coapProtocols.length > 0;

    const batteryRead = await readDevice("/energydemoapplication/actions/readBattery", "Battery Storage", "CoAP/UDP via EnergyDemoApplication");
    const oldMeterRead = await readDevice("/energydemoapplication/actions/readOldMeter", "Old Meter", "CoAP/UDP via EnergyDemoApplication");
    const newMeterRead = await readDevice("/energydemoapplication/actions/readNewMeter", "New Meter", "new:// over TCP via EnergyDemoApplication");
    const newMeterStatus = await checkNewMeterPowerState(newMeterRead);
    const newMeterBlockedByMissingBinding =
        runtimeStatus.active &&
        appStatus.active &&
        newMeterStatus.active &&
        !newMeterRead.active &&
        !newTcpBindingActive &&
        isMissingBindingMessage(newMeterRead.message);

    return {
        checkedAt: new Date().toISOString(),
        runtimeBaseUrl,
        nodes: {
            runtime: runtimeStatus,
            energyDemo: appStatus,
            coapSupport: {
                active: coapSupported,
                label: "CoAP / UDP",
                message: coapSupported ? "Native node-wot CoAP/UDP support" : "Not reported by runtimeCapabilities",
                details: coapProtocols as unknown as JsonValue,
            },
            newTcpBinding: {
                ...newTcpBindingStatus,
                details: {
                    senderPackage: "my_bindings/new-tcp-binding",
                    runtimeStorage: "my_runtime/deployed-bindings/new-tcp-binding",
                    compatibility: newTcpBindingStatus.details ?? null,
                },
            },
            battery: batteryRead,
            oldMeter: oldMeterRead,
            newMeter: newMeterStatus,
        },
        links: {
            runtimeToEnergyDemo: {
                active: runtimeStatus.active && appStatus.active,
                protocol: "shared Servient",
            },
            energyDemoToBattery: {
                active: batteryRead.active,
                protocol: "CoAP / UDP",
            },
            energyDemoToOldMeter: {
                active: oldMeterRead.active,
                protocol: "CoAP / UDP",
            },
            energyDemoToNewMeter: {
                active: newMeterRead.active,
                protocol: "new:// / TCP",
                blockedByMissingBinding: newMeterBlockedByMissingBinding,
            },
            runtimeToNewTcpBinding: {
                active: newTcpBindingActive,
                protocol: "dynamic binding loading",
            },
            runtimeToCoapSupport: {
                active: coapSupported,
                protocol: "native CoAP / UDP",
            },
        },
        protocols: protocols as unknown as JsonValue,
        bindingDeployment: {
            state: newTcpBindingStatus.state,
            senderPackage: "my_bindings/new-tcp-binding",
        },
    };
}

function getBindingAction(pathname: string): "deploy" | "load" | "remove" | "delete" | undefined {
    const match = /^\/api\/bindings\/new-tcp-binding\/(deploy|load|remove|delete)$/.exec(pathname);
    return match?.[1] as "deploy" | "load" | "remove" | "delete" | undefined;
}

async function executeBindingAction(
    actionName: "deploy" | "load" | "remove" | "delete"
): Promise<{ ok: true; value: JsonValue } | { ok: false; error: string }> {
    if (actionName === "deploy") {
        try {
            const [manifestText, source] = await Promise.all([
                readFile(path.join(newTcpBindingPath, "manifest.json"), "utf8"),
                readFile(path.join(newTcpBindingPath, "index.js"), "utf8"),
            ]);
            const manifest = JSON.parse(manifestText) as JsonValue;

            return requestJson("POST", "/runtime/actions/deployBinding", { manifest, source });
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : "Failed to create the new-tcp-binding deployment payload.",
            };
        }
    }

    const runtimeAction = {
        load: "addBinding",
        remove: "removeBinding",
        delete: "deleteBinding",
    }[actionName];

    return requestJson("POST", `/runtime/actions/${runtimeAction}`, { id: "new-tcp-binding" });
}

function getNewTcpBindingStatus(state: BindingLifecycleState): BindingDeploymentStatus {
    if (state === "active") {
        return {
            active: true,
            state: "active",
            label: "new-tcp-binding",
            message: "Active in the shared Servient",
        };
    }

    return {
        active: false,
        state,
        label: "new-tcp-binding",
        message: state === "stored" ? "Stored in runtime storage" : "Not deployed",
    };
}

async function checkNewMeterPowerState(readResult: CheckResult): Promise<CheckResult> {
    const endpoint = parseTcpEndpoint(newMeterTdUri);

    if (endpoint == null) {
        return {
            active: false,
            label: "New Meter",
            message: `Invalid NEW_METER_TD: ${newMeterTdUri}`,
            details: readResult.details,
        };
    }

    const reachable = await isTcpReachable(endpoint.host, endpoint.port);

    if (!reachable) {
        return {
            active: false,
            label: "New Meter",
            message: `Device is off (${endpoint.host}:${endpoint.port} is not reachable)`,
            details: readResult.details,
        };
    }

    return {
        active: true,
        label: "New Meter",
        message: readResult.active ? "TCP simulator is reachable and readable" : "TCP simulator is reachable",
        details: readResult.details,
    };
}

function parseTcpEndpoint(uri: string): { host: string; port: number } | undefined {
    try {
        const url = new URL(uri);
        return {
            host: url.hostname || "localhost",
            port: Number(url.port || 9103),
        };
    } catch {
        return undefined;
    }
}

function isTcpReachable(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port });

        socket.setTimeout(500);
        socket.once("connect", () => {
            socket.write("{}\n");
            socket.end();
            resolve(true);
        });
        socket.once("timeout", () => {
            socket.destroy();
            resolve(false);
        });
        socket.once("error", () => {
            resolve(false);
        });
    });
}

function isMissingBindingMessage(message: string): boolean {
    return /no ClientFactory|missing .*binding|binding .*missing/i.test(message);
}

async function checkGet(pathname: string, label: string, description: string): Promise<CheckResult> {
    const result = await requestJson("GET", pathname);

    if (result.ok) {
        return {
            active: true,
            label,
            message: description,
            details: result.value,
        };
    }

    return {
        active: false,
        label,
        message: result.error,
    };
}

async function getBindingStates(): Promise<BindingState[]> {
    const result = await requestJson("GET", "/runtime/properties/bindingStates");

    if (!result.ok || !Array.isArray(result.value)) {
        return [];
    }

    return result.value.filter((entry): entry is BindingState => {
        if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
            return false;
        }

        const candidate = entry as { id?: unknown; state?: unknown };
        return (
            typeof candidate.id === "string" &&
            (candidate.state === "stored" || candidate.state === "active")
        );
    });
}

async function getSupportedProtocols(): Promise<ProtocolInfo[]> {
    const result = await requestJson("GET", "/runtime/properties/runtimeCapabilities");

    if (!result.ok || result.value == null || typeof result.value !== "object" || Array.isArray(result.value)) {
        return [];
    }

    const supportedBindings = (result.value as { supportedBindings?: unknown }).supportedBindings;

    if (supportedBindings == null || typeof supportedBindings !== "object" || Array.isArray(supportedBindings)) {
        return [];
    }

    const protocols: ProtocolInfo[] = [];
    const groups = supportedBindings as {
        activeNative?: {
            clients?: unknown;
            servers?: unknown;
        };
        loaded?: {
            clients?: unknown;
            servers?: unknown;
        };
    };

    addProtocolEntries(protocols, groups.activeNative?.clients, "native", "client");
    addProtocolEntries(protocols, groups.activeNative?.servers, "native", "server");
    addProtocolEntries(protocols, groups.loaded?.clients, "dynamic", "client");
    addProtocolEntries(protocols, groups.loaded?.servers, "dynamic", "server");

    return mergeProtocolEntries(protocols);
}

function addProtocolEntries(protocols: ProtocolInfo[], entries: unknown, source: string, role: string): void {
    if (!Array.isArray(entries)) {
        return;
    }

    entries.forEach((entry) => {
        if (entry == null || typeof entry !== "object") {
            return;
        }

        const scheme = (entry as { scheme?: unknown }).scheme;

        if (typeof scheme !== "string" || scheme.length === 0) {
            return;
        }

        protocols.push({
            scheme,
            source,
            role,
            active: true,
        });
    });
}

function mergeProtocolEntries(entries: ProtocolInfo[]): ProtocolInfo[] {
    const byKey = new Map<string, ProtocolInfo>();

    entries.forEach((entry) => {
        const key = `${entry.scheme}:${entry.source}`;
        const existing = byKey.get(key);

        if (existing == null) {
            byKey.set(key, { ...entry });
            return;
        }

        const roles = new Set(existing.role.split(", "));
        roles.add(entry.role);
        existing.role = [...roles].sort().join(", ");
    });

    return [...byKey.values()].sort((left, right) => {
        if (left.source !== right.source) {
            return left.source.localeCompare(right.source);
        }

        return left.scheme.localeCompare(right.scheme);
    });
}

async function readDevice(pathname: string, label: string, description: string): Promise<CheckResult> {
    const result = await requestJson("POST", pathname);

    if (!result.ok) {
        return {
            active: false,
            label,
            message: result.error,
        };
    }

    const body = result.value as DeviceReadResult;

    if (body.result === true) {
        return {
            active: true,
            label,
            message: description,
            details: body.value,
        };
    }

    return {
        active: false,
        label,
        message: body.message || "Device could not be read through the presentation application.",
        details: body as unknown as JsonValue,
    };
}

async function requestJson(
    method: "GET" | "POST",
    pathname: string,
    payload?: JsonValue
): Promise<{ ok: true; value: JsonValue } | { ok: false; error: string }> {
    const target = new URL(pathname, runtimeBaseUrl);
    const requestBody = payload == null ? "" : JSON.stringify(payload);

    return new Promise((resolve) => {
        const req = http.request(
            {
                hostname: target.hostname,
                port: Number(target.port || 80),
                path: `${target.pathname}${target.search}`,
                method,
                headers: {
                    accept: "application/json",
                    ...(method === "POST"
                        ? { "content-type": "application/json", "content-length": Buffer.byteLength(requestBody) }
                        : {}),
                },
                timeout: 5000,
            },
            (res) => {
                let responseBody = "";

                res.setEncoding("utf8");
                res.on("data", (chunk) => {
                    responseBody += chunk;
                });
                res.on("end", () => {
                    try {
                        const value = JSON.parse(responseBody) as JsonValue;

                        if (res.statusCode != null && res.statusCode >= 400) {
                            resolve({ ok: false, error: `Runtime returned HTTP ${res.statusCode}: ${responseBody}` });
                            return;
                        }

                        resolve({ ok: true, value });
                    } catch {
                        resolve({ ok: false, error: `Invalid JSON from ${target.href}` });
                    }
                });
            }
        );

        req.on("timeout", () => {
            req.destroy(new Error(`Timeout while requesting ${target.href}`));
        });
        req.on("error", (error) => {
            resolve({ ok: false, error: error.message });
        });
        req.end(requestBody);
    });
}

async function sendJson(res: http.ServerResponse, statusCode: number, value: unknown): Promise<void> {
    const body = JSON.stringify(value, null, 2);

    res.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
    });
    res.end(body);
}

server.listen(port, "127.0.0.1", () => {
    console.log(`Demo visualizer listening on http://localhost:${port}`);
});

process.on("SIGINT", () => {
    server.close(() => process.exit(0));
});
