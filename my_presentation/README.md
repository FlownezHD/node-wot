# Dynamic Binding Loading PoC

This directory contains small device simulators for the bachelor thesis demo story:

- A battery storage system with an existing HTTP API.
- An old electricity meter with an existing HTTP API.
- A new electricity meter that replaces the old HTTP API and only speaks a proprietary CoAP protocol.

The scripts are intentionally small. They show a possible setup where a central industrial PC runs the WoT runtime from `../my_runtime` and later has to dynamically load a suitable binding.

## Start

The dependencies are expected to be available from the repository root. The simulators can be started individually:

```bash
npm run battery --prefix my_presentation
npm run old-meter --prefix my_presentation
npm run new-meter --prefix my_presentation
```

Default ports:

- Battery storage: `http://localhost:9101`
- Old meter: `http://localhost:9102`
- New meter: `coap://localhost:5685`

## Example Requests

Battery storage:

```bash
curl http://localhost:9101/.well-known/wot-thing-description
curl http://localhost:9101/api/v1/status
curl http://localhost:9101/api/v1/properties/stateOfCharge
```

Old HTTP meter:

```bash
curl http://localhost:9102/.well-known/wot-thing-description
curl http://localhost:9102/api/v1/meter/reading
curl http://localhost:9102/api/v1/meter/power
```

New proprietary CoAP meter:

```bash
node -e "const coap=require('coap'); const req=coap.request('coap://localhost:5685/vendor/pm-2000/telemetry'); req.on('response', r => r.pipe(process.stdout)); req.end();"
```

The new meter deliberately provides no HTTP API and no directly standardized WoT representation. In the proof of concept, the runtime can communicate with this device again only after dynamically loading a suitable binding.
