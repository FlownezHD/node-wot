"use strict";

const path = require("path");

const bindingPath = path.resolve(__dirname, "bindings", "simple-binding", "index.js");
const { createBinding } = require(bindingPath);

function createJsonContent(value) {
    const buffer = Buffer.from(JSON.stringify(value));

    return {
        type: "application/json",
        async toBuffer() {
            return buffer;
        }
    };
}

async function contentToText(content) {
    const buffer = await content.toBuffer();
    return buffer.toString("utf-8");
}

function printUsage() {
    console.log(`Usage:
  node my_runtime/simple-client-test.js
  node my_runtime/simple-client-test.js td
  node my_runtime/simple-client-test.js read <propertyName>
  node my_runtime/simple-client-test.js write <propertyName> <jsonValue>
  node my_runtime/simple-client-test.js action <actionName> [jsonInput]

Examples:
  node my_runtime/simple-client-test.js
  node my_runtime/simple-client-test.js td
  node my_runtime/simple-client-test.js read status
  node my_runtime/simple-client-test.js action addBinding '{"id":"example-binding"}'
  node my_runtime/simple-client-test.js action removeBinding '{"id":"example-binding"}'`);
}

async function main() {
    const binding = createBinding();
    const factory = binding.createClientFactory();

    if (factory.init() === false) {
        throw new Error("Simple client factory initialization failed.");
    }

    const client = factory.getClient();
    const host = process.env.SIMPLE_HOST || "localhost";
    const port = process.env.SIMPLE_PORT || "8091";
    const thingPath = process.env.SIMPLE_THING || "runtime";
    const command = process.argv[2] || "smoke";

    try {
        if (command === "help" || command === "--help" || command === "-h") {
            printUsage();
            return;
        }

        if (command === "smoke") {
            const td = await client.requestThingDescription(`simple://${host}:${port}/${thingPath}`);
            const status = await client.readResource({
                href: `simple://${host}:${port}/${thingPath}/properties/status`
            });
            const lastOperation = await client.readResource({
                href: `simple://${host}:${port}/${thingPath}/properties/lastOperation`
            });
            const registeredBindings = await client.readResource({
                href: `simple://${host}:${port}/${thingPath}/properties/registeredBindings`
            });

            console.log("TD:");
            console.log(await contentToText(td));
            console.log("\nstatus:");
            console.log(await contentToText(status));
            console.log("\nlastOperation:");
            console.log(await contentToText(lastOperation));
            console.log("\nregisteredBindings:");
            console.log(await contentToText(registeredBindings));
            return;
        }

        if (command === "td") {
            const td = await client.requestThingDescription(`simple://${host}:${port}/${thingPath}`);
            console.log(await contentToText(td));
            return;
        }

        if (command === "read") {
            const propertyName = process.argv[3];

            if (!propertyName) {
                throw new Error("Missing property name. Example: read status");
            }

            const content = await client.readResource({
                href: `simple://${host}:${port}/${thingPath}/properties/${encodeURIComponent(propertyName)}`
            });
            console.log(await contentToText(content));
            return;
        }

        if (command === "write") {
            const propertyName = process.argv[3];
            const rawValue = process.argv[4];

            if (!propertyName || rawValue == null) {
                throw new Error("Missing arguments. Example: write someProperty '42'");
            }

            const value = JSON.parse(rawValue);
            await client.writeResource(
                {
                    href: `simple://${host}:${port}/${thingPath}/properties/${encodeURIComponent(propertyName)}`
                },
                createJsonContent(value)
            );
            console.log(`Property '${propertyName}' updated.`);
            return;
        }

        if (command === "action") {
            const actionName = process.argv[3];
            const rawInput = process.argv[4];

            if (!actionName) {
                throw new Error("Missing action name. Example: action addBinding '{\"id\":\"example-binding\"}'");
            }

            const input = rawInput == null ? {} : JSON.parse(rawInput);
            const content = await client.invokeResource(
                {
                    href: `simple://${host}:${port}/${thingPath}/actions/${encodeURIComponent(actionName)}`
                },
                createJsonContent(input)
            );

            console.log(await contentToText(content));
            return;
        }

        throw new Error(`Unknown command '${command}'. Use --help for usage.`);
    } finally {
        factory.destroy();
    }
}

main().catch((error) => {
    console.error("Simple client test failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
