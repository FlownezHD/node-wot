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
- Aenderungen an `src/runtime.ts` oder `src/bindings/*` brauchen normalerweise kein neues Image, weil diese spaeter per Volume in den Container gemountet werden.

## 3. Runtime im Container starten

Die Runtime wird als WoT-Script ueber die CLI gestartet. Dabei wird das ganze Repo nach `/workspace` gemountet, damit `src/runtime.ts` und die lokalen Bindings verfuegbar sind.

```bash
docker run -it --init \
  -p 8080:8080/tcp \
  -p 5683:5683/udp \
  -p 5684:5684/udp \
  -e TS_NODE_PROJECT=/workspace/src/tsconfig.json \
  -e TS_NODE_FILES=true \
  -v "$(pwd):/workspace" \
  --rm \
  node-wot /workspace/src/runtime.ts
```

Die wichtigen Punkte dabei sind:
- `TS_NODE_PROJECT=/workspace/src/tsconfig.json`: nutzt den TS-Kontext fuer `src/runtime.ts`
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
src/bindings/example-binding
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
src/bindings/coap-binding
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

## 8. Was aktuell getestet wird

Mit dem Example-Binding testest du im Moment vor allem:
- ob die Runtime das Binding-Verzeichnis findet
- ob `manifest.json` gelesen wird
- ob der Entrypoint geladen wird
- ob `createBinding()` exportiert ist
- ob Client-Factory und Server formal registriert werden koennen

Du testest damit noch nicht vollstaendig ein echtes Protokollbinding, sondern zuerst den Lade- und Integrationsmechanismus der Runtime.

Beim CoAP-Binding testest du zusaetzlich, dass ein bestehendes node-wot-Binding als dynamisch ladbarer Wrapper eingebunden werden kann.

## 9. Typischer Ablauf bei Aenderungen

Wenn du nur `src/runtime.ts` oder `src/bindings/example-binding/*` geaendert hast:

1. laufenden Container stoppen
2. Container mit dem `docker run ...`-Befehl oben neu starten

Wenn du `packages/cli/*`, `packages/core/*` oder andere Image-relevante Dateien geaendert hast:

1. `npm run build:docker`
2. Container mit dem `docker run ...`-Befehl oben neu starten
