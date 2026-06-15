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
    provides: BindingProvidedCapabilities;
    requires: BindingRequirements;
};

type RuntimeBindingInput = {
    id: string;
};

type BindingRole = "client" | "server";

type WoTInteraction =
    | "readThingDescription"
    | "readProperty"
    | "writeProperty"
    | "observeProperty"
    | "invokeAction"
    | "subscribeEvent"
    | "unsubscribeEvent";

type DownwardInterfaceType =
    | "stream-socket"
    | "datagram-socket"
    | "protocol-stack";

type TransportType = "tcp" | "udp";

type InterfaceDirection = BindingRole | "client-server";

type InterfaceProfile = "berkeley-like" | "library-backed" | "nodejs-native" | "none";

type DownwardInterfaceRequirement = {
    type: DownwardInterfaceType;
    direction: InterfaceDirection;
    transport?: TransportType;
    protocol?: string;
    profile?: InterfaceProfile;
};

type PortRequirement = {
    transport?: TransportType;
    preferred?: number;
    required?: boolean;
    exclusive?: boolean;
};

type BindingResourceRequirements = {
    ports?: PortRequirement[];
};

type BindingProvidedCapabilities = {
    schemes: string[];
    roles: BindingRole[];
    interactions: WoTInteraction[];
};

type BindingRequirements = {
    interfaces: DownwardInterfaceRequirement[];
    resources?: BindingResourceRequirements;
};

//Runtime Manifest
type RuntimeBindingManifest = {
    id: string;
    name?: string;
    version?: string;
    description?: string;
    entrypoint: string;
    provides: BindingProvidedCapabilities;
    requires: BindingRequirements;
};

//Output after createBinding()
type DynamicBinding = {
    id: string;
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

type RuntimeDownwardInterface = {
    id: string;
    type: DownwardInterfaceType;
    direction: InterfaceDirection[];
    transport?: TransportType;
    protocol?: string;
    profile?: InterfaceProfile;
};

type RuntimeCapabilities = {
    interfaces: RuntimeDownwardInterface[];
    resourceManagement: {
        portCheck: boolean;
        exclusivePortCheck: boolean;
    };
};

type CompatibilityResult = {
    compatible: boolean;
    missingRequirements: string[];
    conflicts: string[];
};

const validTransportTypes: TransportType[] = ["tcp", "udp"];
const validBindingRoles: BindingRole[] = ["client", "server"];
const validWoTInteractions: WoTInteraction[] = [
    "readThingDescription",
    "readProperty",
    "writeProperty",
    "observeProperty",
    "invokeAction",
    "subscribeEvent",
    "unsubscribeEvent",
];
const validDownwardInterfaceTypes: DownwardInterfaceType[] = [
    "stream-socket",
    "datagram-socket",
    "protocol-stack",
];
const validInterfaceDirections: InterfaceDirection[] = ["client", "server", "client-server"];
const validInterfaceProfiles: InterfaceProfile[] = ["berkeley-like", "library-backed", "nodejs-native", "none"];

let runtimeStatus = "running";
let lastOperation = "Runtime initialized";
let registeredBindings: RuntimeBinding[] = [];
const loadedBindings = new Map<string, LoadedBinding>();

const runtimeCapabilities: RuntimeCapabilities = {
    interfaces: [
        {
            id: "node-http-stack-server",
            type: "protocol-stack",
            protocol: "http",
            direction: ["server"],
            transport: "tcp",
            profile: "nodejs-native",
        },
        {
            id: "node-http-stack-client",
            type: "protocol-stack",
            protocol: "http",
            direction: ["client"],
            transport: "tcp",
            profile: "nodejs-native",
        },
        {
            id: "node-stream-socket",
            type: "stream-socket",
            direction: ["client", "server"],
            transport: "tcp",
            profile: "berkeley-like",
        },
        {
            id: "node-datagram-socket",
            type: "datagram-socket",
            direction: ["client", "server"],
            transport: "udp",
            profile: "berkeley-like",
        },
        {
            id: "node-wot-coap-stack",
            type: "protocol-stack",
            protocol: "coap",
            direction: ["server"],
            transport: "udp",
            profile: "library-backed",
        },
    ],
    resourceManagement: {
        portCheck: true,
        exclusivePortCheck: true,
    },
};

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
        path.resolve(process.cwd(), "my_runtime", "bindings", bindingId),
        path.resolve(process.cwd(), "dist", "my_runtime", "bindings", bindingId),
    ];

    const bindingBasePath = candidates.find((candidate) => existsSync(candidate));

    if (bindingBasePath == null) {
        throw new Error(`Binding '${bindingId}' was not found under my_runtime/bindings or dist/my_runtime/bindings.`);
    }

    return bindingBasePath;
}

