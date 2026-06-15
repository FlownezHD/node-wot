# Runtime Prototype Documentation

This document describes how to operate the runtime prototype in the Eclipse node-wot repository. The prototype is located in `my_runtime` and provides a WoT-based management runtime that can load, validate, and remove protocol bindings at runtime.

## Table of Contents

- [1. Prerequisites](#1-prerequisites)
- [2. Docker Image](#2-docker-image)
- [3. Runtime Startup](#3-runtime-startup)
- [4. Runtime Endpoints](#4-runtime-endpoints)
- [5. Binding Manifest Model](#5-binding-manifest-model)
- [6. Compatibility Check](#6-compatibility-check)
- [7. Example Binding](#7-example-binding)
- [8. CoAP Binding](#8-coap-binding)
  - [8.1 CoAP Access](#81-coap-access)
- [9. Simple Binding](#9-simple-binding)
  - [9.1 Simple Server Access](#91-simple-server-access)
  - [9.2 Simple Client Test](#92-simple-client-test)
- [10. Negative Tests](#10-negative-tests)
  - [10.1 Already Loaded Binding](#101-already-loaded-binding)
  - [10.2 Missing Runtime Interface](#102-missing-runtime-interface)
  - [10.3 Invalid Binding Implementation](#103-invalid-binding-implementation)
- [11. Automated Test Execution](#11-automated-test-execution)

## 1. Prerequisites

The project dependencies must be installed from the repository root:

```bash
npm install
```

## 2. Docker Image

The Docker image contains the `node-wot` CLI. After changes to `packages/cli/*`, `packages/core/*`, or the `Dockerfile`, the image has to be rebuilt:

```bash
npm run build:docker
```

Changes below `my_runtime/runtime.ts` or `my_runtime/bindings/*` usually do not require a new image build because these files are mounted into the container as a volume at startup.

## 3. Runtime Startup

The runtime is started as a WoT script through the node-wot CLI. The repository is mounted into the container at `/workspace` so that `my_runtime/runtime.ts` and the local bindings are available.

```bash
docker run -it --init \
  -p 8080:8080/tcp \
  -p 8091:8091/tcp \
  -p 5683:5683/udp \
  -p 5684:5684/udp \
  -e TS_NODE_PROJECT=/workspace/my_runtime/tsconfig.json \
  -e TS_NODE_FILES=true \
  -v "$(pwd):/workspace" \
  --rm \
  node-wot /workspace/my_runtime/runtime.ts
```

Relevant startup parameters:

- `TS_NODE_PROJECT=/workspace/my_runtime/tsconfig.json`: TypeScript configuration for `my_runtime/runtime.ts`
- `TS_NODE_FILES=true`: loads the required global WoT type definitions
- `-v "$(pwd):/workspace"`: mounts the local repository into the container
- `-p 8080:8080/tcp`: HTTP access to the management runtime
- `-p 8091:8091/tcp`: access to the Simple Binding server
- `-p 5684:5684/udp`: access to the dynamically loaded CoAP server

## 4. Runtime Endpoints

The management runtime is exposed as a WoT Thing itself.

Thing Description:

```bash
curl http://localhost:8080/runtime
```

Status property:

```bash
curl http://localhost:8080/runtime/properties/status
```

Last operation:

```bash
curl http://localhost:8080/runtime/properties/lastOperation
```

Registered bindings:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
```

Runtime capabilities:

```bash
curl http://localhost:8080/runtime/properties/runtimeCapabilities
```

## 5. Binding Manifest Model

Each binding below `my_runtime/bindings/<binding-id>` has a `manifest.json`. The final manifest model separates the upper WoT side from the lower runtime/platform side.

`provides` describes the WoT side provided by the binding:

```json
{
  "schemes": ["simple"],
  "roles": ["client", "server"],
  "interactions": ["readThingDescription", "readProperty", "writeProperty", "invokeAction"]
}
```

`requires` describes the requirements on the host runtime or platform:

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

For socket-based bindings, `operations` can optionally specify the required Berkeley-like socket operations:

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

Before loading a binding, the runtime checks whether its `requires.interfaces` and `requires.resources` are compatible with the declared `runtimeCapabilities` and the current runtime state.

## 6. Compatibility Check

A binding can be checked for compatibility before it is loaded. The action reads and validates the manifest but does not execute any entry point code from the binding.

```bash
curl -i -X POST http://localhost:8080/runtime/actions/checkBindingCompatibility \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

A compatible binding returns a response in this shape:

```json
{
  "id": "simple-binding",
  "compatible": true,
  "missingRequirements": [],
  "conflicts": []
}
```

If runtime interfaces are missing or resource conflicts exist, the response contains corresponding entries in `missingRequirements` or `conflicts`.

## 7. Example Binding

The Example Binding is located at:

```text
my_runtime/bindings/example-binding
```

Load it:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"example-binding"}'
```

Status after loading:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

Remove it:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"example-binding"}'
```

Status after removal:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

## 8. CoAP Binding

The CoAP Binding is located at:

```text
my_runtime/bindings/coap-binding
```

The binding is implemented as a server-side wrapper around an available CoAP protocol stack. The dynamically loaded CoAP server uses port `5684/udp`.

Load it:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"coap-binding"}'
```

Status after loading:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

Remove it:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"coap-binding"}'
```

Status after removal:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

### 8.1 CoAP Access

The following commands are run from `packages/binding-coap` so that the `coap` package can be resolved. The dynamically loaded CoAP server listens on `127.0.0.1:5684`.

Status property over CoAP:

```bash
cd packages/binding-coap
node -e "const coap=require('coap'); const req=coap.request('coap://127.0.0.1:5684/runtime/properties/status'); req.on('response',res=>{let out=''; res.on('data',c=>out+=c); res.on('end',()=>console.log('STATUS:', out));}); req.on('error',err=>console.error('ERROR:', err.message)); req.end();"
```

Thing Description over CoAP:

```bash
cd packages/binding-coap
node -e "const coap=require('coap'); const req=coap.request('coap://127.0.0.1:5684/runtime'); req.setOption('Accept','application/td+json'); req.on('response',res=>{let out=''; res.on('data',c=>out+=c); res.on('end',()=>console.log(out));}); req.on('error',err=>console.error('ERROR:', err.message)); req.end();"
```

After removing the CoAP Binding, these requests should no longer receive successful responses.

## 9. Simple Binding

The Simple Binding is located at:

```text
my_runtime/bindings/simple-binding
```

The binding provides its own client and server. The server uses port `8091/tcp`.

Load it:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

Status after loading:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

### 9.1 Simple Server Access

Thing Description over the Simple server:

```bash
curl http://localhost:8091/runtime
```

Status property over the Simple server:

```bash
curl http://localhost:8091/runtime/properties/status
```

Registered bindings over the Simple server:

```bash
curl http://localhost:8091/runtime/properties/registeredBindings
```

### 9.2 Simple Client Test

The file `my_runtime/simple-client-test.js` uses the binding's `SimpleClient` and communicates with the runtime over `simple://...`.

Default run:

```bash
node my_runtime/simple-client-test.js
```

Individual test calls:

```bash
node my_runtime/simple-client-test.js td
node my_runtime/simple-client-test.js read status
node my_runtime/simple-client-test.js read registeredBindings
node my_runtime/simple-client-test.js action addBinding '{"id":"example-binding"}'
node my_runtime/simple-client-test.js action removeBinding '{"id":"example-binding"}'
```

Override host, port, and Thing path:

```bash
SIMPLE_HOST=localhost SIMPLE_PORT=8091 SIMPLE_THING=runtime node my_runtime/simple-client-test.js read status
```

Remove it:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

Status after removal:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

After removing the Simple Binding, requests to `http://localhost:8091/...` should no longer receive successful responses.

## 10. Negative Tests

### 10.1 Already Loaded Binding

If `simple-binding` is already loaded, another compatibility check for the same binding reports conflicts, for example the registered `simple` scheme and the occupied port `8091`.

```bash
curl -i -X POST http://localhost:8080/runtime/actions/checkBindingCompatibility \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

### 10.2 Missing Runtime Interface

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
        "protocol": "mqtt",
        "direction": "client"
      }
    ],
    "resources": {
      "ports": []
    }
  }
}
```

Because the runtime currently provides no `mqtt` protocol stack in `runtimeCapabilities.interfaces`, `checkBindingCompatibility` reports this requirement as missing.

### 10.3 Invalid Binding Implementation

The `wrong-binding` binding is an intentionally invalid negative example located at:

```text
my_runtime/bindings/wrong-binding
```

The manifest is formally valid and describes compatible requirements. However, the entry point returns an invalid ClientFactory without a `getClient()` method. As a result, the compatibility check should succeed, while the actual load through `addBinding` should fail.

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

Expected error message:

```text
Binding 'wrong-binding' returned an invalid client factory.
```

## 11. Automated Test Execution

The script `my_runtime/run-runtime-tests.sh` executes the documented runtime, binding, and negative tests automatically. A running runtime at `http://localhost:8080` is required.

```bash
./my_runtime/run-runtime-tests.sh
```
