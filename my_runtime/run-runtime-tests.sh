#!/usr/bin/env bash

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
SIMPLE_HOST="${SIMPLE_HOST:-127.0.0.1}"
SIMPLE_PORT="${SIMPLE_PORT:-8091}"
SIMPLE_BASE_URL="${SIMPLE_BASE_URL:-http://$SIMPLE_HOST:$SIMPLE_PORT}"
NEW_HOST="${NEW_HOST:-127.0.0.1}"
NEW_PORT="${NEW_PORT:-8092}"
COAP_HOST="${COAP_HOST:-127.0.0.1}"
COAP_PORT="${COAP_PORT:-5684}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINDINGS_DIR="$ROOT_DIR/my_bindings"

cd "$ROOT_DIR"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
CURRENT_OUTPUT=""

export SIMPLE_HOST SIMPLE_PORT

green=$'\033[32m'
red=$'\033[31m'
yellow=$'\033[33m'
blue=$'\033[34m'
reset=$'\033[0m'

section() {
    printf "\n%s== %s ==%s\n" "$blue" "$1" "$reset"
}

pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    printf "%s✅ PASS%s %s\n" "$green" "$reset" "$1"
}

fail() {
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf "%s❌ FAIL%s %s\n" "$red" "$reset" "$1"
    if [[ -n "${2:-}" ]]; then
        printf "        %s\n" "$2"
    fi
}

skip() {
    SKIP_COUNT=$((SKIP_COUNT + 1))
    printf "%s⚠ SKIP%s %s\n" "$yellow" "$reset" "$1"
    if [[ -n "${2:-}" ]]; then
        printf "        %s\n" "$2"
    fi
}

run_capture() {
    local name="$1"
    shift

    local output
    if output="$("$@" 2>&1)"; then
        CURRENT_OUTPUT="$output"
        pass "$name"
        return 0
    fi

    CURRENT_OUTPUT="$output"
    fail "$name" "$output"
    return 1
}

expect_failure() {
    local name="$1"
    shift

    local output
    if output="$("$@" 2>&1)"; then
        CURRENT_OUTPUT="$output"
        fail "$name" "Command unexpectedly succeeded: $output"
        return 1
    fi

    CURRENT_OUTPUT="$output"
    pass "$name"
    return 0
}

require_command() {
    local command_name="$1"

    if command -v "$command_name" >/dev/null 2>&1; then
        pass "Command available: $command_name"
        return 0
    fi

    fail "Command available: $command_name" "Install '$command_name' before running this test script."
    return 1
}

require_coap_package() {
    if (cd "$ROOT_DIR/packages/binding-coap" && node -e 'require.resolve("coap")' >/dev/null 2>&1); then
        pass "Node package available: coap"
        return 0
    fi

    fail "Node package available: coap" "Run 'npm install' in the repository root before executing the CoAP tests."
    return 1
}

http_get() {
    local path="$1"
    curl -fsS --max-time 8 "$BASE_URL$path"
}

simple_get() {
    local path="$1"
    curl -fsS --max-time 8 "$SIMPLE_BASE_URL$path"
}

action() {
    local action_name="$1"
    local payload="$2"

    curl -fsS --max-time 12 \
        -X POST "$BASE_URL/runtime/actions/$action_name" \
        -H "Content-Type: application/json" \
        --data "$payload"
}

json_assert() {
    local name="$1"
    local json="$2"
    local expression="$3"

    if JSON_INPUT="$json" node -e '
const data = JSON.parse(process.env.JSON_INPUT);
const expression = process.argv[1];
if (!eval(expression)) {
    process.exit(1);
}
' "$expression" >/dev/null 2>&1; then
        pass "$name"
        return 0
    fi

    fail "$name" "$json"
    return 1
}

contains_assert() {
    local name="$1"
    local haystack="$2"
    local needle="$3"

    if [[ "$haystack" == *"$needle"* ]]; then
        pass "$name"
        return 0
    fi

    fail "$name" "Expected output to contain: $needle; got: $haystack"
    return 1
}

cleanup_binding() {
    local binding_id="$1"
    action removeBinding "{\"id\":\"$binding_id\"}" >/dev/null 2>&1 || true
}

