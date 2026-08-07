"use strict";

const net = require("net");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");

function loadCoreModule() {
    const candidates = [
        path.join("/app", "packages", "core", "dist", "core.js"),
        path.resolve(__dirname, "..", "..", "..", "packages", "core", "dist", "core.js"),
        path.resolve(process.cwd(), "packages", "core", "dist", "core.js")
    ];

    let lastError;

    for (const candidate of candidates) {
        try {
            return require(candidate);
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(
        `Unable to load the node-wot core module. Tried: ${candidates.join(", ")}. ${lastError instanceof Error ? lastError.message : ""}`.trim()
    );
}

const { Content } = loadCoreModule();

function toSlug(value) {
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "thing";
}

function toContent(type, body) {
    return new Content(type || "application/json", Readable.from(body));
}

function contentToWire(content) {
    if (content == null) {
        return Promise.resolve({ contentType: "application/json", body: "" });
    }

    return content.toBuffer().then((buffer) => ({
        contentType: content.type || "application/json",
        body: buffer.toString("base64")
    }));
}

function contentFromWire(contentType, body) {
    return toContent(contentType || "application/json", Buffer.from(body || "", "base64"));
}

function getAddresses() {
    const addresses = new Set(["127.0.0.1", "localhost"]);
    const interfaces = os.networkInterfaces();

    for (const iface of Object.values(interfaces)) {
        for (const entry of iface || []) {
            if (entry.internal === false && entry.family === "IPv4") {
                addresses.add(entry.address);
            }
        }
    }

    return [...addresses];
}

function parseNewUrl(href) {
    const url = new URL(href);
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    return {
        host: url.hostname,
        port: Number(url.port || 8092),
        thingPath: segments[0],
        resourceType: segments[1],
        resourceName: segments[2]
    };
}

class NewClient {
    constructor() {
        this.scheme = "new";
    }

    async readResource(form) {
        const target = parseNewUrl(form.href);

        if (target.resourceType !== "properties" || !target.resourceName) {
            throw new Error("NewBinding readResource expects a property form.");
        }

        return this.#request(target, {
            op: "readProperty",
            path: target.thingPath,
            name: target.resourceName
        });
    }

    async writeResource(form, content) {
        const target = parseNewUrl(form.href);
        const wireContent = await contentToWire(content);

        if (target.resourceType !== "properties" || !target.resourceName) {
            throw new Error("NewBinding writeResource expects a property form.");
        }

        await this.#request(target, {
            op: "writeProperty",
            path: target.thingPath,
            name: target.resourceName,
            contentType: wireContent.contentType,
            body: wireContent.body
        });
    }

    async invokeResource(form, content) {
        const target = parseNewUrl(form.href);
        const wireContent = await contentToWire(content);

        if (target.resourceType !== "actions" || !target.resourceName) {
            throw new Error("NewBinding invokeResource expects an action form.");
        }

        return this.#request(target, {
            op: "invokeAction",
            path: target.thingPath,
            name: target.resourceName,
            contentType: wireContent.contentType,
            body: wireContent.body
        });
    }

    async unlinkResource() {
        throw new Error("NewBinding does not support unlinkResource.");
    }

    async subscribeResource() {
        throw new Error("NewBinding does not support subscriptions.");
    }

    async requestThingDescription(uri) {
        const target = parseNewUrl(uri);

        return this.#request(target, {
            op: "readThingDescription",
            path: target.thingPath
        });
    }

    async start() {}

    async stop() {}

    setSecurity() {
        return true;
    }

    async #request(target, message) {
        const response = await sendTcpMessage(target.host, target.port, message);

        if (response.ok !== true) {
            throw new Error(response.error || "NewBinding request failed.");
        }

        return contentFromWire(response.contentType, response.body);
    }
}

class NewClientFactory {
    constructor() {
        this.scheme = "new";
    }

    getClient() {
        return new NewClient();
    }

    init() {
        return true;
    }

    destroy() {
        return true;
    }
}

class NewServer {
    constructor(config = {}) {
        this.scheme = "new";
        this.port = config.port || 8092;
        this.address = config.address || "0.0.0.0";
        this.server = null;
        this.thingsByPath = new Map();
    }

    async start() {
        if (this.server) {
            return;
        }

        this.server = net.createServer((socket) => {
            void this.#handleSocket(socket);
        });

        await new Promise((resolve, reject) => {
            this.server.once("error", reject);
            this.server.listen(this.port, this.address, () => {
                this.server.off("error", reject);
                resolve();
            });
        });
    }

    async stop() {
        if (!this.server) {
            return;
        }

        await new Promise((resolve, reject) => {
            this.server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });

        this.server = null;
    }

    getPort() {
        if (!this.server) {
            return -1;
        }

        const address = this.server.address();
        return address && typeof address === "object" ? address.port : -1;
    }

