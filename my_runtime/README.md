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
  - [7.2 HTTP Binding](#72-http-binding)
  - [7.3 New TCP Binding](#73-new-tcp-binding)
- [8. Negative Tests](#8-negative-tests)
  - [8.1 Already Active Binding](#81-already-active-binding)
  - [8.2 Missing Runtime Interface](#82-missing-runtime-interface)
  - [8.3 Invalid Binding Implementation](#83-invalid-binding-implementation)
- [9. Automated Tests](#9-automated-tests)

## 1. Overview

The prototype consists of:

- `runtime.ts`: the management runtime exposed as the WoT Thing `Runtime`
- `../my_bindings/*`: protocol binding packages located on the sender side
- `deployed-bindings/*`: runtime-managed storage containing bindings received through `deployBinding`
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
| `8091` | TCP | dynamically loaded HTTP Binding server |
| `8092` | TCP | dynamically loaded New TCP Binding server |
| `5683` | UDP | default node-wot CoAP server |
| `5684` | UDP | dynamically loaded CoAP Binding server |

## 4. Runtime Thing

The runtime is exposed as a WoT Thing named `Runtime`.

| Resource | Browser link | Command |
| --- | --- | --- |
| Thing Description | <http://localhost:8080/runtime> | `curl http://localhost:8080/runtime` |
| Status | <http://localhost:8080/runtime/properties/status> | `curl http://localhost:8080/runtime/properties/status` |
| Registered bindings | <http://localhost:8080/runtime/properties/registeredBindings> | `curl http://localhost:8080/runtime/properties/registeredBindings` |
| Binding states | <http://localhost:8080/runtime/properties/bindingStates> | `curl http://localhost:8080/runtime/properties/bindingStates` |
| Runtime capabilities | <http://localhost:8080/runtime/properties/runtimeCapabilities> | `curl http://localhost:8080/runtime/properties/runtimeCapabilities` |

`runtimeCapabilities.interfaces` lists the host interfaces and active native protocol stacks available to dynamic bindings. `runtimeCapabilities.supportedBindings.activeNative` lists native node-wot bindings already registered in the active Servient. `runtimeCapabilities.supportedBindings.loaded` lists dynamically loaded bindings.

The Runtime Thing provides the following lifecycle actions:

| Action | Purpose |
| --- | --- |
| `deployBinding` | Transfer a manifest and JavaScript entrypoint, store the binding, and activate it |
| `checkBindingCompatibility` | Validate a transferred binding package without storing or executing it |
| `addBinding` | Change a stored binding to the active state by registering it in the Servient |
| `removeBinding` | Change an active binding to the stored state while retaining its files |
| `deleteBinding` | Deactivate an active binding if necessary and delete its runtime-side files |

The binding lifecycle uses three states consistently:

| State | Runtime-side files | Registered in the Servient |
| --- | --- | --- |
| `not deployed` | No | No |
| `stored` | Yes | No |
| `active` | Yes | Yes |

`deployBinding` changes a binding from `not deployed` to `active`. `removeBinding` changes it from `active` to `stored`, and `addBinding` changes it from `stored` back to `active`. `deleteBinding` changes either `stored` or `active` to `not deployed`; in the active case, it first unregisters the binding from the Servient. The terms *load* and *remove* describe lifecycle operations; the resulting binding states are named *active* and *stored*.

`bindingStates` lists runtime-side packages in the `stored` or `active` state. A sender-side package whose ID is absent from this property is `not deployed` on that runtime.

## 5. Binding Manifest Model

Each package below `my_bindings/<binding-id>` contains a `manifest.json` and an `index.js`. These packages represent the sender side and are not searched by the runtime. After transfer, the runtime stores the received files below `my_runtime/deployed-bindings/<binding-id>`. The manifest separates the upper WoT-facing side from the lower runtime/platform requirements.

`provides` describes what the binding adds to the WoT runtime:

```json
{
  "schemes": ["new"],
  "roles": ["client", "server"],
  "interactions": ["readThingDescription", "readProperty", "writeProperty", "invokeAction"]
}
```

`requires` describes what the host runtime or platform must provide:

```json
{
  "interfaces": [
    {
      "type": "stream-socket",
      "direction": "server",
      "operations": ["listen", "accept", "send", "receive", "close"]
    },
    {
      "type": "stream-socket",
      "direction": "client",
      "operations": ["connect", "send", "receive", "close"]
    }
  ],
  "resources": {
    "ports": [
      {
        "transport": "tcp",
        "preferred": 8092,
        "required": true,
        "exclusive": true
      }
    ]
  }
}
```

The operations specify which abstract stream-socket capabilities the `new-tcp-binding` requires for its server and client roles.

Before activating a binding, the runtime validates the manifest and checks whether all requirements are compatible with the current runtime capabilities and resource state.

## 6. Management Flow

### 6.1 Deploy a Binding through WoT

`deployBinding` accepts the parsed manifest as an object and the complete JavaScript entrypoint as a string in one WoT action invocation. The runtime validates the package, checks its requirements, writes it to the dedicated deployment store, activates it, and registers its ClientFactory or Server in the Servient.

The packages in `my_bindings` represent files available to the sending management client. The runtime does not include `my_bindings` in its binding search path. Consequently, `addBinding` cannot load a package before it has been transferred through `deployBinding`.

Create the action payload for `new-tcp-binding` from the sender-side package:

```bash
BINDING_DIR="my_bindings/new-tcp-binding" \
node -e '
const fs = require("fs");
const path = require("path");
const basePath = process.env.BINDING_DIR;
const manifest = JSON.parse(fs.readFileSync(path.join(basePath, "manifest.json"), "utf8"));
const source = fs.readFileSync(path.join(basePath, "index.js"), "utf8");
process.stdout.write(JSON.stringify({ manifest, source }));
' > /tmp/new-tcp-binding-deployment.json
```

Check the external package against the current runtime before deployment:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/checkBindingCompatibility \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/new-tcp-binding-deployment.json
```

Expected result:

```json
{
  "id": "new-tcp-binding",
  "compatible": true,
  "missingRequirements": [],
  "conflicts": []
}
```

The action validates the package structure and uses its manifest to compare the declared requirements with the current runtime capabilities and resource state. It does not write the manifest or source code to `deployed-bindings`, load the JavaScript module, or change the binding lifecycle state. The package therefore remains `not deployed` after this check.

Transfer and activate the binding through the Runtime Thing:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/deployBinding \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/new-tcp-binding-deployment.json
```

Expected result:

```json
{
  "result": true,
  "message": "Binding 'new-tcp-binding' deployed and activated with schemes new."
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
  --data '{"id":"new-tcp-binding"}'
```

The files remain in the deployment store and the binding is now `stored`. Inspect the lifecycle state:

```bash
curl http://localhost:8080/runtime/properties/bindingStates
```

Expected entry:

```json
[
  {
    "id": "new-tcp-binding",
    "state": "stored"
  }
]
```

Activate the stored binding again:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"new-tcp-binding"}'
```

Delete the active binding and its runtime-side files:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/deleteBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"new-tcp-binding"}'
```

`deleteBinding` operates exclusively on `my_runtime/deployed-bindings`. If the binding is `active`, the action first stops and unregisters its dynamic Server and ClientFactory and then deletes the files. If it is already `stored`, only the files are deleted. In both cases, the resulting state is `not deployed`. Deleting the runtime-side copy does not modify the original package under `my_bindings` on the sender side.

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

### 7.2 HTTP Binding

Sender-side package:

```text
my_bindings/http-binding
```

This binding loads the existing node-wot `HttpServer` implementation and exposes the Runtime Thing through an additional HTTP server on `8091/tcp`. It mirrors the structure of `coap-binding`: both dynamically add a server from an available node-wot protocol stack.

Deploy the package using the procedure from [6.1](#61-deploy-a-binding-through-wot) with `BINDING_DIR="my_bindings/http-binding"`.

Remove:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"http-binding"}'
```

### 7.3 New TCP Binding

Sender-side package:

```text
my_bindings/new-tcp-binding
```

This binding provides a custom `new` scheme over a minimal JSON-line protocol on a TCP stream socket. The server listens on `8092/tcp`. It is the binding used by the presentation scenario when the replacement meter no longer speaks CoAP.

Deploy the package using the procedure from [6.1](#61-deploy-a-binding-through-wot) with `BINDING_DIR="my_bindings/new-tcp-binding"`.

After a successful deployment, read the Runtime Thing's `status` property through the dynamically loaded Raw TCP Binding:

```bash
node -e '
const net = require("net");
const socket = net.connect(8092, "127.0.0.1");
let response = "";

socket.setEncoding("utf8");
socket.on("connect", () => {
  socket.write(JSON.stringify({
    op: "readProperty",
    path: "runtime",
    name: "status"
  }) + "\n");
});
socket.on("data", chunk => {
  response += chunk;
  const newline = response.indexOf("\n");
  if (newline === -1) return;

  const result = JSON.parse(response.slice(0, newline));
  socket.end();

  if (result.ok !== true) {
    throw new Error(result.error || "Request failed");
  }

  console.log(Buffer.from(result.body || "", "base64").toString("utf8"));
});
socket.on("error", error => {
  console.error(error.message);
  process.exitCode = 1;
});
'
```

Expected output:

```text
"running"
```

This confirms that the binding is not only registered in the Servient but also accepts and processes requests through the custom `new://` protocol.

Remove:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"new-tcp-binding"}'
```

## 8. Negative Tests

### 8.1 Already Active Binding

If `new-tcp-binding` is already active, checking the sender-side package again reports conflicts such as the registered `new` scheme and the occupied port `8092`.

```bash
curl -i -X POST http://localhost:8080/runtime/actions/checkBindingCompatibility \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/new-tcp-binding-deployment.json
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
