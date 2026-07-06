# Dynamic Binding Loading PoC

This directory contains small device simulators for the bachelor thesis demo story:

- A battery storage system exposed as a standard WoT Thing over CoAP.
- An old electricity meter exposed as a standard WoT Thing over CoAP.
- A new replacement electricity meter that no longer speaks CoAP and requires the custom `new-binding` raw TCP protocol.

The scripts are intentionally small. They show a possible setup where a central industrial PC runs the management runtime from `../my_runtime` and the presentation application from this directory in the same node-wot Servient. The presentation application first communicates with standard CoAP devices over UDP through the regular node-wot CoAP binding, and later starts working with a replacement device over TCP after `../my_runtime/bindings/new-binding` is loaded dynamically.

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

Optionally start the visualizer in another terminal:

```bash
npm run visualizer --prefix my_presentation
```

Open: <http://localhost:9200>

This starts two WoT Things in the same node-wot process:

- `Runtime` from `../my_runtime/runtime.ts`
- `EnergyDemoApplication` from `./energy-demo-runtime.ts`

Default ports:

- Battery storage: `coap://localhost:5686`
- Old meter: `coap://localhost:5687`
- New meter: `new://localhost:9103/new-electricity-meter-01`
- Visualizer: `http://localhost:9200`

## Runtime-Mediated Demo

The actual demonstration should use the `EnergyDemoApplication` Thing as the application-facing integration point and the `Runtime` Thing only for binding management:

1. `EnergyDemoApplication` reads the battery storage over standard CoAP/UDP.
2. `EnergyDemoApplication` reads the old meter over standard CoAP/UDP.
3. `EnergyDemoApplication` tries to read the replacement meter over `new://` and fails because `new-binding` is not loaded yet.
4. `Runtime` dynamically loads `new-binding` into the shared Servient.
5. `EnergyDemoApplication` reads the replacement meter over TCP successfully because it uses the same Servient.

Read the CoAP devices through the presentation application:

```bash
curl -i -X POST http://localhost:8080/energydemoapplication/actions/readBattery
curl -i -X POST http://localhost:8080/energydemoapplication/actions/readOldMeter
```

Try the replacement meter before `new-binding` is loaded:

```bash
curl -i -X POST http://localhost:8080/energydemoapplication/actions/readNewMeter
```

Load `new-binding` dynamically through the management runtime:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"new-binding"}'
```

Read the replacement meter again:

```bash
curl -i -X POST http://localhost:8080/energydemoapplication/actions/readNewMeter
```

The direct device requests below are only low-level smoke tests for the simulators. They are not the dynamic binding loading demonstration.

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

No direct `new://` smoke test is listed here because that would bypass the runtime. The replacement meter deliberately provides no CoAP endpoint. In the proof of concept, only the runtime-mediated demo should read it successfully after dynamically loading `new-binding`, which adds support for the `new://` TCP protocol.
