# Runtime Prototype Documentation

Diese Dokumentation beschreibt den Betrieb des Runtime-Prototyps im Eclipse node-wot Repository. Der Prototyp befindet sich unter `my_runtime` und stellt eine WoT-basierte Management Runtime bereit, über die Protocol Bindings zur Laufzeit geladen, geprüft und wieder entfernt werden können.

## Inhaltsverzeichnis

- [1. Voraussetzungen](#1-voraussetzungen)
- [2. Docker-Image](#2-docker-image)
- [3. Runtime-Start](#3-runtime-start)
- [4. Runtime-Endpunkte](#4-runtime-endpunkte)
- [5. Binding-Manifest-Modell](#5-binding-manifest-modell)
- [6. Compatibility Check](#6-compatibility-check)
- [7. Example-Binding](#7-example-binding)
- [8. CoAP-Binding](#8-coap-binding)
  - [8.1 CoAP-Zugriff](#81-coap-zugriff)
- [9. Simple-Binding](#9-simple-binding)
  - [9.1 Simple-Server-Zugriff](#91-simple-server-zugriff)
  - [9.2 Simple-Client-Test](#92-simple-client-test)
- [10. Negativtests](#10-negativtests)
  - [10.1 Bereits geladenes Binding](#101-bereits-geladenes-binding)
  - [10.2 Fehlendes Runtime-Interface](#102-fehlendes-runtime-interface)
  - [10.3 Fehlerhafte Binding-Implementierung](#103-fehlerhafte-binding-implementierung)
- [11. Automatisierte Testausführung](#11-automatisierte-testausführung)

## 1. Voraussetzungen

Die Projektabhängigkeiten müssen im Repository-Root installiert sein:

```bash
npm install
```

## 2. Docker-Image

Das Docker-Image enthält die `node-wot`-CLI. Nach Änderungen an `packages/cli/*`, `packages/core/*` oder am `Dockerfile` ist ein Neubau des Images erforderlich:

```bash
npm run build:docker
```

Änderungen unter `my_runtime/runtime.ts` oder `my_runtime/bindings/*` erfordern in der Regel keinen neuen Image-Build, da diese Dateien beim Start per Volume in den Container gemountet werden.

## 3. Runtime-Start

Die Runtime wird als WoT-Script über die node-wot CLI gestartet. Das Repository wird im Container nach `/workspace` gemountet, damit `my_runtime/runtime.ts` und die lokalen Bindings verfügbar sind.

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

Relevante Startparameter:

- `TS_NODE_PROJECT=/workspace/my_runtime/tsconfig.json`: TypeScript-Konfiguration für `my_runtime/runtime.ts`
- `TS_NODE_FILES=true`: Laden der benötigten globalen WoT-Typdefinitionen
- `-v "$(pwd):/workspace"`: Mount des lokalen Repositorys in den Container
- `-p 8080:8080/tcp`: HTTP-Zugriff auf die Management Runtime
- `-p 8091:8091/tcp`: Zugriff auf den Simple-Binding-Server
- `-p 5684:5684/udp`: Zugriff auf den dynamisch geladenen CoAP-Server

## 4. Runtime-Endpunkte

Die Management Runtime wird selbst als WoT Thing exponiert.

Thing Description:

```bash
curl http://localhost:8080/runtime
```

Status-Property:

```bash
curl http://localhost:8080/runtime/properties/status
```

Letzte Operation:

```bash
curl http://localhost:8080/runtime/properties/lastOperation
```

Registrierte Bindings:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
```

Runtime Capabilities:

```bash
curl http://localhost:8080/runtime/properties/runtimeCapabilities
```

## 5. Binding-Manifest-Modell

Die Bindings unter `my_runtime/bindings/<binding-id>` besitzen jeweils eine `manifest.json`. Das finale Manifest-Modell trennt zwischen der oberen WoT-Seite und der unteren Runtime-/Plattformseite.

`provides` beschreibt die durch das Binding bereitgestellte WoT-Seite:

```json
{
  "schemes": ["simple"],
  "roles": ["client", "server"],
  "interactions": ["readThingDescription", "readProperty", "writeProperty", "invokeAction"]
}
```

`requires` beschreibt die Anforderungen an die Host Runtime beziehungsweise Plattform:

```json
{
  "interfaces": [
    {
      "type": "request-response-endpoint",
      "direction": "server",
      "transport": "tcp",
      "profile": "nodejs-native"
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

Die Runtime prüft vor dem Laden eines Bindings, ob dessen `requires.interfaces` und `requires.resources` mit den deklarierten `runtimeCapabilities` und dem aktuellen Runtime-Zustand vereinbar sind.

## 6. Compatibility Check

Ein Binding kann vor dem Laden auf Kompatibilität geprüft werden. Die Action liest und validiert das Manifest, führt aber keinen Entry-Point-Code des Bindings aus.

```bash
curl -i -X POST http://localhost:8080/runtime/actions/checkBindingCompatibility \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

Ein kompatibles Binding liefert eine Antwort in dieser Form:

```json
{
  "id": "simple-binding",
  "compatible": true,
  "missingRequirements": [],
  "conflicts": []
}
```

Bei fehlenden Runtime-Interfaces oder Ressourcenkonflikten enthält die Antwort entsprechende Einträge in `missingRequirements` oder `conflicts`.

## 7. Example-Binding

Das Example-Binding befindet sich unter:

```text
my_runtime/bindings/example-binding
```

Laden:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"example-binding"}'
```

Status nach dem Laden:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

Entfernen:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"example-binding"}'
```

Status nach dem Entfernen:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

## 8. CoAP-Binding

Das CoAP-Binding befindet sich unter:

```text
my_runtime/bindings/coap-binding
```

Das Binding ist als serverseitiger Wrapper für einen verfügbaren CoAP-Protokollstack umgesetzt. Der dynamisch geladene CoAP-Server verwendet Port `5684/udp`.

Laden:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"coap-binding"}'
```

Status nach dem Laden:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

Entfernen:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"coap-binding"}'
```

Status nach dem Entfernen:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

### 8.1 CoAP-Zugriff

Die folgenden Befehle werden aus `packages/binding-coap` ausgeführt, damit das Paket `coap` aufgelöst werden kann. Der dynamisch geladene CoAP-Server lauscht auf `127.0.0.1:5684`.

Status-Property über CoAP:

```bash
cd packages/binding-coap
node -e "const coap=require('coap'); const req=coap.request('coap://127.0.0.1:5684/runtime/properties/status'); req.on('response',res=>{let out=''; res.on('data',c=>out+=c); res.on('end',()=>console.log('STATUS:', out));}); req.on('error',err=>console.error('ERROR:', err.message)); req.end();"
```

Thing Description über CoAP:

```bash
cd packages/binding-coap
node -e "const coap=require('coap'); const req=coap.request('coap://127.0.0.1:5684/runtime'); req.setOption('Accept','application/td+json'); req.on('response',res=>{let out=''; res.on('data',c=>out+=c); res.on('end',()=>console.log(out));}); req.on('error',err=>console.error('ERROR:', err.message)); req.end();"
```

Nach Entfernen des CoAP-Bindings sollten diese Anfragen nicht mehr erfolgreich beantwortet werden.

## 9. Simple-Binding

Das Simple-Binding befindet sich unter:

```text
my_runtime/bindings/simple-binding
```

Das Binding stellt einen eigenen Client und einen eigenen Server bereit. Der Server verwendet Port `8091/tcp`.

Laden:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

Status nach dem Laden:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

### 9.1 Simple-Server-Zugriff

Thing Description über den Simple-Server:

```bash
curl http://localhost:8091/runtime
```

Status-Property über den Simple-Server:

```bash
curl http://localhost:8091/runtime/properties/status
```

Registrierte Bindings über den Simple-Server:

```bash
curl http://localhost:8091/runtime/properties/registeredBindings
```

### 9.2 Simple-Client-Test

Die Datei `my_runtime/simple-client-test.js` verwendet den `SimpleClient` des Bindings und kommuniziert mit der Runtime über `simple://...`.

Standardlauf:

```bash
node my_runtime/simple-client-test.js
```

Einzelne Testaufrufe:

```bash
node my_runtime/simple-client-test.js td
node my_runtime/simple-client-test.js read status
node my_runtime/simple-client-test.js read registeredBindings
node my_runtime/simple-client-test.js action addBinding '{"id":"example-binding"}'
node my_runtime/simple-client-test.js action removeBinding '{"id":"example-binding"}'
```

Anpassung von Host, Port und Thing-Pfad:

```bash
SIMPLE_HOST=localhost SIMPLE_PORT=8091 SIMPLE_THING=runtime node my_runtime/simple-client-test.js read status
```

Entfernen:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

Status nach dem Entfernen:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

Nach Entfernen des Simple-Bindings sollten Anfragen an `http://localhost:8091/...` nicht mehr erfolgreich beantwortet werden.

## 10. Negativtests

### 10.1 Bereits geladenes Binding

Wenn `simple-binding` bereits geladen ist, meldet ein erneuter Compatibility Check für dasselbe Binding Konflikte, z.B. das registrierte Scheme `simple` und den belegten Port `8091`.

```bash
curl -i -X POST http://localhost:8080/runtime/actions/checkBindingCompatibility \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

### 10.2 Fehlendes Runtime-Interface

Ein Binding-Manifest mit einem nicht verfügbaren Interface führt zu einem fehlenden Requirement. Beispiel:

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
        "type": "message-channel",
        "direction": "client"
      }
    ],
    "resources": {
      "ports": []
    }
  }
}
```

Da die Runtime aktuell kein `message-channel` Interface in `runtimeCapabilities.interfaces` bereitstellt, meldet `checkBindingCompatibility` dieses Requirement als fehlend.

### 10.3 Fehlerhafte Binding-Implementierung

Das Binding `wrong-binding` ist ein absichtlich fehlerhaftes Negativbeispiel unter:

```text
my_runtime/bindings/wrong-binding
```

Das Manifest ist formal gültig und beschreibt kompatible Requirements. Der Entry Point liefert jedoch eine ungültige ClientFactory ohne `getClient()`-Methode. Dadurch sollte der Compatibility Check erfolgreich sein, während das tatsächliche Laden über `addBinding` fehlschlägt.

Compatibility Check:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/checkBindingCompatibility \
  -H "Content-Type: application/json" \
  --data '{"id":"wrong-binding"}'
```

Ladeversuch:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"wrong-binding"}'
```

Erwartete Fehlermeldung:

```text
Binding 'wrong-binding' returned an invalid client factory.
```

## 11. Automatisierte Testausführung

Das Skript `my_runtime/run-runtime-tests.sh` führt die dokumentierten Runtime-, Binding- und Negativtests automatisiert aus. Eine laufende Runtime unter `http://localhost:8080` wird vorausgesetzt.

```bash
./my_runtime/run-runtime-tests.sh
```
