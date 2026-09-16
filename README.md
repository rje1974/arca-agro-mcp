# arca-agro-mcp

[![npm](https://img.shields.io/npm/v/arca-agro-mcp)](https://www.npmjs.com/package/arca-agro-mcp)
[![Registro MCP](https://img.shields.io/badge/registro%20MCP-io.github.rje1974%2Farca--agro-blue)](https://registry.modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**El primer servidor MCP que consulta cartas de porte electrónicas de ARCA.**
Los demás MCP argentinos del organismo se detienen en factura electrónica y
padrón.

Servidor MCP para consultar los web services **agropecuarios** de ARCA (ex AFIP)
desde un agente: cartas de porte electrónicas, padrón de contribuyentes y
comprobantes.

**Es de solo lectura, y eso no es una convención de este repo sino una decisión
de diseño.** Ninguna herramienta autoriza, confirma o anula documentos fiscales,
y la librería que usa por debajo —[`arca-agro-client`](https://github.com/rje1974/arca-agro-client)—
tampoco implementa esas operaciones: no hay una bandera que las habilite. Una
carta de porte anulada por error es un hecho irreversible ante el organismo, y un
modelo de lenguaje no debería tener esa capacidad al alcance. Hay tests que
fallan si aparece una herramienta con nombre de escritura.

## Instalación

No hace falta instalar nada: se descarga solo al arrancar.

### Claude Code

```bash
claude mcp add arca-agro \
  --env ARCA_CERT=/ruta/al/certificado.crt \
  --env ARCA_KEY=/ruta/a/la/clave.key \
  --env ARCA_CUIT=30123456789 \
  -- npx -y arca-agro-mcp
```

### Claude Desktop u otro cliente con archivo de configuración

```json
{
  "mcpServers": {
    "arca-agro": {
      "command": "npx",
      "args": ["-y", "arca-agro-mcp"],
      "env": {
        "ARCA_CERT": "/ruta/al/certificado.crt",
        "ARCA_KEY": "/ruta/a/la/clave.key",
        "ARCA_CUIT": "30123456789"
      }
    }
  }
}
```

Necesita Node 18+ y el comando `openssl` disponible, que se usa para firmar
localmente el pedido de ticket.

## Qué hace falta antes

1. Un **certificado X.509** emitido por ARCA para tu CUIT, con su clave privada.
   Se tramita en el portal, en *Administración de Certificados Digitales*.
2. Tener **habilitado cada servicio** en el Administrador de Relaciones. WSCPE,
   padrón y comprobantes se habilitan por separado.

> La clave privada nunca sale de tu máquina: se usa para firmar el pedido de
> ticket y nada más. Aun así, es una credencial fiscal — tratala como tal y no
> la pongas en un archivo de configuración compartido.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `consultar_cpe` | Datos de una carta de porte por su CTG: grano, pesos, estado, CUIT que intervienen. |
| `cpes_recibidas_en_planta` | Cartas de porte que **llegaron a una planta propia** en un rango. Es la consulta del que recibe. |
| `tipos_de_grano` | Códigos de grano que ARCA reconoce hoy, consultados en vivo. |
| `ultimo_nro_orden` | Último número de orden emitido, para detectar saltos de numeración. |
| `consultar_padron` | Razón social, estado de clave, domicilio, régimen e impuestos de un CUIT. |
| `consultar_comprobante` | Detalle de un comprobante emitido: importes, IVA, CAE. |
| `estado_servicios` | Si los servidores de ARCA responden. No usa el certificado. |

Preguntas que contesta bien:

- *¿Qué dice la carta de porte con CTG 12345678901?*
- *¿Cuántas toneladas de soja entraron a la planta 22397 entre marzo y mayo?*
- *¿Quién es el CUIT 30500120882 y qué régimen tiene?*
- *¿Hay algún salto en la numeración de mis cartas de porte?*
- *¿ARCA está caído o es problema de mis credenciales?*

### Sobre el volumen de datos

`cpes_recibidas_en_planta` devuelve por defecto un **resumen**: totales por grano más las
20 cartas más recientes. Una campaña entera son cientos de cartas y volcarlas
todas llena la ventana de contexto sin que nadie las lea. Con `detalle: true` se
listan completas — conviene solo para rangos cortos.

El PDF de la carta de porte tampoco viaja: pesa cientos de KB y no le sirve a un
modelo. Si hace falta el archivo, se baja con la librería.

## Qué hay abajo

Todo el trabajo sucio lo hace [`arca-agro-client`](https://github.com/rje1974/arca-agro-client),
donde además están documentados los quirks que cuesta descubrir: por qué el
Ticket de Acceso hay que cachearlo en disco, por qué el `SOAPAction` de WSCPE no
coincide con el nombre del elemento raíz, y por qué los comprobantes no conectan
con `fetch`.

### Lo que ARCA no deja hacer

**No hay forma de listar por web service las cartas de porte que uno despacha.**
`consultarCPEPorDestino` lista lo que *llega* a una planta propia y exige su
número. Un productor que solo despacha no tiene con qué: ese listado solo se
consigue por el portal. Conviene saberlo antes de perder una tarde buscando el
parámetro correcto.

## Qué no cubre

**WSLPG** (liquidación primaria de granos) no está: el servicio no permite
listar por CUIT ni devuelve el PDF, así que no resuelve el caso de uso real, que
es conciliar todo lo recibido.

Tampoco los remitos electrónicos ni las liquidaciones sectoriales (tabaco,
lechería, pecuario). Se pueden agregar.

## Desarrollo

```bash
npm install
npm run check
npm test
npx @modelcontextprotocol/inspector node server.js
```

## Aviso

Proyecto independiente, sin relación con ARCA. Verificá contra la fuente oficial
antes de tomar una decisión fiscal o comercial.

## Licencia

MIT
