# Política de privacidad — arca-agro-mcp

*Última actualización: 20 de septiembre de 2026.*

## Lo corto

Este servidor corre en tu propia máquina, con tus propias credenciales, y habla únicamente con
los servicios de ARCA. **No recolectamos nada, no mandamos nada a ningún lado y no tenemos forma
de ver qué consultás.**

## Dónde corre

`arca-agro-mcp` es un servidor MCP local: lo ejecuta tu cliente en tu equipo y se comunica por
entrada y salida estándar. No hay servidor nuestro en el medio. No hospedamos ningún servicio.

## Qué credenciales usa y de dónde salen

Se configuran como variables de entorno en tu equipo:

| Variable | Qué es |
|---|---|
| `ARCA_CUIT` | El CUIT con el que consultás |
| `ARCA_CERT` | Tu certificado digital de ARCA |
| `ARCA_KEY` | Tu clave privada |
| `ARCA_ENV` | Si apuntás a producción o a homologación |
| `ARCA_CACHE_DIR` | Dónde se guarda el ticket de acceso (ver abajo) |

**El certificado y la clave nunca salen de tu equipo hacia nosotros.** Se usan solo para firmar
el pedido de acceso ante ARCA, que es el único destinatario.

## A dónde se conecta

Únicamente a los servicios de ARCA, es decir a `aws.afip.gov.ar`, `cpea-ws.afip.gob.ar` y sus
equivalentes de homologación. **A ningún otro lado.** No hay telemetría, ni estadísticas de uso,
ni servicio de errores, ni llamadas a terceros.

## Qué se guarda en disco

Dos cosas, las dos en `ARCA_CACHE_DIR` y las dos con permisos `0600`, o sea legibles únicamente
por tu usuario:

- El **ticket de acceso** que devuelve ARCA, cacheado para no pedir uno nuevo en cada consulta.
- El **TRA**, que es el pedido de acceso en XML que se le firma y se le manda a ARCA.

Son archivos temporales, viven en tu equipo y podés borrarlos cuando quieras: el servidor genera
otros. **No se guardan las respuestas de las consultas ni ningún registro de lo que preguntaste.**

## Lo que sí tenés que tener en cuenta

Las respuestas de este servidor —datos de cartas de porte, del padrón y de comprobantes— **se las
devuelve a tu cliente MCP**, que en general es un asistente de inteligencia artificial operado por
otra empresa. Qué hace ese cliente con esa información se rige por *su* política de privacidad,
no por esta.

Si vas a consultar datos sensibles, revisá antes las condiciones del cliente que estés usando. Es
la única parte del recorrido que este servidor no controla, y nos parece más honesto decirlo que
omitirlo.

## Datos de terceros

Las consultas de padrón y de comprobantes devuelven datos de otras personas o empresas. Sos vos
quien decide consultarlos y quien responde por el uso que les dé, de acuerdo con la normativa
argentina de protección de datos personales. Esta herramienta solo te acerca lo que ARCA ya te
permite ver con tu propio certificado.

## Cambios

Si esto cambia, se actualiza este archivo y queda registrado en el historial del repositorio.

## Contacto

Por los issues del repositorio: <https://github.com/rje1974/arca-agro-mcp/issues>

---

## Summary in English

`arca-agro-mcp` is a local MCP server. It runs on the user's own machine over stdio, uses the
user's own ARCA (Argentine tax authority) digital certificate, and connects only to ARCA web
services. No data is collected, transmitted to the author, or shared with third parties. There is
no telemetry and no hosted component. The only thing written to disk is ARCA's own access ticket,
cached locally (mode 0600) to avoid re-authenticating on every call, together with the signed
access request (TRA) sent to ARCA. Query results are never written to disk, and are returned to the user's
MCP client, which may be an AI assistant operated by another company and governed by its own
privacy policy.
