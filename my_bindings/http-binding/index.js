"use strict";

const path = require("path");

function loadHttpBindingModule() {
    const candidates = [
        path.join("/app", "packages", "binding-http", "dist", "http.js"),
        path.resolve(process.cwd(), "packages", "binding-http", "dist", "http.js")
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
        `Unable to load the node-wot HTTP binding module. Tried: ${candidates.join(", ")}. ${lastError instanceof Error ? lastError.message : ""}`.trim()
    );
}

function createBinding() {
    const { HttpServer } = loadHttpBindingModule();

    return {
        id: "http-binding",
        schemes: ["http"],
        createServer() {
            return new HttpServer({ port: 8091 });
        }
    };
}

module.exports = {
    createBinding
};