function validateBindingManifest(manifest: RuntimeBindingManifest): void {
    if (typeof manifest.id !== "string" || manifest.id.length === 0) {
        throw new Error("Binding manifest does not define a valid id.");
    }

    if (typeof manifest.entrypoint !== "string" || manifest.entrypoint.length === 0) {
        throw new Error(`Binding '${manifest.id}' manifest does not define a valid entrypoint.`);
    }

    if (manifest.provides == null || typeof manifest.provides !== "object") {
        throw new Error(`Binding '${manifest.id}' manifest must define provides.`);
    }

    if (!Array.isArray(manifest.provides?.schemes)) {
        throw new Error(`Binding '${manifest.id}' manifest provides.schemes must be an array.`);
    }

    manifest.provides.schemes.forEach((scheme, index) => {
        if (typeof scheme !== "string" || scheme.length === 0) {
            throw new Error(`Binding '${manifest.id}' provides.schemes entry ${index} must be a non-empty string.`);
        }
    });

    if (!Array.isArray(manifest.provides?.roles)) {
        throw new Error(`Binding '${manifest.id}' manifest provides.roles must be an array.`);
    }

    manifest.provides.roles.forEach((role, index) => {
        if (!validBindingRoles.includes(role)) {
            throw new Error(`Binding '${manifest.id}' provides.roles entry ${index} must be client or server.`);
        }
    });

    if (!Array.isArray(manifest.provides?.interactions)) {
        throw new Error(`Binding '${manifest.id}' manifest provides.interactions must be an array.`);
    }

    manifest.provides.interactions.forEach((interaction, index) => {
        if (!validWoTInteractions.includes(interaction)) {
            throw new Error(`Binding '${manifest.id}' provides.interactions entry ${index} is not supported.`);
        }
    });

    if (manifest.requires == null || typeof manifest.requires !== "object") {
        throw new Error(`Binding '${manifest.id}' manifest must define requires.`);
    }

    if (!Array.isArray(manifest.requires?.interfaces)) {
        throw new Error(`Binding '${manifest.id}' manifest requires.interfaces must be an array.`);
    }

    manifest.requires.interfaces.forEach((requirement, index) => {
        if (!validDownwardInterfaceTypes.includes(requirement?.type)) {
            throw new Error(`Binding '${manifest.id}' interface requirement ${index} type is not supported.`);
        }

        if (!validInterfaceDirections.includes(requirement.direction)) {
            throw new Error(`Binding '${manifest.id}' interface requirement ${index} direction must be client, server or client-server.`);
        }

        if (requirement.transport != null && !validTransportTypes.includes(requirement.transport)) {
            throw new Error(`Binding '${manifest.id}' interface requirement ${index} transport must be tcp or udp.`);
        }

        if (requirement.protocol != null && typeof requirement.protocol !== "string") {
            throw new Error(`Binding '${manifest.id}' interface requirement ${index} protocol must be a string.`);
        }

        if (requirement.profile != null && !validInterfaceProfiles.includes(requirement.profile)) {
            throw new Error(`Binding '${manifest.id}' interface requirement ${index} profile is not supported.`);
        }
    });

    if (manifest.requires.resources?.ports != null && !Array.isArray(manifest.requires.resources.ports)) {
        throw new Error(`Binding '${manifest.id}' manifest requires.resources.ports must be an array.`);
    }

    manifest.requires.resources?.ports?.forEach((portRequirement, index) => {
        if (portRequirement.transport != null && !validTransportTypes.includes(portRequirement.transport)) {
            throw new Error(`Binding '${manifest.id}' port requirement ${index} transport must be tcp or udp.`);
        }

        if (portRequirement.preferred != null && typeof portRequirement.preferred !== "number") {
            throw new Error(`Binding '${manifest.id}' port requirement ${index} preferred must be a number.`);
        }

        if (portRequirement.required != null && typeof portRequirement.required !== "boolean") {
            throw new Error(`Binding '${manifest.id}' port requirement ${index} required must be a boolean.`);
        }

        if (portRequirement.exclusive != null && typeof portRequirement.exclusive !== "boolean") {
            throw new Error(`Binding '${manifest.id}' port requirement ${index} exclusive must be a boolean.`);
        }
    });
}

function supportsDirection(runtimeDirections: InterfaceDirection[], requiredDirection: InterfaceDirection): boolean {
    if (runtimeDirections.includes("client-server")) {
        return true;
    }

    if (requiredDirection === "client-server") {
        return runtimeDirections.includes("client") && runtimeDirections.includes("server");
    }

    return runtimeDirections.includes(requiredDirection);
}

