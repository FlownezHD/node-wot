type RuntimeBinding = {
    id: string;
    protocol?: string;
    package?: string;
};

let runtimeStatus = "running";
let lastOperation = "Runtime initialized";
let registeredBindings: RuntimeBinding[] = [];

WoT.produce({
    title: "Runtime",
    description: "WoT runtime to manage protocol bindings.",
    properties: {
        status: {
            type: "string",
            description: "Current runtime status",
            observable: true,
            readOnly: true,
        },
        lastOperation: {
            type: "string",
            description: "Description of the last runtime operation",
            observable: true,
            readOnly: true,
        },
        registeredBindings: {
            type: "array",
            description: "Bindings currently known to the runtime",
            observable: true,
            readOnly: true,
            items: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                    },
                    protocol: {
                        type: "string",
                    },
                    package: {
                        type: "string",
                    },
                },
            },
        },
    },
    actions: {
        addBinding: {
            description: "Add a binding entry to the runtime",
            input: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                    },
                    protocol: {
                        type: "string",
                    },
                    package: {
                        type: "string",
                    },
                },
                required: ["id"],
            },
            output: {
                type: "object",
                properties: {
                    result: {
                        type: "boolean",
                    },
                    message: {
                        type: "string",
                    },
                },
            },
        },
        removeBinding: {
            description: "Remove a binding entry from the runtime skeleton",
            input: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                    },
                },
                required: ["id"],
            },
            output: {
                type: "object",
                properties: {
                    result: {
                        type: "boolean",
                    },
                    message: {
                        type: "string",
                    },
                },
            },
        },
    },
    events: {
        bindingAdded: {
            description: "Emitted when a binding was added to the runtime",
        },
        bindingRemoved: {
            description: "Emitted when a binding was removed from the runtime",
        },
    },
})
    .then((thing) => {
        console.log(`Produced ${thing.getThingDescription().title}`);

        thing.setPropertyReadHandler("status", async () => runtimeStatus);
        thing.setPropertyReadHandler("lastOperation", async () => lastOperation);
        thing.setPropertyReadHandler("registeredBindings", async () => registeredBindings);

        thing.setActionHandler("addBinding", async (params) => {
            const input = params == null ? undefined : ((await params.value()) as RuntimeBinding);

            if (typeof input?.id !== "string" || input.id.length === 0) {
                return { result: false, message: "Binding id is required." };
            }

            // TODO: Replace this placeholder with validation and dynamic loading logic.
            registeredBindings.push({
                id: input.id,
                protocol: input.protocol,
                package: input.package,
            });
            lastOperation = `Added binding '${input.id}'`;

            thing.emitPropertyChange("registeredBindings");
            thing.emitPropertyChange("lastOperation");
            thing.emitEvent("bindingAdded", { id: input.id });

            return { result: true, message: `Binding '${input.id}' added to runtime skeleton.` };
        });

        thing.setActionHandler("removeBinding", async (params) => {
            const input = params == null ? undefined : ((await params.value()) as { id: string });

            if (typeof input?.id !== "string" || input.id.length === 0) {
                return { result: false, message: "Binding id is required." };
            }

            // TODO: Replace this placeholder with undeploy/unregister logic.
            const nextBindings = registeredBindings.filter((binding) => binding.id !== input.id);

            if (nextBindings.length === registeredBindings.length) {
                return { result: false, message: `Binding '${input.id}' was not found.` };
            }

            registeredBindings = nextBindings;
            lastOperation = `Removed binding '${input.id}'`;

            thing.emitPropertyChange("registeredBindings");
            thing.emitPropertyChange("lastOperation");
            thing.emitEvent("bindingRemoved", { id: input.id });

            return { result: true, message: `Binding '${input.id}' removed from runtime skeleton.` };
        });

        thing.expose().then(() => {
            console.info(`${thing.getThingDescription().title} ready`);
        });
    })
    .catch((err) => {
        console.error(err);
    });