    async expose(thing) {
        const thingPath = this.#createThingPath(thing.title);
        const entry = {
            path: thingPath,
            thing,
            propertyForms: new Map(),
            actionForms: new Map()
        };

        this.thingsByPath.set(thingPath, entry);
        this.#fillThingForms(entry);
    }

    async destroy(thingId) {
        for (const [key, entry] of this.thingsByPath.entries()) {
            if (entry.thing.id === thingId) {
                this.thingsByPath.delete(key);
                return true;
            }
        }

        return false;
    }

    #createThingPath(title) {
        const base = toSlug(title);
        let current = base;
        let counter = 2;

        while (this.thingsByPath.has(current)) {
            current = `${base}-${counter++}`;
        }

        return current;
    }

    #fillThingForms(entry) {
        const { thing, path: thingPath, propertyForms, actionForms } = entry;
        const addresses = getAddresses();
        const port = this.getPort();

        thing.forms ??= [];

        for (const address of addresses) {
            thing.forms.push({
                href: `new://${address}:${port}/${thingPath}`,
                contentType: "application/td+json"
            });

            for (const [propertyName, property] of Object.entries(thing.properties || {})) {
                property.forms ??= [];

                const form = {
                    href: `new://${address}:${port}/${thingPath}/properties/${encodeURIComponent(propertyName)}`,
                    contentType: "application/json",
                    op: []
                };

                if (property.writeOnly !== true) {
                    form.op.push("readproperty");
                }

                if (property.readOnly !== true) {
                    form.op.push("writeproperty");
                }

                propertyForms.set(propertyName, property.forms.length);
                property.forms.push(form);
            }

            for (const [actionName, action] of Object.entries(thing.actions || {})) {
                action.forms ??= [];
                actionForms.set(actionName, action.forms.length);
                action.forms.push({
                    href: `new://${address}:${port}/${thingPath}/actions/${encodeURIComponent(actionName)}`,
                    contentType: "application/json",
                    op: ["invokeaction"]
                });
            }
        }
    }

    async #handleSocket(socket) {
        try {
            const request = await readJsonLine(socket);
            const response = await this.#handleMessage(request);
            socket.write(`${JSON.stringify(response)}\n`);
        } catch (error) {
            socket.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unknown error" })}\n`);
        } finally {
            socket.end();
        }
    }

    async #handleMessage(request) {
        const entry = this.thingsByPath.get(request.path);

        if (!entry) {
            return { ok: false, error: "Thing not found." };
        }

        if (request.op === "readThingDescription") {
            return {
                ok: true,
                contentType: "application/td+json",
                body: Buffer.from(JSON.stringify(entry.thing.getThingDescription())).toString("base64")
            };
        }

        if (request.op === "readProperty") {
            const formIndex = entry.propertyForms.get(request.name) || 0;
            const content = await entry.thing.handleReadProperty(request.name, { formIndex });
            const wireContent = await contentToWire(content);
            return { ok: true, ...wireContent };
        }

        if (request.op === "writeProperty") {
            const formIndex = entry.propertyForms.get(request.name) || 0;
            await entry.thing.handleWriteProperty(
                request.name,
                contentFromWire(request.contentType, request.body),
                { formIndex }
            );
            return {
                ok: true,
                contentType: "application/json",
                body: Buffer.from(JSON.stringify({ ok: true })).toString("base64")
            };
        }

        if (request.op === "invokeAction") {
            const formIndex = entry.actionForms.get(request.name) || 0;
            const result = await entry.thing.handleInvokeAction(
                request.name,
                contentFromWire(request.contentType, request.body),
                { formIndex }
            );
            const wireContent = await contentToWire(result);
            return { ok: true, ...wireContent };
        }

        return { ok: false, error: `Unsupported operation '${request.op}'.` };
    }
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

            const line = buffer.slice(0, newlineIndex);
            finish(line);
        });
        socket.on("error", reject);
        socket.on("end", () => {
            if (buffer.length > 0) {
                finish(buffer);
            }
        });
    });
}

function sendTcpMessage(host, port, message) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, host);
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
        socket.on("connect", () => {
            socket.write(`${JSON.stringify(message)}\n`);
        });
        socket.on("data", (chunk) => {
            buffer += chunk;
            const newlineIndex = buffer.indexOf("\n");

            if (newlineIndex === -1) {
                return;
            }

            const line = buffer.slice(0, newlineIndex);
            socket.end();
            finish(line);
        });
        socket.on("error", reject);
        socket.on("end", () => {
            if (buffer.length > 0) {
                finish(buffer);
            }
        });
    });
}

function createBinding() {
    return {
        id: "new-binding",
        schemes: ["new"],
        createClientFactory() {
            return new NewClientFactory();
        },
        createServer() {
            return new NewServer({ port: 8092 });
        }
    };
}

module.exports = {
    createBinding
};
