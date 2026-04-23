"use strict";

const http = require("http");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");

function loadCoreModule() {
    const candidates = [
        path.join("/app", "packages", "core", "dist", "core.js"),
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

function collectBody(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];

        stream.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        stream.on("end", () => {
            resolve(Buffer.concat(chunks));
        });
        stream.on("error", reject);
    });
}

function toContent(type, body) {
    return new Content(type || "application/json", Readable.from(body));
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

class SimpleClient {
    constructor() {
        this.scheme = "simple";
    }

    async readResource(form) {
        return this.#request(form.href, "GET");
    }

    async writeResource(form, content) {
        await this.#request(form.href, "PUT", content);
    }

    async invokeResource(form, content) {
        return this.#request(form.href, "POST", content);
    }

    async unlinkResource(form) {
        await this.#request(form.href, "DELETE");
    }

    async subscribeResource() {
        throw new Error("SimpleBinding does not support subscriptions.");
    }

    async requestThingDescription(uri) {
        return this.#request(uri, "GET", undefined, {
            Accept: "application/td+json"
        });
    }

    async start() {}

    async stop() {}

    setSecurity() {
        return true;
    }

    async #request(href, method, content, extraHeaders = {}) {
        const url = new URL(href);
        const body = content ? await content.toBuffer() : undefined;
        const headers = { ...extraHeaders };

        if (body) {
            headers["Content-Type"] = content.type || "application/json";
            headers["Content-Length"] = body.length;
        }

        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: url.hostname,
                    port: Number(url.port || 80),
                    path: `${url.pathname}${url.search}`,
                    method,
                    headers
                },
                async (res) => {
                    try {
                        const responseBody = await collectBody(res);
                        resolve(
                            new Content(
                                res.headers["content-type"] || "application/json",
                                Readable.from(responseBody)
                            )
                        );
                    } catch (error) {
                        reject(error);
                    }
                }
            );

            req.on("error", reject);

            if (body) {
                req.write(body);
            }

            req.end();
        });
    }
}

class SimpleClientFactory {
    constructor() {
        this.scheme = "simple";
    }

    getClient() {
        return new SimpleClient();
    }

    init() {
        return true;
    }

    destroy() {
        return true;
    }
}

class SimpleServer {
    constructor(config = {}) {
        this.scheme = "simple";
        this.port = config.port || 8091;
        this.address = config.address || "0.0.0.0";
        this.httpServer = null;
        this.thingsByPath = new Map();
    }

    async start() {
        if (this.httpServer) {
            return;
        }

        this.httpServer = http.createServer((req, res) => {
            void this.#handleRequest(req, res);
        });

        await new Promise((resolve, reject) => {
            this.httpServer.once("error", reject);
            this.httpServer.listen(this.port, this.address, () => {
                this.httpServer.off("error", reject);
                resolve();
            });
        });
    }

    async stop() {
        if (!this.httpServer) {
            return;
        }

        await new Promise((resolve, reject) => {
            this.httpServer.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });

        this.httpServer = null;
    }

    getPort() {
        if (!this.httpServer) {
            return -1;
        }

        const address = this.httpServer.address();
        return address && typeof address === "object" ? address.port : -1;
    }

    async expose(thing) {
        const urlPath = this.#createThingPath(thing.title);
        const entry = {
            path: urlPath,
            thing,
            propertyForms: new Map(),
            actionForms: new Map()
        };

        this.thingsByPath.set(urlPath, entry);
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
                href: `simple://${address}:${port}/${thingPath}`,
                contentType: "application/td+json"
            });

            for (const [propertyName, property] of Object.entries(thing.properties)) {
                property.forms ??= [];

                const form = {
                    href: `simple://${address}:${port}/${thingPath}/properties/${encodeURIComponent(propertyName)}`,
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

            for (const [actionName, action] of Object.entries(thing.actions)) {
                action.forms ??= [];
                actionForms.set(actionName, action.forms.length);
                action.forms.push({
                    href: `simple://${address}:${port}/${thingPath}/actions/${encodeURIComponent(actionName)}`,
                    contentType: "application/json",
                    op: ["invokeaction"]
                });
            }
        }
    }

    async #handleRequest(req, res) {
        try {
            const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
            const segments = url.pathname.split("/").filter(Boolean);

            if (segments.length === 0) {
                this.#sendJson(res, 404, { error: "Thing not found." });
                return;
            }

            const entry = this.thingsByPath.get(decodeURIComponent(segments[0]));

            if (!entry) {
                this.#sendJson(res, 404, { error: "Thing not found." });
                return;
            }

            if (segments.length === 1 && req.method === "GET") {
                this.#sendJson(res, 200, entry.thing.getThingDescription(), "application/td+json");
                return;
            }

            if (segments[1] === "properties" && segments[2]) {
                await this.#handlePropertyRequest(entry, decodeURIComponent(segments[2]), req, res);
                return;
            }

            if (segments[1] === "actions" && segments[2]) {
                await this.#handleActionRequest(entry, decodeURIComponent(segments[2]), req, res);
                return;
            }

            this.#sendJson(res, 404, { error: "Interaction not found." });
        } catch (error) {
            this.#sendJson(res, 500, { error: error instanceof Error ? error.message : "Unknown server error." });
        }
    }

    async #handlePropertyRequest(entry, propertyName, req, res) {
        const formIndex = entry.propertyForms.get(propertyName) || 0;

        if (req.method === "GET") {
            const content = await entry.thing.handleReadProperty(propertyName, { formIndex });
            const buffer = await content.toBuffer();
            this.#sendBuffer(res, 200, buffer, content.type || "application/json");
            return;
        }

        if (req.method === "PUT") {
            const body = await collectBody(req);
            await entry.thing.handleWriteProperty(
                propertyName,
                toContent(req.headers["content-type"] || "application/json", body),
                { formIndex }
            );
            this.#sendJson(res, 200, { ok: true });
            return;
        }

        this.#sendJson(res, 405, { error: "Method not allowed." });
    }

    async #handleActionRequest(entry, actionName, req, res) {
        if (req.method !== "POST") {
            this.#sendJson(res, 405, { error: "Method not allowed." });
            return;
        }

        const formIndex = entry.actionForms.get(actionName) || 0;
        const body = await collectBody(req);
        const result = await entry.thing.handleInvokeAction(
            actionName,
            toContent(req.headers["content-type"] || "application/json", body),
            { formIndex }
        );

        if (result == null) {
            res.writeHead(204);
            res.end();
            return;
        }

        const buffer = await result.toBuffer();
        this.#sendBuffer(res, 200, buffer, result.type || "application/json");
    }

    #sendJson(res, status, value, contentType = "application/json") {
        this.#sendBuffer(res, status, Buffer.from(JSON.stringify(value)), contentType);
    }

    #sendBuffer(res, status, buffer, contentType) {
        res.writeHead(status, {
            "Content-Type": contentType,
            "Content-Length": buffer.length
        });
        res.end(buffer);
    }
}

function createBinding() {
    return {
        id: "simple-binding",
        schemes: ["simple"],
        createClientFactory() {
            return new SimpleClientFactory();
        },
        createServer() {
            return new SimpleServer({ port: 8091 });
        }
    };
}

module.exports = {
    createBinding
};
