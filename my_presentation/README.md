# Dynamic Binding Loading PoC

This directory contains small device simulators for the bachelor thesis demo story:

- A battery storage system exposed as a standard WoT Thing over CoAP.
- An old electricity meter exposed as a standard WoT Thing over CoAP.
- A new replacement electricity meter that no longer speaks CoAP and requires the custom `new-binding` raw TCP protocol.

The scripts are intentionally small. They show a possible setup where a central industrial PC runs the management runtime from `../my_runtime` and the presentation application from this directory in the same node-wot Servient. The presentation application first communicates with standard CoAP devices over UDP through the regular node-wot CoAP binding. It later starts working with a replacement device over TCP after an external management client transfers `../my_bindings/new-binding` to the Runtime Thing and the runtime loads it dynamically.

The example binding is not part of the runtime installation. `../my_bindings/new-binding` represents the sender-side package, while `../my_runtime/deployed-bindings` is runtime-managed storage. During deployment, the complete manifest and JavaScript source are transmitted in a `deployBinding` WoT action request.

## Start

The dependencies are expected to be available from the repository root. The simulators can be started individually:

```bash
npm run battery --prefix my_presentation
npm run old-meter --prefix my_presentation
npm run new-meter --prefix my_presentation
```

Start the shared-Servient runtime after the devices are running:

```bash
npm run runtime --prefix my_presentation
```

Start the visualizer in another terminal:

```bash
npm run visualizer --prefix my_presentation
```

Open: <http://localhost:9200>

The runtime command starts two WoT Things in the same node-wot process:

- `Runtime` from `../my_runtime/runtime.ts`
- `EnergyDemoApplication` from `./energy-demo-runtime.ts`

Default ports:

- Battery storage: `coap://localhost:5686`
- Old meter: `coap://localhost:5687`
- New meter: `new://localhost:9103/new-electricity-meter-01`
- Visualizer: `http://localhost:9200`

The visualizer also acts as the external management client for the presentation. Its **Deploy** command reads the sender-side files from `my_bindings/new-binding`, creates the `{ manifest, source }` request payload, and invokes `Runtime.deployBinding` over HTTP/WoT. It never writes to `my_runtime/deployed-bindings` directly.

## Runtime-Mediated Demo

The actual demonstration should use the `EnergyDemoApplication` Thing as the application-facing integration point and the `Runtime` Thing only for binding management:

1. `EnergyDemoApplication` reads the battery storage over standard CoAP/UDP.
2. `EnergyDemoApplication` reads the old meter over standard CoAP/UDP.
3. `EnergyDemoApplication` tries to read the replacement meter over `new://` and fails because `new-binding` is not active yet.
4. The management client sends the manifest and complete JavaScript source to `Runtime.deployBinding`.
5. `Runtime` validates the manifest, checks the downward interface requirements, stores the received files, and dynamically registers `new-binding` in the shared Servient.
6. `EnergyDemoApplication` reads the replacement meter over TCP successfully because it uses the same Servient.

Read the CoAP devices through the presentation application:

```bash
curl -i -X POST http://localhost:8080/energydemoapplication/actions/readBattery
curl -i -X POST http://localhost:8080/energydemoapplication/actions/readOldMeter
```

Try the replacement meter before `new-binding` is loaded:

```bash
curl -i -X POST http://localhost:8080/energydemoapplication/actions/readNewMeter
```

Create the deployment payload from the sender-side binding package:

```bash
BINDING_DIR="my_bindings/new-binding" \
node -e '
const fs = require("fs");
const path = require("path");
const basePath = process.env.BINDING_DIR;
const manifest = JSON.parse(fs.readFileSync(path.join(basePath, "manifest.json"), "utf8"));
const source = fs.readFileSync(path.join(basePath, "index.js"), "utf8");
process.stdout.write(JSON.stringify({ manifest, source }));
' > /tmp/new-binding-deployment.json
```

Transfer and load `new-binding` dynamically through the management Runtime Thing:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/deployBinding \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/new-binding-deployment.json
```

Read the replacement meter again:

```bash
curl -i -X POST http://localhost:8080/energydemoapplication/actions/readNewMeter
```

The same flow can be presented through <http://localhost:9200>: **Deploy** performs the transfer and activates the binding, **Unload** changes it from *active* to *stored* while retaining its files, **Load** changes it from *stored* back to *active*, and **Delete** changes it from *stored* to *not deployed*. The topology consistently distinguishes the states *not deployed*, *stored*, and *active*.

For a repeatable transfer demonstration, use **Unload** and then **Delete** after the presentation. If the runtime starts while a package from an earlier run is still stored, the visualizer reports the *stored* state and permits **Load** or **Delete** instead of deploying a duplicate.

The direct device requests below are only low-level smoke tests for the simulators. They are not the dynamic binding deployment demonstration.

## Device Smoke Tests

Battery storage:

```bash
node -e "const coap=require('./packages/binding-coap/node_modules/coap'); const req=coap.request('coap://localhost:5686/.well-known/wot-thing-description'); req.on('response', r => r.pipe(process.stdout)); req.end();"
node -e "const coap=require('./packages/binding-coap/node_modules/coap'); const req=coap.request('coap://localhost:5686/properties/stateOfCharge'); req.on('response', r => r.pipe(process.stdout)); req.end();"
```

Old CoAP meter:

```bash
node -e "const coap=require('./packages/binding-coap/node_modules/coap'); const req=coap.request('coap://localhost:5687/.well-known/wot-thing-description'); req.on('response', r => r.pipe(process.stdout)); req.end();"
node -e "const coap=require('./packages/binding-coap/node_modules/coap'); const req=coap.request('coap://localhost:5687/properties/reading'); req.on('response', r => r.pipe(process.stdout)); req.end();"
```

No direct `new://` smoke test is listed here because that would bypass the runtime. The replacement meter deliberately provides no CoAP endpoint. In the proof of concept, only the runtime-mediated demo should read it successfully after transferring and dynamically loading `new-binding`, which adds support for the `new://` TCP protocol.