cleanup_deployed_binding() {
    local binding_id="$1"
    cleanup_binding "$binding_id"
    action deleteBinding "{\"id\":\"$binding_id\"}" >/dev/null 2>&1 || true
}

create_deployment_payload() {
    local binding_id="$1"

    BINDING_DIR="$BINDINGS_DIR/$binding_id" node -e '
const fs = require("fs");
const path = require("path");
const basePath = process.env.BINDING_DIR;
const manifest = JSON.parse(fs.readFileSync(path.join(basePath, "manifest.json"), "utf8"));
const source = fs.readFileSync(path.join(basePath, "index.js"), "utf8");
process.stdout.write(JSON.stringify({ manifest, source }));
'
}

create_negative_deployment_payload() {
    local scenario="$1"

    NEGATIVE_SCENARIO="$scenario" node -e '
const scenario = process.env.NEGATIVE_SCENARIO;
const id = `${scenario}-binding`;
const scheme = `negative-${scenario}`;
const manifest = {
    id,
    name: `Negative ${scenario} Binding`,
    version: "1.0.0",
    description: `Negative deployment test for ${scenario}.`,
    entrypoint: "./index.js",
    provides: {
        schemes: [scheme],
        roles: ["client"],
        interactions: ["readThingDescription"]
    },
    requires: {
        interfaces: [
            {
                type: "stream-socket",
                direction: "client",
                operations: ["connect", "close"]
            }
        ],
        resources: {
            ports: []
        }
    }
};

let source = `"use strict";
class TestClientFactory {
    constructor() { this.scheme = ${JSON.stringify(scheme)}; }
    getClient() { return {}; }
    init() { return true; }
    destroy() { return true; }
}
module.exports.createBinding = () => ({
    id: ${JSON.stringify(id)},
    createClientFactory: () => new TestClientFactory()
});
`;

if (scenario === "manifest-string") {
    process.stdout.write(JSON.stringify({ manifest: JSON.stringify(manifest), source }));
    process.exit(0);
}

if (scenario === "empty-source") {
    source = "";
} else if (scenario === "invalid-id") {
    manifest.id = "../invalid-binding";
} else if (scenario === "invalid-interface") {
    manifest.requires.interfaces[0].type = "invalid-interface";
} else if (scenario === "invalid-entrypoint") {
    manifest.entrypoint = "../index.js";
} else if (scenario === "missing-interface") {
    manifest.requires.interfaces = [{ type: "protocol-stack", protocol: "amqp", direction: "client" }];
} else if (scenario === "scheme-conflict") {
    manifest.provides.schemes = ["simple"];
} else if (scenario === "port-conflict") {
    manifest.requires.resources.ports = [{ transport: "tcp", preferred: 8091, required: true, exclusive: true }];
} else if (scenario === "syntax-error") {
    source = "module.exports = {";
} else if (scenario === "missing-export") {
    source = "module.exports = {};";
} else if (scenario === "id-mismatch") {
    source = `module.exports.createBinding = () => ({ id: "different-binding" });`;
}

process.stdout.write(JSON.stringify({ manifest, source }));
'
}

test_rejected_deployment() {
    local scenario="$1"
    local binding_id="$2"
    local rejection_expression="$3"
    local description="$4"
    local payload

    if run_capture "Create $description payload" create_negative_deployment_payload "$scenario"; then
        payload="$CURRENT_OUTPUT"

        if run_capture "Reject $description" action deployBinding "$payload"; then
            json_assert "$description is rejected" "$CURRENT_OUTPUT" "$rejection_expression"
        fi
    fi

    if [[ -n "$binding_id" ]] && run_capture "Check $description left no deployable binding" action addBinding "{\"id\":\"$binding_id\"}"; then
        json_assert "$description leaves no deployment artifact" "$CURRENT_OUTPUT" 'data.result === false && data.message.includes("was not found")'
    fi
}

