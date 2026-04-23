# Runtime Prototype Guide

Diese Datei beschreibt den aktuellen Ablauf, um die Runtime in Docker zu bauen, zu starten und das Example-Binding zu testen.

## 1. Voraussetzungen

Im Projekt-Root einmal die Abhaengigkeiten installieren:

```bash
npm install
```

## 2. Docker-Image bauen

Das Docker-Image enthaelt die `node-wot`-CLI. Da `cli.ts` und `executor.ts` fuer die Runtime angepasst wurden, solltest du das Image nach Aenderungen an `packages/cli/*`, `packages/core/*` oder am `Dockerfile` neu bauen:

```bash
npm run build:docker
```

Hinweis:
- Aenderungen an `my_runtime/runtime.ts` oder `my_runtime/bindings/*` brauchen normalerweise kein neues Image, weil diese spaeter per Volume in den Container gemountet werden.

## 3. Runtime im Container starten

Die Runtime wird als WoT-Script ueber die CLI gestartet. Dabei wird das ganze Repo nach `/workspace` gemountet, damit `my_runtime/runtime.ts` und die lokalen Bindings verfuegbar sind.

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

Die wichtigen Punkte dabei sind:
- `TS_NODE_PROJECT=/workspace/my_runtime/tsconfig.json`: nutzt den TS-Kontext fuer `my_runtime/runtime.ts`
- `TS_NODE_FILES=true`: laedt die benoetigten globalen WoT-Typen
- `-v "$(pwd):/workspace"`: mountet dein lokales Repo in den Container

## 4. Pruefen, ob die Runtime laeuft

Thing Description der Runtime:

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

## 5. Example-Binding hinzufuegen

Das Example-Binding liegt aktuell unter:

```text
my_runtime/bindings/example-binding
```

Zum Laden des Bindings:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"example-binding"}'
```

Danach kannst du erneut pruefen:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

## 6. Example-Binding wieder entfernen

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"example-binding"}'
```

Anschliessend wieder pruefen:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

## 7. CoAP-Binding dynamisch laden

Das CoAP-Plugin liegt aktuell unter:

```text
my_runtime/bindings/coap-binding
```

Wichtig:
- das Plugin ist aktuell als Server-only Wrapper umgesetzt
- der dynamisch geladene CoAP-Server verwendet Port `5684`
- deshalb sollte beim Docker-Start `-p 5684:5684/udp` gesetzt sein

CoAP-Binding laden:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"coap-binding"}'
```

Danach pruefen:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

CoAP-Binding wieder entfernen:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"coap-binding"}'
```

Danach wieder pruefen:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

### CoAP-Server direkt testen

Da das CoAP-Binding aktuell als server-only Plugin umgesetzt ist, kannst du danach direkt eine echte CoAP-Anfrage an den dynamisch geladenen Server schicken.

Wichtig:
- der Test wird aus `packages/binding-coap` heraus ausgefuehrt, damit `require("coap")` aufgeloest werden kann
- der dynamisch geladene CoAP-Server lauscht auf `127.0.0.1:5684`

Status-Property ueber CoAP abrufen:

```bash
cd packages/binding-coap
node -e "const coap=require('coap'); const req=coap.request('coap://127.0.0.1:5684/runtime/properties/status'); req.on('response',res=>{let out=''; res.on('data',c=>out+=c); res.on('end',()=>console.log('STATUS:', out));}); req.on('error',err=>console.error('ERROR:', err.message)); req.end();"
```

Thing Description der Runtime ueber CoAP abrufen:

```bash
cd packages/binding-coap
node -e "const coap=require('coap'); const req=coap.request('coap://127.0.0.1:5684/runtime'); req.setOption('Accept','application/td+json'); req.on('response',res=>{let out=''; res.on('data',c=>out+=c); res.on('end',()=>console.log(out));}); req.on('error',err=>console.error('ERROR:', err.message)); req.end();"
```

Wenn das CoAP-Binding wieder entfernt wurde, sollten diese Anfragen nicht mehr erfolgreich beantwortet werden.

## 8. Simple-Binding dynamisch laden

Das Simple-Binding liegt aktuell unter:

```text
my_runtime/bindings/simple-binding
```

Wichtig:
- das Plugin stellt einen eigenen Client und einen eigenen Server bereit
- der Server verwendet Port `8091`
- deshalb sollte beim Docker-Start `-p 8091:8091/tcp` gesetzt sein

Simple-Binding laden:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/addBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

Danach pruefen:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

### Simple-Server direkt testen

Thing Description der Runtime ueber den einfachen Server abrufen:

```bash
curl http://localhost:8091/runtime
```

Status-Property ueber den einfachen Server abrufen:

```bash
curl http://localhost:8091/runtime/properties/status
```

Registrierte Bindings ueber den einfachen Server abrufen:

```bash
curl http://localhost:8091/runtime/properties/registeredBindings
```

Simple-Binding wieder entfernen:

```bash
curl -i -X POST http://localhost:8080/runtime/actions/removeBinding \
  -H "Content-Type: application/json" \
  --data '{"id":"simple-binding"}'
```

Danach wieder pruefen:

```bash
curl http://localhost:8080/runtime/properties/registeredBindings
curl http://localhost:8080/runtime/properties/lastOperation
```

Wenn das Simple-Binding entfernt wurde, sollten Anfragen an `http://localhost:8091/...` nicht mehr erfolgreich beantwortet werden.

## 9. Was aktuell getestet wird

Mit dem Example-Binding testest du im Moment vor allem:
- ob die Runtime das Binding-Verzeichnis findet
- ob `manifest.json` gelesen wird
- ob der Entrypoint geladen wird
- ob `createBinding()` exportiert ist
- ob Client-Factory und Server formal registriert werden koennen

Du testest damit noch nicht vollstaendig ein echtes Protokollbinding, sondern zuerst den Lade- und Integrationsmechanismus der Runtime.

Beim CoAP-Binding testest du zusaetzlich, dass ein bestehendes node-wot-Binding als dynamisch ladbarer Wrapper eingebunden werden kann.

Beim Simple-Binding testest du zusaetzlich, dass ein vollstaendig eigenes Binding mit eigenem Client und eigenem Server den von der Runtime erwarteten Vertrag erfuellen und dynamisch geladen werden kann.

## 10. Typischer Ablauf bei Aenderungen

Wenn du nur `my_runtime/runtime.ts` oder `my_runtime/bindings/example-binding/*` geaendert hast:

1. laufenden Container stoppen
2. Container mit dem `docker run ...`-Befehl oben neu starten

Wenn du `packages/cli/*`, `packages/core/*` oder andere Image-relevante Dateien geaendert hast:

1. `npm run build:docker`
2. Container mit dem `docker run ...`-Befehl oben neu starten
