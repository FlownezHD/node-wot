import { existsSync } from "fs";
import path from "path";

//smallest form of an ClientFactory
type RuntimeClientFactory = {
    readonly scheme: string;
    getClient(): unknown;
    init(): boolean;
    destroy(): boolean;
};

//smallest form of a Server
type RuntimeServer = {
    readonly scheme: string;
    expose(thing: unknown, tdTemplate?: unknown): Promise<void>;
    destroy(thingId: string): Promise<boolean>;
    start(servient: RuntimeServient): Promise<void>;
    stop(): Promise<void>;
    getPort(): number;
};

//Servient methods used by the runtime
type RuntimeServient = {
    addClientFactory(clientFactory: RuntimeClientFactory): void;
    removeClientFactory(scheme: string): boolean;
    hasClientFor(scheme: string): boolean;
    addServer(server: RuntimeServer): boolean;
    removeServer(server: RuntimeServer): Promise<boolean>;
};

//type description of the binding
type RuntimeBinding = {
    id: string;
    protocol?: string;
    package?: string;
};

//Runtime Mainfest
type RuntimeBindingManifest = {
    id: string;
    name?: string;
    version?: string;
    description?: string;
    entrypoint: string;
    schemes?: string[];
    capabilities?: {
        client?: boolean;
        server?: boolean;
    };
};

//Output after createBinding()
type DynamicBinding = {
    id: string;
    schemes?: string[];
    createClientFactory?: () => RuntimeClientFactory;
    createServer?: () => RuntimeServer;
};

//?
type BindingModule = {
    createBinding?: () => DynamicBinding;
    default?: {
        createBinding?: () => DynamicBinding;
    };
};

//which bindings are already loaded ?
type LoadedBinding = {
    binding: RuntimeBinding;
    clientSchemes: string[];
    server?: RuntimeServer;
    manifestPath: string;
    entrypointPath: string;
};

let runtimeStatus = "running";
let lastOperation = "Runtime initialized";
let registeredBindings: RuntimeBinding[] = [];
const loadedBindings = new Map<string, LoadedBinding>();

//return the running Servient from WoT
function getServient(): RuntimeServient {
    const context = (globalThis as {
        NodeWoT?: {
            servient?: RuntimeServient;
        };
    }).NodeWoT;

    if (context?.servient == null) {
        throw new Error("Runtime script requires access to the active CLI servient.");
    }

    return context.servient;
}

//search for the binding path
function resolveBindingBasePath(bindingId: string): string {
    const candidates = [
        path.resolve(__dirname, "bindings", bindingId),
        path.resolve(process.cwd(), "src", "bindings", bindingId),
        path.resolve(process.cwd(), "dist", "runtime", "bindings", bindingId),
    ];

    const bindingBasePath = candidates.find((candidate) => existsSync(candidate));

    if (bindingBasePath == null) {
        throw new Error(`Binding '${bindingId}' was not found under src/bindings or dist/runtime/bindings.`);
    }

    return bindingBasePath;
}