test_rejected_compatibility_check() {
    local scenario="$1"
    local binding_id="$2"
    local rejection_expression="$3"
    local description="$4"
    local payload

    if run_capture "Create $description compatibility payload" create_negative_deployment_payload "$scenario"; then
        payload="$CURRENT_OUTPUT"

        if run_capture "Reject $description during compatibility check" action checkBindingCompatibility "$payload"; then
            json_assert "$description is reported as incompatible" "$CURRENT_OUTPUT" "$rejection_expression"
        fi
    fi

    if run_capture "Check compatibility test did not store $description" action addBinding "{\"id\":\"$binding_id\"}"; then
        json_assert "$description remains not deployed after compatibility check" "$CURRENT_OUTPUT" 'data.result === false && data.message.includes("was not found")'
    fi
}

coap_request() {
    local uri="$1"
    local accept="${2:-}"

    (cd "$ROOT_DIR/packages/binding-coap" && COAP_URI="$uri" COAP_ACCEPT="$accept" node -e '
const coap = require("coap");
const uri = process.env.COAP_URI;
const accept = process.env.COAP_ACCEPT;

const req = coap.request(uri);
if (accept) {
    req.setOption("Accept", accept);
}

const timer = setTimeout(() => {
    console.error("CoAP request timed out.");
    process.exit(1);
}, 6000);

req.on("response", (res) => {
    let out = "";
    res.on("data", (chunk) => {
        out += chunk;
    });
    res.on("end", () => {
        clearTimeout(timer);
        console.log(out);
    });
});

req.on("error", (error) => {
    clearTimeout(timer);
    console.error(error.message);
    process.exit(1);
});

req.end();
')
}

new_request() {
    local payload="$1"

    NEW_HOST="$NEW_HOST" NEW_PORT="$NEW_PORT" NEW_PAYLOAD="$payload" node -e '
const net = require("net");
const host = process.env.NEW_HOST;
const port = Number(process.env.NEW_PORT);
const payload = process.env.NEW_PAYLOAD;
const socket = net.connect(port, host);
let out = "";

const timer = setTimeout(() => {
    console.error("New binding TCP request timed out.");
    process.exit(1);
}, 6000);

socket.setEncoding("utf8");
socket.on("connect", () => {
    socket.write(`${payload}\n`);
});
socket.on("data", (chunk) => {
    out += chunk;
    const newlineIndex = out.indexOf("\n");

    if (newlineIndex === -1) {
        return;
    }

    clearTimeout(timer);
    socket.end();

    const response = JSON.parse(out.slice(0, newlineIndex));
    if (response.ok !== true) {
        console.error(response.error || "New binding request failed.");
        process.exit(1);
    }

    console.log(Buffer.from(response.body || "", "base64").toString("utf8"));
});
socket.on("error", (error) => {
    clearTimeout(timer);
    console.error(error.message);
    process.exit(1);
});
'
}

section "Preflight"
require_command curl
require_command node
require_coap_package

if [[ "$FAIL_COUNT" -gt 0 ]]; then
    printf "\nPreflight failed. Aborting.\n"
    exit 1
fi

section "Runtime Reachability"
RUNTIME_REACHABILITY_FAILED="$FAIL_COUNT"
if run_capture "Runtime TD reachable" http_get "/runtime"; then
    json_assert "Runtime TD contains title Runtime" "$CURRENT_OUTPUT" 'data.title === "Runtime"'
fi

if [[ "$FAIL_COUNT" -gt "$RUNTIME_REACHABILITY_FAILED" ]]; then
    printf "\nRuntime is not reachable or does not expose the expected TD at %s/runtime.\n" "$BASE_URL"
    printf "Start the runtime first with the docker command documented in my_runtime/README.md, then run this script again.\n"
    exit 1
fi

section "Initial Cleanup"
cleanup_deployed_binding simple-binding
cleanup_deployed_binding coap-binding
cleanup_deployed_binding new-binding
cleanup_deployed_binding wrong-binding
cleanup_deployed_binding missing-interface-binding
cleanup_deployed_binding manifest-string-binding
cleanup_deployed_binding empty-source-binding
cleanup_deployed_binding invalid-interface-binding
cleanup_deployed_binding invalid-entrypoint-binding
cleanup_deployed_binding scheme-conflict-binding
cleanup_deployed_binding port-conflict-binding
cleanup_deployed_binding syntax-error-binding
cleanup_deployed_binding missing-export-binding
cleanup_deployed_binding id-mismatch-binding
pass "Best-effort cleanup completed"

section "Runtime Properties"
if run_capture "Read status property" http_get "/runtime/properties/status"; then
    contains_assert "Status indicates running" "$CURRENT_OUTPUT" "running"
fi

if run_capture "Read registeredBindings property" http_get "/runtime/properties/registeredBindings"; then
    json_assert "registeredBindings is an array" "$CURRENT_OUTPUT" 'Array.isArray(data)'
fi

if run_capture "Read bindingStates property" http_get "/runtime/properties/bindingStates"; then
    json_assert "bindingStates is an array" "$CURRENT_OUTPUT" 'Array.isArray(data)'
fi

if run_capture "Read runtimeCapabilities property" http_get "/runtime/properties/runtimeCapabilities"; then
    json_assert "runtimeCapabilities exposes interfaces" "$CURRENT_OUTPUT" 'Array.isArray(data.interfaces) && data.interfaces.length > 0'
    json_assert "runtimeCapabilities exposes supported bindings" "$CURRENT_OUTPUT" 'data.supportedBindings && Array.isArray(data.supportedBindings.activeNative.clients) && Array.isArray(data.supportedBindings.activeNative.servers) && Array.isArray(data.supportedBindings.loaded.clients) && Array.isArray(data.supportedBindings.loaded.servers)'
    json_assert "runtimeCapabilities exposes active native mqtt client support" "$CURRENT_OUTPUT" 'data.supportedBindings.activeNative.clients.some((client) => client.scheme === "mqtt") && data.interfaces.some((item) => item.type === "protocol-stack" && item.protocol === "mqtt" && item.direction.includes("client"))'
fi

section "WoT Binding Deployment"
if run_capture "Loading simple-binding before deployment fails" action addBinding '{"id":"simple-binding"}'; then
    json_assert "simple-binding is initially absent from runtime storage" "$CURRENT_OUTPUT" 'data.result === false && data.message.includes("was not found")'
fi

if run_capture "Create simple-binding deployment payload" create_deployment_payload simple-binding; then
    DEPLOYMENT_PAYLOAD="$CURRENT_OUTPUT"

    if run_capture "Check external simple-binding package compatibility" action checkBindingCompatibility "$DEPLOYMENT_PAYLOAD"; then
        json_assert "external simple-binding package is compatible" "$CURRENT_OUTPUT" 'data.id === "simple-binding" && data.compatible === true && data.missingRequirements.length === 0 && data.conflicts.length === 0'
    fi

    if run_capture "Read bindingStates after compatibility check" http_get "/runtime/properties/bindingStates"; then
        json_assert "compatibility check leaves simple-binding not deployed" "$CURRENT_OUTPUT" 'data.every((binding) => binding.id !== "simple-binding")'
    fi

    if run_capture "Deploy and load transferred simple-binding" action deployBinding "$DEPLOYMENT_PAYLOAD"; then
        json_assert "deployBinding result is true" "$CURRENT_OUTPUT" 'data.result === true'
    fi
fi

if run_capture "Read active simple-binding state" http_get "/runtime/properties/bindingStates"; then
    json_assert "deployed simple-binding state is active" "$CURRENT_OUTPUT" 'data.some((binding) => binding.id === "simple-binding" && binding.state === "active")'
fi

if run_capture "registeredBindings contains deployed simple-binding" http_get "/runtime/properties/registeredBindings"; then
    json_assert "deployed simple-binding is registered" "$CURRENT_OUTPUT" 'data.some((binding) => binding.id === "simple-binding")'
fi

if run_capture "Reject deletion while deployed binding is loaded" action deleteBinding '{"id":"simple-binding"}'; then
    json_assert "loaded deployed binding must be removed before deletion" "$CURRENT_OUTPUT" 'data.result === false && data.message.includes("currently loaded")'
fi

if run_capture "Remove deployed simple-binding" action removeBinding '{"id":"simple-binding"}'; then
    json_assert "deployed simple-binding remove result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

if run_capture "registeredBindings excludes removed simple-binding" http_get "/runtime/properties/registeredBindings"; then
    json_assert "removed simple-binding is no longer registered" "$CURRENT_OUTPUT" 'data.every((binding) => binding.id !== "simple-binding")'
fi

if run_capture "Read stored simple-binding state" http_get "/runtime/properties/bindingStates"; then
    json_assert "removed simple-binding state is stored" "$CURRENT_OUTPUT" 'data.some((binding) => binding.id === "simple-binding" && binding.state === "stored")'
fi

if run_capture "Reject duplicate deployment of installed simple-binding" action deployBinding "$DEPLOYMENT_PAYLOAD"; then
    json_assert "duplicate deployment is rejected without replacing installed files" "$CURRENT_OUTPUT" 'data.result === false && data.message.includes("already deployed")'
fi

if run_capture "Recheck sender-side simple-binding package compatibility" action checkBindingCompatibility "$DEPLOYMENT_PAYLOAD"; then
    json_assert "stored runtime copy is not used by compatibility check" "$CURRENT_OUTPUT" 'data.id === "simple-binding" && data.compatible === true && data.missingRequirements.length === 0 && data.conflicts.length === 0'
fi

if run_capture "Reload deployed simple-binding with addBinding" action addBinding '{"id":"simple-binding"}'; then
    json_assert "deployed simple-binding reload result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

if run_capture "Remove reloaded simple-binding" action removeBinding '{"id":"simple-binding"}'; then
    json_assert "reloaded simple-binding remove result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

if run_capture "Delete deployed simple-binding" action deleteBinding '{"id":"simple-binding"}'; then
    json_assert "deployed simple-binding delete result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

if run_capture "Loading deleted simple-binding fails" action addBinding '{"id":"simple-binding"}'; then
    json_assert "deleted simple-binding is no longer available" "$CURRENT_OUTPUT" 'data.result === false && data.message.includes("was not found")'
fi

if run_capture "Read bindingStates after deletion" http_get "/runtime/properties/bindingStates"; then
    json_assert "deleted simple-binding state is not deployed" "$CURRENT_OUTPUT" 'data.every((binding) => binding.id !== "simple-binding")'
fi

section "CoAP Binding"
if run_capture "Create coap-binding deployment payload" create_deployment_payload coap-binding; then
    COAP_DEPLOYMENT_PAYLOAD="$CURRENT_OUTPUT"

    if run_capture "Deploy coap-binding" action deployBinding "$COAP_DEPLOYMENT_PAYLOAD"; then
        json_assert "coap-binding deploy result is true" "$CURRENT_OUTPUT" 'data.result === true'
    fi
fi

if run_capture "registeredBindings contains coap-binding" http_get "/runtime/properties/registeredBindings"; then
    json_assert "coap-binding is registered" "$CURRENT_OUTPUT" 'data.some((binding) => binding.id === "coap-binding")'
fi

if run_capture "Read status over CoAP" coap_request "coap://$COAP_HOST:$COAP_PORT/runtime/properties/status"; then
    contains_assert "CoAP status indicates running" "$CURRENT_OUTPUT" "running"
fi

if run_capture "Read Runtime TD over CoAP" coap_request "coap://$COAP_HOST:$COAP_PORT/runtime" "application/td+json"; then
    json_assert "CoAP TD contains title Runtime" "$CURRENT_OUTPUT" 'data.title === "Runtime"'
fi

if run_capture "Remove coap-binding" action removeBinding '{"id":"coap-binding"}'; then
    json_assert "coap-binding remove result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

expect_failure "CoAP endpoint is unavailable after removal" coap_request "coap://$COAP_HOST:$COAP_PORT/runtime/properties/status"

section "Simple Binding"
if run_capture "Create simple-binding deployment payload" create_deployment_payload simple-binding; then
    SIMPLE_DEPLOYMENT_PAYLOAD="$CURRENT_OUTPUT"

    if run_capture "Deploy simple-binding" action deployBinding "$SIMPLE_DEPLOYMENT_PAYLOAD"; then
        json_assert "simple-binding deploy result is true" "$CURRENT_OUTPUT" 'data.result === true'
    fi
fi

if run_capture "registeredBindings contains simple-binding" http_get "/runtime/properties/registeredBindings"; then
    json_assert "simple-binding is registered" "$CURRENT_OUTPUT" 'data.some((binding) => binding.id === "simple-binding")'
fi

if run_capture "Read Runtime TD over Simple server" simple_get "/runtime"; then
    json_assert "Simple server TD contains title Runtime" "$CURRENT_OUTPUT" 'data.title === "Runtime"'
fi

if run_capture "Read status over Simple server" simple_get "/runtime/properties/status"; then
    contains_assert "Simple server status indicates running" "$CURRENT_OUTPUT" "running"
fi

if run_capture "Read registeredBindings over Simple server" simple_get "/runtime/properties/registeredBindings"; then
    json_assert "Simple server registeredBindings is an array" "$CURRENT_OUTPUT" 'Array.isArray(data)'
fi

run_capture "Simple client smoke test" node "$ROOT_DIR/my_runtime/simple-client-test.js"

if run_capture "Simple client reads TD" node "$ROOT_DIR/my_runtime/simple-client-test.js" td; then
    json_assert "Simple client TD contains title Runtime" "$CURRENT_OUTPUT" 'data.title === "Runtime"'
fi

if run_capture "Simple client reads status" node "$ROOT_DIR/my_runtime/simple-client-test.js" read status; then
    contains_assert "Simple client status indicates running" "$CURRENT_OUTPUT" "running"
fi

if run_capture "Simple client reads registeredBindings" node "$ROOT_DIR/my_runtime/simple-client-test.js" read registeredBindings; then
    json_assert "Simple client registeredBindings is an array" "$CURRENT_OUTPUT" 'Array.isArray(data)'
fi

if run_capture "Simple client adds coap-binding" node "$ROOT_DIR/my_runtime/simple-client-test.js" action addBinding '{"id":"coap-binding"}'; then
    json_assert "Simple client add coap result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

if run_capture "Simple client removes coap-binding" node "$ROOT_DIR/my_runtime/simple-client-test.js" action removeBinding '{"id":"coap-binding"}'; then
    json_assert "Simple client remove coap result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

section "New Raw TCP Binding"
if run_capture "Create new-binding deployment payload" create_deployment_payload new-binding; then
    NEW_DEPLOYMENT_PAYLOAD="$CURRENT_OUTPUT"

    if run_capture "Deploy new-binding" action deployBinding "$NEW_DEPLOYMENT_PAYLOAD"; then
        json_assert "new-binding deploy result is true" "$CURRENT_OUTPUT" 'data.result === true'
    fi
fi

if run_capture "registeredBindings contains new-binding" http_get "/runtime/properties/registeredBindings"; then
    json_assert "new-binding is registered" "$CURRENT_OUTPUT" 'data.some((binding) => binding.id === "new-binding")'
fi

if run_capture "Read Runtime TD over new raw TCP binding" new_request '{"op":"readThingDescription","path":"runtime"}'; then
    json_assert "New binding TD contains title Runtime" "$CURRENT_OUTPUT" 'data.title === "Runtime"'
fi

if run_capture "Read status over new raw TCP binding" new_request '{"op":"readProperty","path":"runtime","name":"status"}'; then
    contains_assert "New binding status indicates running" "$CURRENT_OUTPUT" "running"
fi

if run_capture "Remove new-binding" action removeBinding '{"id":"new-binding"}'; then
    json_assert "new-binding remove result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

expect_failure "New raw TCP endpoint is unavailable after removal" new_request '{"op":"readProperty","path":"runtime","name":"status"}'

section "Negative Deployment Input Validation"
if run_capture "Create string-encoded manifest payload" create_negative_deployment_payload manifest-string; then
    MANIFEST_STRING_PAYLOAD="$CURRENT_OUTPUT"

    expect_failure "Reject string-encoded manifest at WoT input validation" \
        action deployBinding "$MANIFEST_STRING_PAYLOAD"
fi

if run_capture "Check string-encoded manifest left no deployable binding" \
    action addBinding '{"id":"manifest-string-binding"}'; then
    json_assert "string-encoded manifest leaves no deployment artifact" "$CURRENT_OUTPUT" \
        'data.result === false && data.message.includes("was not found")'
fi

test_rejected_deployment \
    empty-source \
    empty-source-binding \
    'data.result === false && data.message.includes("non-empty JavaScript source")' \
    "empty binding source"

test_rejected_deployment \
    invalid-id \
    "" \
    'data.result === false && data.message.includes("only lowercase letters, numbers and hyphens")' \
    "invalid binding id"

test_rejected_deployment \
    invalid-interface \
    invalid-interface-binding \
    'data.result === false && data.message.includes("type is not supported")' \
    "unsupported interface type"

test_rejected_deployment \
    invalid-entrypoint \
    invalid-entrypoint-binding \
    'data.result === false && data.message.includes("must use index.js")' \
    "unsafe binding entrypoint"

section "Negative Deployment Compatibility"
if run_capture "Compatibility conflict for external simple-binding package" action checkBindingCompatibility "$SIMPLE_DEPLOYMENT_PAYLOAD"; then
    json_assert "simple-binding conflict is reported" "$CURRENT_OUTPUT" 'data.compatible === false && data.conflicts.length > 0'
fi


test_rejected_compatibility_check \
    missing-interface \
    missing-interface-binding \
    'data.compatible === false && data.missingRequirements.some((item) => item.includes("protocol=amqp"))' \
    "missing protocol-stack requirement"

test_rejected_deployment \
    missing-interface \
    missing-interface-binding \
    'data.result === false && data.missingRequirements.some((item) => item.includes("protocol=amqp"))' \
    "missing protocol-stack requirement"

test_rejected_deployment \
    scheme-conflict \
    scheme-conflict-binding \
    'data.result === false && data.conflicts.some((item) => item.includes("Scheme") && item.includes("simple"))' \
    "conflicting URI scheme"

test_rejected_deployment \
    port-conflict \
    port-conflict-binding \
    'data.result === false && data.conflicts.some((item) => item.includes("Port 8091"))' \
    "conflicting required port"

section "Negative Module Loading and Rollback"
test_rejected_deployment \
    syntax-error \
    syntax-error-binding \
    'data.result === false && typeof data.message === "string" && data.message.length > 0' \
    "syntactically invalid entrypoint"

test_rejected_deployment \
    missing-export \
    missing-export-binding \
    'data.result === false && data.message.includes("does not export createBinding")' \
    "missing createBinding export"

test_rejected_deployment \
    id-mismatch \
    id-mismatch-binding \
    'data.result === false && data.message.includes("does not match requested id")' \
    "mismatching entrypoint binding id"

if run_capture "Create wrong-binding deployment payload" create_deployment_payload wrong-binding; then
    WRONG_DEPLOYMENT_PAYLOAD="$CURRENT_OUTPUT"

    if run_capture "wrong-binding deployment fails by validation" action deployBinding "$WRONG_DEPLOYMENT_PAYLOAD"; then
        json_assert "wrong-binding reports invalid client factory" "$CURRENT_OUTPUT" 'data.result === false && data.message.includes("invalid client factory")'
    fi
fi

if run_capture "Failed wrong-binding deployment is rolled back" action addBinding '{"id":"wrong-binding"}'; then
    json_assert "wrong-binding is absent after rollback" "$CURRENT_OUTPUT" 'data.result === false && data.message.includes("was not found")'
fi

section "Simple Binding Cleanup"
if run_capture "Remove simple-binding" action removeBinding '{"id":"simple-binding"}'; then
    json_assert "simple-binding remove result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

expect_failure "Simple server is unavailable after removal" simple_get "/runtime/properties/status"

section "Final Cleanup"
cleanup_deployed_binding simple-binding
cleanup_deployed_binding coap-binding
cleanup_deployed_binding new-binding
cleanup_deployed_binding wrong-binding
cleanup_deployed_binding missing-interface-binding
cleanup_deployed_binding manifest-string-binding
cleanup_deployed_binding empty-source-binding
cleanup_deployed_binding invalid-interface-binding
cleanup_deployed_binding invalid-entrypoint-binding
cleanup_deployed_binding scheme-conflict-binding
cleanup_deployed_binding port-conflict-binding
cleanup_deployed_binding syntax-error-binding
cleanup_deployed_binding missing-export-binding
cleanup_deployed_binding id-mismatch-binding
pass "Final cleanup completed"

section "Summary"
printf "%s✅ Passed:%s %d\n" "$green" "$reset" "$PASS_COUNT"
printf "%s❌ Failed:%s %d\n" "$red" "$reset" "$FAIL_COUNT"
printf "%s⚠ Skipped:%s %d\n" "$yellow" "$reset" "$SKIP_COUNT"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
    exit 1
fi
