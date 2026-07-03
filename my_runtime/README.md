# Runtime Prototype

This directory contains the WoT runtime prototype for the dynamic protocol binding loading demo. The runtime is exposed as a WoT Thing and provides management actions for checking, loading, and removing protocol bindings at runtime.

## Contents

- [1. Overview](#1-overview)
- [2. Prerequisites](#2-prerequisites)
- [3. Start the Runtime](#3-start-the-runtime)
- [4. Runtime Thing](#4-runtime-thing)
- [5. Binding Manifest Model](#5-binding-manifest-model)
- [6. Management Flow](#6-management-flow)
- [7. Available Demo Bindings](#7-available-demo-bindings)
  - [7.1 CoAP Binding](#71-coap-binding)
  - [7.2 Simple Binding](#72-simple-binding)
  - [7.3 New Raw TCP Binding](#73-new-raw-tcp-binding)
- [8. Negative Tests](#8-negative-tests)
  - [8.1 Already Loaded Binding](#81-already-loaded-binding)
  - [8.2 Missing Runtime Interface](#82-missing-runtime-interface)
  - [8.3 Invalid Binding Implementation](#83-invalid-binding-implementation)
- [9. Automated Tests](#9-automated-tests)

## 1. Overview

The prototype consists of:

- `runtime.ts`: the management runtime exposed as the WoT Thing `Runtime`
- `bindings/*`: dynamically loadable binding examples
- `simple-client-test.js`: a small test client for the Simple Binding
- `run-runtime-tests.sh`: scripted checks for the documented flows

The runtime itself does not simulate industrial devices. It manages protocol bindings in the active node-wot Servient. The presentation scenario in `../my_presentation` uses this runtime together with an application Thing and simulated devices.

## 2. Prerequisites

Install the repository dependencies from the repository root:

```bash
npm install
```

If the Docker image is not available yet, build it from the repository root:

```bash
npm run build:docker
```

Rebuilding the Docker image is usually only required after changes to `packages/cli/*`, `packages/core/*`, or the `Dockerfile`. Changes below `my_runtime/runtime.ts` or `my_runtime/bindings/*` are mounted into the container at startup.

## 3. Start the Runtime

Start the runtime through the node-wot CLI in Docker:

```bash
docker run -it --init \
  -p 8080:8080/tcp \
  -p 8091:8091/tcp \
  -p 8092:8092/tcp \
  -p 5683:5683/udp \
  -p 5684:5684/udp \
  -e TS_NODE_PROJECT=/workspace/my_runtime/tsconfig.json \
  -e TS_NODE_FILES=true \
  -v "$(pwd):/workspace" \
  --rm \
  node-wot /workspace/my_runtime/runtime.ts
```

Relevant ports:

| Port | Transport | Purpose |
| --- | --- | --- |
| `8080` | TCP | HTTP access to the management runtime |
| `8091` | TCP | dynamically loaded Simple Binding server |
| `8092` | TCP | dynamically loaded New Raw TCP Binding server |
| `5683` | UDP | default node-wot CoAP server |
| `5684` | UDP | dynamically loaded CoAP Binding server |

## 4. Runtime Thing

The runtime is exposed as a WoT Thing named `Runtime`.

| Resource | Browser link | Command |
| --- | --- | --- |
| Thing Description | <http://localhost:8080/runtime> | `curl http://localhost:8080/runtime` |
| Status | <http://localhost:8080/runtime/properties/status> | `curl http://localhost:8080/runtime/properties/status` |
| Registered bindings | <http://localhost:8080/runtime/properties/registeredBindings> | `curl http://localhost:8080/runtime/properties/registeredBindings` |
| Runtime capabilities | <http://localhost:8080/runtime/properties/runtimeCapabilities> | `curl http://localhost:8080/runtime/properties/runtimeCapabilities` |

`runtimeCapabilities.interfaces` lists the host interfaces and active native protocol stacks available to dynamic bindings. `runtimeCapabilities.supportedBindings.activeNative` lists native node-wot bindings already registered in the active Servient. `runtimeCapabilities.supportedBindings.loaded` lists dynamically loaded bindings.

## 5. Binding Manifest Model

Each binding below `my_runtime/bindings/<binding-id>` contains a `manifest.json`. The manifest separates the upper WoT-facing side from the lower runtime/platform requirements.

`provides` describes what the binding adds to the WoT runtime:

```json
{
  "schemes": ["simple"],
  "roles": ["client", "server"],
  "interactions": ["readThingDescription", "readProperty", "writeProperty", "invokeAction"]
}
```

`requires` describes what the host runtime or platform must provide:

```json
{
  "interfaces": [
    {
      "type": "protocol-stack",
      "protocol": "http",
      "direction": "server"
    }
  ],
  "resources": {
    "ports": [
      {
        "transport": "tcp",
        "preferred": 8091,
        "required": true,
        "exclusive": true
      }
    ]
  }
}
```

Socket-based bindings can also declare required operations:

```json
{
  "interfaces": [
    {
      "type": "stream-socket",
      "direction": "client-server",
      "operations": ["listen", "accept", "connect", "send", "receive", "close"]
    }
  ]
}
```

Before loading a binding, the runtime validates the manifest and checks whether all requirements are compatible with the current runtime capabilities and resource state.

## 6. Management Flow

Check whether a binding can be loaded:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/checkBindingCompatibility \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

Expected shape for a compatible binding:

```json
{
  "id": "simple-binding",
  "compatible": true,
  "missingRequirements": [],
  "conflicts": []
}
```

Load a binding:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

Check loaded bindings:

Open: <http://localhost:8080/runtime/properties/registeredBindings>

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
```

Remove a binding:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

## 7. Available Demo Bindings

### 7.1 CoAP Binding

Location:

```text
my_runtime/bindings/coap-binding
```

This binding exposes the runtime through an additional CoAP server on `5684/udp`.

Load:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"coap-binding"}'
```

Remove:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"coap-binding"}'
```

### 7.2 Simple Binding

Location:

```text
my_runtime/bindings/simple-binding
```

This binding provides a small custom client/server pair for the `simple` scheme. The server listens on `8091/tcp`.

Load:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

Remove:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

### 7.3 New Raw TCP Binding

Location:

```text
my_runtime/bindings/new-binding
```

This binding provides a custom `new` scheme over a minimal JSON-line protocol on a TCP stream socket. The server listens on `8092/tcp`. It is the binding used by the presentation scenario when the replacement meter no longer speaks CoAP.

Load:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"new-binding"}'
```

Remove:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"new-binding"}'
```

## 8. Negative Tests

### 8.1 Already Loaded Binding

If `simple-binding` is already loaded, another compatibility check for the same binding reports conflicts such as the registered `simple` scheme and the occupied port `8091`.

```bash
curl -i -X POST http://localhost:8080/runtime/actions/checkBindingCompatibility \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

### 8.2 Missing Runtime Interface

A binding manifest with an unavailable interface produces a missing requirement. Example:

```json
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
        "protocol": "amqp",
        "direction": "client"
      }
    ],
    "resources": {
      "ports": []
    }
  }
}
```

Because the runtime currently provides no `amqp` protocol stack in `runtimeCapabilities.interfaces`, `checkBindingCompatibility` reports this requirement as missing.

### 8.3 Invalid Binding Implementation

The `wrong-binding` binding is an intentionally invalid negative example:

```text
my_runtime/bindings/wrong-binding
```

Its manifest is formally valid and compatible, but the entry point returns an invalid ClientFactory without a `getClient()` method. The compatibility check should succeed, while the actual load through `addBinding` should fail.

Compatibility check:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/checkBindingCompatibility \
  -H "Content-Type: application/json" \
  --data '{"id":"wrong-binding"}'
```

Load attempt:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"wrong-binding"}'
```

Expected error:

```text
Binding 'wrong-binding' returned an invalid client factory.
```

## 9. Automated Tests

The script `my_runtime/run-runtime-tests.sh` executes the documented runtime, binding, and negative tests automatically. A running runtime at <http://localhost:8080/runtime> is required.

```bash
./my_runtime/run-runtime-tests.sh
```
