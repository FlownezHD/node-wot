# Dynamic Binding Loading PoC

This directory contains small device simulators for the bachelor thesis demo story:

- A battery storage system exposed as a standard WoT Thing over CoAP.
- An old electricity meter exposed as a standard WoT Thing over CoAP.
- A new replacement electricity meter that no longer speaks CoAP and requires the custom `new-binding` raw TCP protocol.

The scripts are intentionally small. They show a possible setup where a central industrial PC runs the WoT runtime from `../my_runtime`, first communicates with standard CoAP devices over UDP, and later has to dynamically load `../my_runtime/bindings/new-binding` to communicate with a replacement device over TCP.

## Start

The dependencies are expected to be available from the repository root. The simulators can be started individually:

```bash
npm run battery --prefix my_presentation
npm run old-meter --prefix my_presentation
npm run new-meter --prefix my_presentation
```

Default ports:

- Battery storage: `coap://localhost:5686`
- Old meter: `coap://localhost:5687`
- New meter: `new://localhost:9103/new-electricity-meter-01`

## Example Requests

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

New raw TCP meter:

```bash
node -e "const net=require('net'); const s=net.connect(9103,'localhost',()=>s.write(JSON.stringify({op:'readThingDescription',path:'new-electricity-meter-01'})+'\\n')); s.on('data',d=>{const r=JSON.parse(d); console.log(Buffer.from(r.body,'base64').toString()); s.end();});"
node -e "const net=require('net'); const s=net.connect(9103,'localhost',()=>s.write(JSON.stringify({op:'readProperty',path:'new-electricity-meter-01',name:'reading'})+'\\n')); s.on('data',d=>{const r=JSON.parse(d); console.log(Buffer.from(r.body,'base64').toString()); s.end();});"
```

The replacement meter deliberately provides no CoAP endpoint. In the proof of concept, the runtime can communicate with this device again only after dynamically loading `new-binding`, which adds support for the `new://` TCP protocol.
