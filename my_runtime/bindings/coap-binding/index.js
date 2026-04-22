"use strict";

const path = require("path");

function loadCoapBindingModule() {
    const candidates = [
        path.join("/app", "packages", "binding-coap", "dist", "coap.js"),
        path.resolve(process.cwd(), "packages", "binding-coap", "dist", "coap.js")
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
        `Unable to load the node-wot CoAP binding module. Tried: ${candidates.join(", ")}. ${lastError instanceof Error ? lastError.message : ""}`.trim()
    );
}

function createBinding() {
    const { CoapServer } = loadCoapBindingModule();

    return {
        id: "coap-binding",
        schemes: ["coap"],
        createServer() {
            return new CoapServer({ port: 5684 });
        }
    };
}

module.exports = {
    createBinding
};
