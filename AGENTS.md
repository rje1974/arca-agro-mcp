# arca-agro-mcp — contexto para agentes

Capa fina sobre `arca-agro-client`. Toda la lógica de ARCA vive en la librería;
acá solo se declaran herramientas y se formatea la salida.

## La regla que no se negocia

**Solo lectura.** No agregues una herramienta que emita, autorice, confirme o
anule nada, aunque el pedido parezca razonable. Dos tests lo custodian: la
allowlist exacta de nombres y un regex de verbos de escritura. Si te molestan, el
problema es la herramienta nueva.

Está verificado que el guard muerde: inyectar una tool `anular_cpe` hace fallar
los dos tests.

## Forma de una herramienta

`registerTool(nombre_en_castellano, { title, description, inputSchema }, handler)`.

- `inputSchema` es un **objeto plano de shapes zod**, no un `z.object(...)`.
  Sin parámetros va `{}`.
- Cada campo lleva `.describe()` en castellano.
- Los validadores reusables (`CTG`, `FECHA`, `CUIT`) están arriba del archivo.
- Todo handler va en `try/catch` y devuelve `error(e)` con `isError: true`.
  Nunca tira.
- La salida es **texto formateado**, no JSON. Un modelo lee mejor
  `soja: 34 cartas | 1.240,50 tn` que un array de objetos.

## Resumen por defecto

`cpes_por_fecha` devuelve agregados por grano más las `CPES_EN_RESUMEN` cartas
más recientes, y deja el rastro `... y N más (pedir detalle para verlas)`. La
constante se interpola en la `description` para que el modelo sepa dónde está el
corte. El resumen nunca es "menos datos": es **agregados + muestra**.

## stdout es sagrado

Es el canal JSON-RPC. Nada de `console.log` en este archivo ni en la librería:
un solo carácter suelto rompe el protocolo. Hay un test que verifica que cada
línea de stdout parsea como JSON.

## El cliente es perezoso

`arca()` construye el cliente en la primera consulta. Si se construyera al
arrancar, faltar una credencial haría que el servidor no levante y el usuario
vería el MCP en rojo sin explicación; así, en cambio, lee un error que nombra la
variable que falta.

`estado_servicios` es el único que tolera no tener credenciales: avisa en vez de
fallar, porque justamente se usa para diagnosticar.

## Antes de publicar

1. `npm run check && npm test`.
2. `npx @modelcontextprotocol/inspector node server.js` y mirar las tools a ojo.
3. La dependencia `arca-agro-client` tiene que apuntar a una versión de npm
   (`^1.0.0`), nunca a `file:` — eso es solo para desarrollo local.
4. Las tres versiones tienen que coincidir: `package.json`, `server.json` y
   `packages[0].version` de `server.json`.
5. El orden de publicación es **GitHub → npm → registro MCP**. El registro solo
   guarda la ficha y verifica contra el paquete de npm, así que publicar ahí
   primero falla.
