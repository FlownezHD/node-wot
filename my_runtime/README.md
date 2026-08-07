# Runtime Prototype

This directory contains the WoT runtime prototype for the dynamic protocol binding deployment and loading demo. The runtime is exposed as a WoT Thing and provides management actions for transferring, checking, loading, removing, and deleting protocol bindings at runtime.

## Contents

- [1. Overview](#1-overview)
- [2. Prerequisites](#2-prerequisites)
- [3. Start the Runtime](#3-start-the-runtime)
- [4. Runtime Thing](#4-runtime-thing)
- [5. Binding Manifest Model](#5-binding-manifest-model)
- [6. Management Flow](#6-management-flow)
  - [6.1 Deploy a Binding through WoT](#61-deploy-a-binding-through-wot)
  - [6.2 Manage an Installed Binding](#62-manage-an-installed-binding)
- [7. Available Demo Bindings](#7-available-demo-bindings)
  - [7.1 CoAP Binding](#71-coap-binding)
  - [7.2 Simple Binding](#72-simple-binding)
  - [7.3 New Raw TCP Binding](#73-new-raw-tcp-binding)
  - [7.4 Deployable Example Binding](#74-deployable-example-binding)
- [8. Negative Tests](#8-negative-tests)
  - [8.1 Already Loaded Binding](#81-already-loaded-binding)
  - [8.2 Missing Runtime Interface](#82-missing-runtime-interface)
  - [8.3 Invalid Binding Implementation](#83-invalid-binding-implementation)
- [9. Automated Tests](#9-automated-tests)

## 1. Overview

The prototype consists of:

- `runtime.ts`: the management runtime exposed as the WoT Thing `Runtime`
- `bindings/*`: bindings bundled with the runtime and dynamically loadable by ID
- `deployable-bindings/*`: example packages that must be transferred through the `deployBinding` WoT action
- `deployed-bindings/*`: runtime-managed storage for transferred bindings
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

Rebuilding the Docker image is usually only required after changes to `packages/cli/*`, `packages/core/*`, or the `Dockerfile`. Changes below `my_runtime/*` are mounted into the container at startup.

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

The Runtime Thing provides the following lifecycle actions:

| Action | Purpose |
| --- | --- |
| `deployBinding` | Transfer a manifest and JavaScript entrypoint, install the binding, and load it |
| `checkBindingCompatibility` | Validate the requirements of an installed or bundled binding without loading it |
| `addBinding` | Load an already installed or bundled binding by ID |
| `removeBinding` | Unregister a loaded binding while retaining its files |
| `deleteBinding` | Delete an unloaded binding previously installed through `deployBinding` |

## 5. Binding Manifest Model

Each binding contains a `manifest.json`. Bundled bindings reside below `my_runtime/bindings/<binding-id>`, while transferred bindings are stored by the runtime below `my_runtime/deployed-bindings/<binding-id>`. The manifest separates the upper WoT-facing side from the lower runtime/platform requirements.

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

### 6.1 Deploy a Binding through WoT

`deployBinding` accepts the parsed manifest as an object and the complete JavaScript entrypoint as a string in one WoT action invocation. The runtime validates the package, checks its requirements, writes it to the dedicated deployment store, loads it, and registers its ClientFactory or Server in the active Servient.

The directory `my_runtime/deployable-bindings/deployed-example-binding` contains a minimal package for this flow. It is intentionally outside `my_runtime/bindings`, so `addBinding` cannot load it before it has been transferred.

Create the action payload from the example package:

```bash
DEPLOYMENT_EXAMPLE_DIR="my_runtime/deployable-bindings/deployed-example-binding" \
node -e '
const fs = require("fs");
const path = require("path");
const basePath = process.env.DEPLOYMENT_EXAMPLE_DIR;
const manifest = JSON.parse(fs.readFileSync(path.join(basePath, "manifest.json"), "utf8"));
const source = fs.readFileSync(path.join(basePath, "index.js"), "utf8");
process.stdout.write(JSON.stringify({ manifest, source }));
' > /tmp/deployed-example-binding.json
```

Transfer and load the binding through the Runtime Thing:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/deployBinding \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/deployed-example-binding.json
```

Expected result:

```json
{
  "result": true,
  "message": "Binding 'deployed-example-binding' deployed and loaded with schemes deployed-example."
}
```

The prototype accepts one `index.js` file and one manifest. Binding IDs may contain lowercase letters, numbers, and hyphens. A deployed entrypoint must be named `index.js`. Deploying JavaScript executes code in the Runtime process; this prototype therefore assumes a trusted management client and does not provide authentication, signatures, or sandboxing.

### 6.2 Manage an Installed Binding

Check whether an installed or bundled binding can be loaded:

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

For a binding installed through `deployBinding`, removal only unregisters it from the Servient. It remains in the deployment store and can be loaded again through the unchanged `addBinding` action:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"deployed-example-binding"}'
```

An unloaded deployed binding can be deleted permanently:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/deleteBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"deployed-example-binding"}'
```

`deleteBinding` operates exclusively on `my_runtime/deployed-bindings`. Bindings supplied with the runtime under `my_runtime/bindings`, such as `simple-binding`, cannot be deleted through this action. A deployed binding must be removed before it can be deleted.

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

### 7.4 Deployable Example Binding

Location before transfer:

```text
my_runtime/deployable-bindings/deployed-example-binding
```

This minimal client binding provides the `deployed-example` scheme and is used to demonstrate the deployment lifecycle. It is not part of the runtime's bundled binding directory. The package must first be sent through `deployBinding` as described in [6.1](#61-deploy-a-binding-through-wot).

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

The script `my_runtime/run-runtime-tests.sh` executes the documented runtime, deployment lifecycle, binding, and negative tests automatically. The deployment checks transfer the example package, remove and reload it, delete it, and verify that a bundled binding cannot be deleted. A running runtime at <http://localhost:8080/runtime> is required.

```bash
./my_runtime/run-runtime-tests.sh
```
