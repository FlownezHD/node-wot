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
- [8. Negative Tests](#8-negative-tests)
  - [8.1 Already Loaded Binding](#81-already-loaded-binding)
  - [8.2 Missing Runtime Interface](#82-missing-runtime-interface)
  - [8.3 Invalid Binding Implementation](#83-invalid-binding-implementation)
- [9. Automated Tests](#9-automated-tests)

## 1. Overview

The prototype consists of:

- `runtime.ts`: the management runtime exposed as the WoT Thing `Runtime`
- `../my_bindings/*`: protocol binding packages located on the sender side
- `deployed-bindings/*`: runtime-managed storage containing bindings received through `deployBinding`
- `simple-client-test.js`: a small test client for the Simple Binding
- `run-runtime-tests.sh`: scripted checks for the documented flows

The runtime itself does not contain the example bindings and does not simulate industrial devices. It manages received protocol bindings in the active node-wot Servient. The `my_bindings` directory represents packages available to an external management client. The presentation scenario in `../my_presentation` uses this runtime together with an application Thing and simulated devices.

## 2. Prerequisites

Install the repository dependencies from the repository root:

```bash
npm install
```

If the Docker image is not available yet, build it from the repository root:

```bash
npm run build:docker
```

Rebuilding the Docker image is usually only required after changes to `packages/cli/*`, `packages/core/*`, or the `Dockerfile`. Changes below `my_runtime/*` and `my_bindings/*` are mounted into the container at startup.

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
| `checkBindingCompatibility` | Validate the requirements of an installed binding without loading it |
| `addBinding` | Load a binding already present in the runtime deployment store by ID |
| `removeBinding` | Unregister a loaded binding while retaining its files |
| `deleteBinding` | Delete an unloaded binding previously installed through `deployBinding` |

## 5. Binding Manifest Model

Each package below `my_bindings/<binding-id>` contains a `manifest.json` and an `index.js`. These packages represent the sender side and are not searched by the runtime. After transfer, the runtime stores the received files below `my_runtime/deployed-bindings/<binding-id>`. The manifest separates the upper WoT-facing side from the lower runtime/platform requirements.

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

The packages in `my_bindings` represent files available to the sending management client. The runtime does not include `my_bindings` in its binding search path. Consequently, `addBinding` cannot load a package before it has been transferred through `deployBinding`.

Create the action payload for `simple-binding` from the sender-side package:

```bash
BINDING_DIR="my_bindings/simple-binding" \
node -e '
const fs = require("fs");
const path = require("path");
const basePath = process.env.BINDING_DIR;
const manifest = JSON.parse(fs.readFileSync(path.join(basePath, "manifest.json"), "utf8"));
const source = fs.readFileSync(path.join(basePath, "index.js"), "utf8");
process.stdout.write(JSON.stringify({ manifest, source }));
' > /tmp/simple-binding-deployment.json
```

Transfer and load the binding through the Runtime Thing:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/deployBinding \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/simple-binding-deployment.json
```

Expected result:

```json
{
  "result": true,
  "message": "Binding 'simple-binding' deployed and loaded with schemes simple."
}
```

The prototype accepts one `index.js` file and one manifest. Binding IDs may contain lowercase letters, numbers, and hyphens. A deployed entrypoint must be named `index.js`. Deploying JavaScript executes code in the Runtime process; this prototype therefore assumes a trusted management client and does not provide authentication, signatures, or sandboxing.

### 6.2 Manage an Installed Binding

After the successful deployment in the previous section, inspect the active bindings:

Open: <http://localhost:8080/runtime/properties/registeredBindings>

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
```

Remove the binding from the Servient:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

The files remain in the deployment store. Check whether the installed binding can be loaded again:

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

Load the installed binding again:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

Remove it again before deleting its files:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

An unloaded deployed binding can be deleted permanently:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/deleteBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

`deleteBinding` operates exclusively on `my_runtime/deployed-bindings`. A deployed binding must be removed before it can be deleted. Deleting it removes the runtime-side copy but does not modify the original package under `my_bindings` on the sender side.

## 7. Available Demo Bindings

### 7.1 CoAP Binding

Sender-side package:

```text
my_bindings/coap-binding
```

This binding exposes the runtime through an additional CoAP server on `5684/udp`.

Deploy the package using the procedure from [6.1](#61-deploy-a-binding-through-wot) with `BINDING_DIR="my_bindings/coap-binding"`.

Remove:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"coap-binding"}'
```

### 7.2 Simple Binding

Sender-side package:

```text
my_bindings/simple-binding
```

This binding provides a small custom client/server pair for the `simple` scheme. The server listens on `8091/tcp`.

Deploy the package using the procedure from [6.1](#61-deploy-a-binding-through-wot) with `BINDING_DIR="my_bindings/simple-binding"`.

Remove:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

### 7.3 New Raw TCP Binding

Sender-side package:

```text
my_bindings/new-binding
```

This binding provides a custom `new` scheme over a minimal JSON-line protocol on a TCP stream socket. The server listens on `8092/tcp`. It is the binding used by the presentation scenario when the replacement meter no longer speaks CoAP.

Deploy the package using the procedure from [6.1](#61-deploy-a-binding-through-wot) with `BINDING_DIR="my_bindings/new-binding"`.

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

Because the runtime currently provides no `amqp` protocol stack in `runtimeCapabilities.interfaces`, `deployBinding` rejects the package before storing or executing its source code and returns the missing requirement.

### 8.3 Invalid Binding Implementation

The `wrong-binding` binding is an intentionally invalid negative example:

```text
my_bindings/wrong-binding
```

Its manifest is formally valid and compatible, but the entry point returns an invalid ClientFactory without a `getClient()` method. The deployment therefore passes manifest and compatibility validation but fails while registering the implementation. The runtime rolls the transferred files back automatically.

Create the deployment payload as described in [6.1](#61-deploy-a-binding-through-wot), using `BINDING_DIR="my_bindings/wrong-binding"`, and invoke `deployBinding`:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/deployBinding \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/wrong-binding-deployment.json
```

Expected error:

```text
Binding 'wrong-binding' returned an invalid client factory.
```

## 9. Automated Tests

The script `my_runtime/run-runtime-tests.sh` executes the documented runtime, deployment lifecycle, binding, and negative tests automatically. Every binding used by the tests is first read from `my_bindings` and transferred through `deployBinding`. The tests also cover removal, reloading with `addBinding`, deletion, incompatible requirements, and rollback of an invalid implementation. A running runtime at <http://localhost:8080/runtime> is required.

```bash
./my_runtime/run-runtime-tests.sh
```