//Binding loading function
function loadBinding(bindingId: string): {
    manifest: RuntimeBindingManifest;
    binding: DynamicBinding;
    manifestPath: string;
    entrypointPath: string;
} {
    const bindingBasePath = resolveBindingBasePath(bindingId);
    const manifestPath = path.resolve(bindingBasePath, "manifest.json");

    if (!existsSync(manifestPath)) {
        throw new Error(`Binding '${bindingId}' is missing its manifest.json file.`);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const manifest = require(manifestPath) as RuntimeBindingManifest;

    if (typeof manifest.entrypoint !== "string" || manifest.entrypoint.length === 0) {
        throw new Error(`Binding '${bindingId}' manifest does not define a valid entrypoint.`);
    }

    if (manifest.id !== bindingId) {
        throw new Error(`Binding manifest id '${manifest.id}' does not match requested id '${bindingId}'.`);
    }

    const entrypointPath = path.resolve(bindingBasePath, manifest.entrypoint);

    if (!existsSync(entrypointPath)) {
        throw new Error(`Binding '${bindingId}' entrypoint '${manifest.entrypoint}' was not found.`);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bindingModule = require(entrypointPath) as BindingModule;
    const createBinding = bindingModule.createBinding ?? bindingModule.default?.createBinding;

    if (typeof createBinding !== "function") {
        throw new Error(`Binding '${bindingId}' entrypoint does not export createBinding().`);
    }

    const binding = createBinding();

    if (typeof binding?.id !== "string" || binding.id.length === 0) {
        throw new Error(`Binding '${bindingId}' returned an invalid binding definition.`);
    }

    if (binding.id !== bindingId) {
        throw new Error(`Binding entrypoint id '${binding.id}' does not match requested id '${bindingId}'.`);
    }

    return { manifest, binding, manifestPath, entrypointPath };
}

//clear the module cache so the bindin is new if we reload it
function clearModuleCache(modulePath: string): void {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        delete require.cache[require.resolve(modulePath)];
    } catch {
        // Ignore cache cleanup issues so add/remove stays best-effort.
    }
}

//Check if the provided RuntimeClientFactory is valid
function isRuntimeClientFactory(value: unknown): value is RuntimeClientFactory {
    if (value == null || typeof value !== "object") {
        return false;
    }

    const candidate = value as RuntimeClientFactory;
    return (
        typeof candidate.scheme === "string" &&
        typeof candidate.getClient === "function" &&
        typeof candidate.init === "function" &&
        typeof candidate.destroy === "function"
    );
}

//Check if the provided RuntimeServer is valid
function isRuntimeServer(value: unknown): value is RuntimeServer {
    if (value == null || typeof value !== "object") {
        return false;
    }

    const candidate = value as RuntimeServer;
    return (
        typeof candidate.scheme === "string" &&
        typeof candidate.expose === "function" &&
        typeof candidate.destroy === "function" &&
        typeof candidate.start === "function" &&
        typeof candidate.stop === "function" &&
        typeof candidate.getPort === "function"
    );
}

/*
Main Function which loads the provided bindings, validates them and registers them at the Servient
*/
async function registerBinding(input: RuntimeBinding, servient: RuntimeServient): Promise<LoadedBinding> {
    const { manifest, binding, manifestPath, entrypointPath } = loadBinding(input.id);
    const clientSchemes: string[] = [];
    let server: RuntimeServer | undefined;
    let serverStarted = false;
    let serverRegistered = false;

    try {
        if (typeof binding.createClientFactory === "function" && manifest.capabilities?.client !== false) {
            const clientFactory = binding.createClientFactory();

            if (!isRuntimeClientFactory(clientFactory)) {
                throw new Error(`Binding '${input.id}' returned an invalid client factory.`);
            }

            if (servient.hasClientFor(clientFactory.scheme)) {
                throw new Error(`A client factory for scheme '${clientFactory.scheme}' is already registered.`);
            }

            servient.addClientFactory(clientFactory);
            clientSchemes.push(clientFactory.scheme);

            if (clientFactory.init() === false) {
                throw new Error(`Client factory for scheme '${clientFactory.scheme}' failed to initialize.`);
            }
        }

        if (typeof binding.createServer === "function" && manifest.capabilities?.server !== false) {
            const createdServer = binding.createServer();

            if (!isRuntimeServer(createdServer)) {
                throw new Error(`Binding '${input.id}' returned an invalid server.`);
            }

            server = createdServer;
            await server.start(servient);
            serverStarted = true;
            servient.addServer(server);
            serverRegistered = true;
        }

        if (clientSchemes.length === 0 && server == null) {
            throw new Error(`Binding '${input.id}' exposes neither a client factory nor a server.`);
        }

        return {
            binding: {
                id: input.id,
                protocol: input.protocol ?? binding.schemes?.[0] ?? manifest.schemes?.[0],
                package: input.package ?? manifest.name ?? path.relative(process.cwd(), entrypointPath),
            },
            clientSchemes,
            server,
            manifestPath,
            entrypointPath,
        };
    } catch (error) {
        clientSchemes.forEach((scheme) => {
            servient.removeClientFactory(scheme);
        });

        if (serverStarted && server != null) {
            if (serverRegistered) {
                await servient.removeServer(server);
            } else {
                await server.stop();
            }
        }

        clearModuleCache(entrypointPath);
        clearModuleCache(manifestPath);

        throw error;
    }
}

async function unregisterBinding(bindingId: string, servient: RuntimeServient): Promise<boolean> {
    const loadedBinding = loadedBindings.get(bindingId);

    if (loadedBinding == null) {
        return false;
    }

    loadedBindings.delete(bindingId);

    for (const scheme of loadedBinding.clientSchemes) {
        servient.removeClientFactory(scheme);
    }

    if (loadedBinding.server != null) {
        await servient.removeServer(loadedBinding.server);
    }

    clearModuleCache(loadedBinding.entrypointPath);
    clearModuleCache(loadedBinding.manifestPath);

    return true;
}

async function main() {
    const servient = getServient();
    const thing = await WoT.produce({
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
                description: "Load and register a binding in the active runtime",
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
                description: "Unload a binding from the active runtime",
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
    });

    console.log(`Produced ${thing.getThingDescription().title}`);

    thing.setPropertyReadHandler("status", async () => runtimeStatus);
    thing.setPropertyReadHandler("lastOperation", async () => lastOperation);
    thing.setPropertyReadHandler("registeredBindings", async () => registeredBindings);

    thing.setActionHandler("addBinding", async (params?: WoT.InteractionOutput | null) => {
        const input = params == null ? undefined : ((await params.value()) as RuntimeBinding);

        if (typeof input?.id !== "string" || input.id.length === 0) {
            return { result: false, message: "Binding id is required." };
        }

        if (loadedBindings.has(input.id)) {
            return { result: false, message: `Binding '${input.id}' is already loaded.` };
        }

        try {
            const loadedBinding = await registerBinding(input, servient);
            loadedBindings.set(input.id, loadedBinding);
            registeredBindings = [...registeredBindings, loadedBinding.binding];
            lastOperation = `Added binding '${input.id}'`;

            thing.emitPropertyChange("registeredBindings");
            thing.emitPropertyChange("lastOperation");
            thing.emitEvent("bindingAdded", { id: input.id });

            return {
                result: true,
                message: `Binding '${input.id}' loaded with schemes ${loadedBinding.clientSchemes.join(", ") || "server-only"}.`,
            };
        } catch (error) {
            lastOperation = `Failed to add binding '${input.id}'`;
            thing.emitPropertyChange("lastOperation");

            return {
                result: false,
                message: error instanceof Error ? error.message : `Failed to add binding '${input.id}'.`,
            };
        }
    });

    thing.setActionHandler("removeBinding", async (params?: WoT.InteractionOutput | null) => {
        const input = params == null ? undefined : ((await params.value()) as { id: string });

        if (typeof input?.id !== "string" || input.id.length === 0) {
            return { result: false, message: "Binding id is required." };
        }

        try {
            const removed = await unregisterBinding(input.id, servient);

            if (!removed) {
                return { result: false, message: `Binding '${input.id}' was not found.` };
            }

            registeredBindings = registeredBindings.filter((binding) => binding.id !== input.id);
            lastOperation = `Removed binding '${input.id}'`;

            thing.emitPropertyChange("registeredBindings");
            thing.emitPropertyChange("lastOperation");
            thing.emitEvent("bindingRemoved", { id: input.id });

            return { result: true, message: `Binding '${input.id}' removed from runtime.` };
        } catch (error) {
            lastOperation = `Failed to remove binding '${input.id}'`;
            thing.emitPropertyChange("lastOperation");

            return {
                result: false,
                message: error instanceof Error ? error.message : `Failed to remove binding '${input.id}'.`,
            };
        }
    });

    await thing.expose();
    console.info(`${thing.getThingDescription().title} ready`);
}

void main().catch((err: unknown) => {
    console.error(err);
});