function supportsInterfaceProfile(runtimeProfile?: InterfaceProfile, requiredProfile?: InterfaceProfile): boolean {
    if (requiredProfile == null) {
        return true;
    }

    return runtimeProfile === requiredProfile;
}

function describeRequirement(requirement: DownwardInterfaceRequirement): string {
    return [
        `type=${requirement.type}`,
        requirement.transport == null ? undefined : `transport=${requirement.transport}`,
        requirement.protocol == null ? undefined : `protocol=${requirement.protocol}`,
        `direction=${requirement.direction}`,
        requirement.profile == null ? undefined : `profile=${requirement.profile}`,
    ]
        .filter((part): part is string => part != null)
        .join(" ");
}

type UsedPort = {
    port: number;
    transport?: TransportType;
};

function getCurrentRuntimeState(): { usedPorts: UsedPort[]; registeredSchemes: string[] } {
    const usedPorts = new Map<string, UsedPort>();
    const registeredSchemes = new Set<string>();

    loadedBindings.forEach((loadedBinding) => {
        loadedBinding.binding.provides.schemes.forEach((scheme) => registeredSchemes.add(scheme));
        loadedBinding.clientSchemes.forEach((scheme) => registeredSchemes.add(scheme));

        loadedBinding.binding.requires.resources?.ports?.forEach((portRequirement) => {
            if (typeof portRequirement.preferred === "number") {
                const key = `${portRequirement.transport ?? "any"}:${portRequirement.preferred}`;
                usedPorts.set(key, {
                    port: portRequirement.preferred,
                    transport: portRequirement.transport,
                });
            }
        });

        const port = loadedBinding.server?.getPort();
        if (typeof port === "number" && port > 0) {
            const key = `any:${port}`;
            usedPorts.set(key, { port });
        }
    });

    return {
        usedPorts: [...usedPorts.values()],
        registeredSchemes: [...registeredSchemes],
    };
}

function checkBindingCompatibility(
    manifest: RuntimeBindingManifest,
    capabilities: RuntimeCapabilities,
    currentState: {
        usedPorts: UsedPort[];
        registeredSchemes: string[];
    }
): CompatibilityResult {
    const missingRequirements: string[] = [];
    const conflicts: string[] = [];

    for (const requirement of manifest.requires.interfaces) {
        const matchingInterface = capabilities.interfaces.find((runtimeInterface) => {
            if (runtimeInterface.type !== requirement.type) {
                return false;
            }

            if (requirement.transport != null && runtimeInterface.transport !== requirement.transport) {
                return false;
            }

            if (requirement.protocol != null && runtimeInterface.protocol !== requirement.protocol) {
                return false;
            }

            if (!supportsDirection(runtimeInterface.direction, requirement.direction)) {
                return false;
            }

            return supportsInterfaceProfile(runtimeInterface.profile, requirement.profile);
        });

        if (matchingInterface == null) {
            missingRequirements.push(`No runtime interface found for ${describeRequirement(requirement)}.`);
        }
    }

    for (const portRequirement of manifest.requires.resources?.ports ?? []) {
        const shouldCheckPort =
            capabilities.resourceManagement.portCheck === true &&
            portRequirement.preferred != null &&
            (portRequirement.required === true ||
                (capabilities.resourceManagement.exclusivePortCheck === true && portRequirement.exclusive === true));

        if (!shouldCheckPort) {
            continue;
        }

        const portIsUsed = currentState.usedPorts.some((usedPort) => {
            const samePort = usedPort.port === portRequirement.preferred;
            const sameTransport =
                usedPort.transport == null ||
                portRequirement.transport == null ||
                usedPort.transport === portRequirement.transport;

            return samePort && sameTransport;
        });

        if (portIsUsed) {
            conflicts.push(`Port ${portRequirement.preferred} is already in use`);
        }
    }

    for (const scheme of manifest.provides.schemes) {
        if (currentState.registeredSchemes.includes(scheme)) {
            conflicts.push(`Scheme '${scheme}' is already registered`);
        }
    }

    return {
        compatible: missingRequirements.length === 0 && conflicts.length === 0,
        missingRequirements,
        conflicts,
    };
}

//Manifest loading function
function readBindingManifest(bindingId: string): {
    manifest: RuntimeBindingManifest;
    manifestPath: string;
    entrypointPath: string;
} {
    const bindingBasePath = resolveBindingBasePath(bindingId);
    const manifestPath = path.resolve(bindingBasePath, "manifest.json");

    if (!existsSync(manifestPath)) {
        throw new Error(`Binding '${bindingId}' is missing its manifest.json file.`);
    }

    clearModuleCache(manifestPath);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const manifest = require(manifestPath) as RuntimeBindingManifest;
    validateBindingManifest(manifest);

    if (manifest.id !== bindingId) {
        throw new Error(`Binding manifest id '${manifest.id}' does not match requested id '${bindingId}'.`);
    }

    const entrypointPath = path.resolve(bindingBasePath, manifest.entrypoint);

    if (!existsSync(entrypointPath)) {
        throw new Error(`Binding '${bindingId}' entrypoint '${manifest.entrypoint}' was not found.`);
    }

    return { manifest, manifestPath, entrypointPath };
}

