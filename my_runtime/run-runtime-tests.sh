#!/usr/bin/env bash

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
SIMPLE_BASE_URL="${SIMPLE_BASE_URL:-http://localhost:8091}"
COAP_HOST="${COAP_HOST:-127.0.0.1}"
COAP_PORT="${COAP_PORT:-5684}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MISSING_BINDING_DIR="$ROOT_DIR/my_runtime/bindings/missing-interface-binding"

cd "$ROOT_DIR"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
CURRENT_OUTPUT=""

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

create_missing_interface_binding() {
    mkdir -p "$MISSING_BINDING_DIR"
    cat > "$MISSING_BINDING_DIR/manifest.json" <<'JSON'
{
    "id": "missing-interface-binding",
    "name": "Missing Interface Binding",
    "version": "1.0.0",
    "description": "Negative compatibility test.",
    "entrypoint": "./index.js",
    "provides": {
        "schemes": ["missing"],
        "roles": ["client"],
        "interactions": ["readThingDescription"]
    },
    "requires": {
        "interfaces": [
            {
                "type": "protocol-stack",
                "protocol": "mqtt",
                "direction": "client",
                "transport": "tcp",
                "profile": "library-backed"
            }
        ],
        "resources": {
            "ports": []
        }
    }
}
JSON
    cat > "$MISSING_BINDING_DIR/index.js" <<'JS'
"use strict";

function createBinding() {
    return {
        id: "missing-interface-binding"
    };
}

module.exports = {
    createBinding
};
JS
}

remove_missing_interface_binding() {
    rm -rf "$MISSING_BINDING_DIR"
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
    printf "Start the runtime first with the docker command documented in my_runtime/read.md, then run this script again.\n"
    exit 1
fi

section "Initial Cleanup"
cleanup_binding simple-binding
cleanup_binding coap-binding
cleanup_binding example-binding
cleanup_binding wrong-binding
cleanup_binding missing-interface-binding
remove_missing_interface_binding
pass "Best-effort cleanup completed"

section "Runtime Properties"
if run_capture "Read status property" http_get "/runtime/properties/status"; then
    contains_assert "Status indicates running" "$CURRENT_OUTPUT" "running"
fi

run_capture "Read lastOperation property" http_get "/runtime/properties/lastOperation"

if run_capture "Read registeredBindings property" http_get "/runtime/properties/registeredBindings"; then
    json_assert "registeredBindings is an array" "$CURRENT_OUTPUT" 'Array.isArray(data)'
fi

if run_capture "Read runtimeCapabilities property" http_get "/runtime/properties/runtimeCapabilities"; then
    json_assert "runtimeCapabilities exposes interfaces" "$CURRENT_OUTPUT" 'Array.isArray(data.interfaces) && data.interfaces.length > 0'
fi

section "Compatibility Check"
if run_capture "Check simple-binding compatibility" action checkBindingCompatibility '{"id":"simple-binding"}'; then
    json_assert "simple-binding is compatible" "$CURRENT_OUTPUT" 'data.compatible === true && data.missingRequirements.length === 0 && data.conflicts.length === 0'
fi

section "Example Binding"
if run_capture "Add example-binding" action addBinding '{"id":"example-binding"}'; then
    json_assert "example-binding add result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

if run_capture "registeredBindings contains example-binding" http_get "/runtime/properties/registeredBindings"; then
    json_assert "example-binding is registered" "$CURRENT_OUTPUT" 'data.some((binding) => binding.id === "example-binding")'
fi

if run_capture "Remove example-binding" action removeBinding '{"id":"example-binding"}'; then
    json_assert "example-binding remove result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

section "CoAP Binding"
if run_capture "Add coap-binding" action addBinding '{"id":"coap-binding"}'; then
    json_assert "coap-binding add result is true" "$CURRENT_OUTPUT" 'data.result === true'
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
if run_capture "Add simple-binding" action addBinding '{"id":"simple-binding"}'; then
    json_assert "simple-binding add result is true" "$CURRENT_OUTPUT" 'data.result === true'
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

if run_capture "Simple client adds example-binding" node "$ROOT_DIR/my_runtime/simple-client-test.js" action addBinding '{"id":"example-binding"}'; then
    json_assert "Simple client add example result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

if run_capture "Simple client removes example-binding" node "$ROOT_DIR/my_runtime/simple-client-test.js" action removeBinding '{"id":"example-binding"}'; then
    json_assert "Simple client remove example result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

section "Negative Tests"
if run_capture "Compatibility conflict for already loaded simple-binding" action checkBindingCompatibility '{"id":"simple-binding"}'; then
    json_assert "simple-binding conflict is reported" "$CURRENT_OUTPUT" 'data.compatible === false && data.conflicts.length > 0'
fi

create_missing_interface_binding
if run_capture "Compatibility fails for missing-interface-binding" action checkBindingCompatibility '{"id":"missing-interface-binding"}'; then
    json_assert "missing-interface-binding reports missing mqtt protocol stack" "$CURRENT_OUTPUT" 'data.compatible === false && data.missingRequirements.some((item) => item.includes("protocol=mqtt"))'
fi
remove_missing_interface_binding

if run_capture "wrong-binding compatibility is initially valid" action checkBindingCompatibility '{"id":"wrong-binding"}'; then
    json_assert "wrong-binding compatibility result is true" "$CURRENT_OUTPUT" 'data.compatible === true'
fi

if run_capture "wrong-binding add request fails by validation" action addBinding '{"id":"wrong-binding"}'; then
    json_assert "wrong-binding reports invalid client factory" "$CURRENT_OUTPUT" 'data.result === false && data.message.includes("invalid client factory")'
fi

section "Simple Binding Cleanup"
if run_capture "Remove simple-binding" action removeBinding '{"id":"simple-binding"}'; then
    json_assert "simple-binding remove result is true" "$CURRENT_OUTPUT" 'data.result === true'
fi

expect_failure "Simple server is unavailable after removal" simple_get "/runtime/properties/status"

section "Final Cleanup"
cleanup_binding simple-binding
cleanup_binding coap-binding
cleanup_binding example-binding
cleanup_binding wrong-binding
cleanup_binding missing-interface-binding
remove_missing_interface_binding
pass "Final cleanup completed"

section "Summary"
printf "%s✅ Passed:%s %d\n" "$green" "$reset" "$PASS_COUNT"
printf "%s❌ Failed:%s %d\n" "$red" "$reset" "$FAIL_COUNT"
printf "%s⚠ Skipped:%s %d\n" "$yellow" "$reset" "$SKIP_COUNT"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
    exit 1
fi