//Binding loading function
function loadBinding(bindingId: string): {
    manifest: RuntimeBindingManifest;
    binding: DynamicBinding;
    manifestPath: string;
    entrypointPath: string;
} {
    const { manifest, manifestPath, entrypointPath } = readBindingManifest(bindingId);

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
async function registerBinding(input: RuntimeBindingInput, servient: RuntimeServient): Promise<LoadedBinding> {
    const { manifest, binding, manifestPath, entrypointPath } = loadBinding(input.id);
    const clientSchemes: string[] = [];
    let server: RuntimeServer | undefined;
    let serverStarted = false;
    let serverRegistered = false;

    try {
        if (typeof binding.createClientFactory === "function" && manifest.provides.roles.includes("client")) {
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

        if (typeof binding.createServer === "function" && manifest.provides.roles.includes("server")) {
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
                provides: manifest.provides,
                requires: manifest.requires,
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
                        provides: {
                            type: "object",
                        },
                        requires: {
                            type: "object",
                        },
                    },
                },
            },
            runtimeCapabilities: {
                type: "object",
                description: "Downward interfaces provided by this runtime.",
                observable: false,
                readOnly: true,
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
                        missingRequirements: {
                            type: "array",
                            items: { type: "string" },
                        },
                        conflicts: {
                            type: "array",
                            items: { type: "string" },
                        },
                    },
                },
            },
            checkBindingCompatibility: {
                description: "Check whether a binding can run on the active runtime without loading it",
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
                        id: {
                            type: "string",
                        },
                        compatible: {
                            type: "boolean",
                        },
                        missingRequirements: {
                            type: "array",
                            items: { type: "string" },
                        },
                        conflicts: {
                            type: "array",
                            items: { type: "string" },
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
    thing.setPropertyReadHandler("runtimeCapabilities", async () => runtimeCapabilities);

    thing.setActionHandler("addBinding", async (params?: WoT.InteractionOutput | null) => {
        const input = params == null ? undefined : ((await params.value()) as RuntimeBindingInput);

        if (typeof input?.id !== "string" || input.id.length === 0) {
            return { result: false, message: "Binding id is required." };
        }

        if (loadedBindings.has(input.id)) {
            return { result: false, message: `Binding '${input.id}' is already loaded.` };
        }

        try {
            const { manifest } = readBindingManifest(input.id);
            const compatibility = checkBindingCompatibility(manifest, runtimeCapabilities, getCurrentRuntimeState());

            if (!compatibility.compatible) {
                lastOperation = `Binding '${input.id}' is not compatible`;
                thing.emitPropertyChange("lastOperation");

                return {
                    result: false,
                    message: `Binding '${input.id}' is not compatible with this runtime.`,
                    missingRequirements: compatibility.missingRequirements,
                    conflicts: compatibility.conflicts,
                };
            }

            const loadedBinding = await registerBinding(input, servient);
            loadedBindings.set(input.id, loadedBinding);
            registeredBindings = [...registeredBindings, loadedBinding.binding];
            lastOperation = `Added binding '${input.id}'`;

            thing.emitPropertyChange("registeredBindings");
            thing.emitPropertyChange("lastOperation");
            thing.emitEvent("bindingAdded", { id: input.id });

            return {
                result: true,
                message: `Binding '${input.id}' loaded with schemes ${loadedBinding.binding.provides.schemes.join(", ")}.`,
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

    thing.setActionHandler("checkBindingCompatibility", async (params?: WoT.InteractionOutput | null) => {
        const input = params == null ? undefined : ((await params.value()) as { id: string });

        if (typeof input?.id !== "string" || input.id.length === 0) {
            return {
                id: "",
                compatible: false,
                missingRequirements: [],
                conflicts: [],
                message: "Binding id is required.",
            };
        }

        try {
            const { manifest } = readBindingManifest(input.id);
            const compatibility = checkBindingCompatibility(manifest, runtimeCapabilities, getCurrentRuntimeState());

            return {
                id: input.id,
                compatible: compatibility.compatible,
                missingRequirements: compatibility.missingRequirements,
                conflicts: compatibility.conflicts,
            };
        } catch (error) {
            return {
                id: input.id,
                compatible: false,
                missingRequirements: [error instanceof Error ? error.message : `Failed to check binding '${input.id}'.`],
                conflicts: [],
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
