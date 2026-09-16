#!/usr/bin/env node
/**
 * arca-agro-mcp — servidor MCP de solo lectura para los web services
 * agropecuarios de ARCA (Argentina).
 *
 * Expone consulta de cartas de porte electrónicas, padrón de contribuyentes y
 * comprobantes emitidos.
 *
 * QUÉ NO EXPONE, Y POR QUÉ: ninguna operación que modifique algo en ARCA. No
 * autoriza ni anula cartas de porte, no pide CAE, no presenta nada. La librería
 * de abajo, `arca-agro-client`, tampoco las implementa — la restricción es de
 * construcción, no una convención de este archivo. Un modelo que se equivoca
 * emitiendo un documento fiscal genera un hecho irreversible ante el organismo.
 *
 * Variables de entorno:
 *   ARCA_CERT   ruta al certificado X.509 otorgado por ARCA        (obligatoria)
 *   ARCA_KEY    ruta a la clave privada                            (obligatoria)
 *   ARCA_CUIT   CUIT representado, sin guiones                     (obligatoria)
 *   ARCA_ENV    'production' (default) o 'testing'
 *   ARCA_CACHE_DIR  dónde guardar los Tickets de Acceso
 *
 * stdout es el canal JSON-RPC del protocolo: acá no se imprime nada. El
 * progreso de la librería sale por stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient, GRANOS } from 'arca-agro-client';

const VERSION = '1.0.0';

// Cuántas cartas de porte se listan en detalle cuando no se pide el crudo.
const CPES_EN_RESUMEN = 20;

const CTG = z
  .string()
  .regex(/^\d{6,12}$/, 'El CTG es un número de entre 6 y 12 dígitos')
  .describe('Número de CTG (Código de Trazabilidad de Granos) de la carta de porte');

const FECHA = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD');

const CUIT = z
  .string()
  .regex(/^\d{2}-?\d{8}-?\d$/, 'CUIT de 11 dígitos, con o sin guiones');

// El cliente se construye en la primera consulta y no al arrancar: si falta
// una credencial queremos que el agente lea un error, no que el servidor
// no levante y el usuario vea el MCP en rojo sin explicación.
let cliente = null;
function arca() {
  if (!cliente) cliente = createClient();
  return cliente;
}

function texto(contenido) {
  return { content: [{ type: 'text', text: contenido }] };
}

function error(e) {
  return {
    content: [{ type: 'text', text: `Error consultando ARCA: ${e?.message || String(e)}` }],
    isError: true,
  };
}

const kg = (n) =>
  n === null || n === undefined
    ? 's/d'
    : `${new Intl.NumberFormat('es-AR').format(n)} kg`;

const server = new McpServer({ name: 'arca-agro', version: VERSION });

// --- Cartas de porte ---------------------------------------------------------

server.registerTool(
  'consultar_cpe',
  {
    title: 'Consultar una carta de porte',
    description:
      'Datos completos de una carta de porte electrónica a partir de su CTG: grano, ' +
      'pesos, estado, fechas y los CUIT que intervienen. Incluye los pesos tomados en ' +
      'la balanza del destino, que son los que sirven para conciliar contra balanza propia.',
    inputSchema: { nroCTG: CTG },
  },
  async ({ nroCTG }) => {
    try {
      const c = await arca().wscpe.consultar(nroCTG);

      if (c.errores?.length && !c.estado) {
        return texto(
          `ARCA no devolvió datos para el CTG ${nroCTG}:\n` +
            c.errores.map((e) => `- ${e.codigo ?? ''} ${e.descripcion}`.trim()).join('\n'),
        );
      }

      const lineas = [
        `Carta de porte CTG ${c.nroCTG}${c.nroCPE ? ` (CPE ${c.nroCPE})` : ''}`,
        `  estado: ${c.estado ?? 's/d'} | grano: ${c.grano ?? c.codGrano ?? 's/d'} | cosecha: ${c.cosecha ?? 's/d'}`,
        `  emitida: ${c.fechaEmision ?? 's/d'}${c.fechaVencimiento ? ` | vence: ${c.fechaVencimiento}` : ''}`,
        `  peso declarado: bruto ${kg(c.pesoBruto)} | tara ${kg(c.pesoTara)} | neto ${kg(c.pesoNeto)}`,
      ];

      if (c.pesoNetoDescarga !== null) {
        const pct =
          c.pesoNeto ? ` (${((c.diferenciaDescarga / c.pesoNeto) * 100).toFixed(1)} %)` : '';
        lineas.push(
          `  peso en destino: neto ${kg(c.pesoNetoDescarga)}` +
            (c.diferenciaDescarga !== null
              ? ` | diferencia contra lo declarado: ${kg(c.diferenciaDescarga)}${pct}`
              : ''),
        );
      } else if (c.estado === 'AN') {
        lineas.push('  peso en destino: la carta está anulada, no hubo descarga');
      } else if (c.estado && c.estado !== 'CN') {
        lineas.push('  peso en destino: sin descargar todavía');
      }

      lineas.push(
        `  origen: ${c.cuitOrigen ?? 's/d'} | destinatario: ${c.cuitDestinatario ?? 's/d'}`,
        `  destino: ${c.cuitDestino ?? 's/d'}${c.plantaDestino ? ` (planta ${c.plantaDestino})` : ''}`,
        `  transportista: ${c.cuitTransportista ?? 's/d'}` +
          (c.dominios?.length ? ` | dominios: ${c.dominios.join(', ')}` : ''),
      );

      if (c.errores?.length) {
        lineas.push(
          `  observaciones de ARCA: ${c.errores.map((e) => e.descripcion).join('; ')}`,
        );
      }
      return texto(lineas.join('\n'));
    } catch (e) {
      return error(e);
    }
  },
);

server.registerTool(
  'cpes_recibidas_en_planta',
  {
    title: 'Cartas de porte recibidas en una planta',
    description:
      'Cartas de porte que LLEGARON a una planta propia dentro de un rango de fechas. ' +
      'Es la consulta del que recibe la mercadería, no del que la despacha: ARCA exige el ' +
      'número de planta y no ofrece el listado inverso. Quien solo despacha no puede usar esto. ' +
      `Por defecto devuelve un resumen (totales por grano y las ${CPES_EN_RESUMEN} más recientes); ` +
      'pedir detalle solo para rangos cortos, porque una campaña entera son cientos de cartas.',
    inputSchema: {
      planta: z
        .number()
        .int()
        .describe('Número de planta de destino. Obligatorio: ARCA rechaza la consulta sin él.'),
      desde: FECHA.describe('Fecha de partida desde, YYYY-MM-DD'),
      hasta: FECHA.describe('Fecha de partida hasta, YYYY-MM-DD'),
      detalle: z
        .boolean()
        .optional()
        .describe('Si es true, lista todas las cartas en vez del resumen.'),
    },
  },
  async ({ planta, desde, hasta, detalle = false }) => {
    try {
      const lista = await arca().wscpe.porFecha(planta, desde, hasta);
      if (lista.length === 0) {
        return texto(
          `Sin cartas de porte recibidas en la planta ${planta} entre ${desde} y ${hasta}.`,
        );
      }

      // ARCA devuelve un resumen pelado: CTG, tipo, estado y fechas. No hay
      // grano ni pesos que agrupar — para eso hay que consultar cada CTG.
      const porEstado = new Map();
      for (const c of lista) {
        const clave = c.estado ?? 's/d';
        porEstado.set(clave, (porEstado.get(clave) ?? 0) + 1);
      }

      const lineas = [
        `${lista.length} cartas de porte recibidas en la planta ${planta} entre ${desde} y ${hasta}`,
        `  por estado: ${[...porEstado.entries()].map(([e, n]) => `${e}: ${n}`).join(' | ')}`,
        '  ARCA no manda grano ni pesos en este listado; para el detalle de una,',
        '  usar consultar_cpe con su CTG.',
        '',
      ];

      const mostrar = detalle
        ? lista
        : [...lista]
            .sort((a, b) => String(b.fechaPartida).localeCompare(String(a.fechaPartida)))
            .slice(0, CPES_EN_RESUMEN);

      for (const c of mostrar) {
        lineas.push(
          `  ${c.fechaPartida ?? 's/f'} | CTG ${c.nroCTG} | tipo ${c.tipoCartaPorte ?? 's/d'} | ${c.estado ?? 's/d'}`,
        );
      }

      if (!detalle && lista.length > mostrar.length) {
        lineas.push(`    ... y ${lista.length - mostrar.length} más (pedir detalle para verlas)`);
      }
      return texto(lineas.join('\n'));
    } catch (e) {
      return error(e);
    }
  },
);

server.registerTool(
  'tipos_de_grano',
  {
    title: 'Tabla de códigos de grano',
    description:
      'Códigos de grano que reconoce ARCA hoy, consultados en vivo. Útil para traducir ' +
      'el código que trae una carta de porte, y para descartar códigos de planillas ' +
      'viejas que el organismo ya no reconoce.',
    inputSchema: {},
  },
  async () => {
    try {
      const tabla = await arca().wscpe.tiposDeGrano();
      if (tabla.length === 0) {
        // Si ARCA no responde la tabla, la copia verificada sirve igual.
        return texto(
          'ARCA no devolvió la tabla. Códigos verificados en marzo de 2026:\n' +
            Object.entries(GRANOS).map(([c, d]) => `  ${c}: ${d}`).join('\n'),
        );
      }
      return texto(
        `${tabla.length} granos:\n` +
          tabla.map((g) => `  ${g.codigo}: ${g.descripcion}`).join('\n'),
      );
    } catch (e) {
      return error(e);
    }
  },
);

server.registerTool(
  'ultimo_nro_orden',
  {
    title: 'Último número de orden de CPE',
    description:
      'Último número de orden de carta de porte emitido para una sucursal y tipo de CPE. ' +
      'Sirve para detectar saltos de numeración.',
    inputSchema: {
      sucursal: z.number().int().min(0).optional().describe('Número de sucursal. Default: 0.'),
      tipoCPE: z
        .number()
        .int()
        .optional()
        .describe('Tipo de CPE. Default: 74 (carta de porte automotor).'),
    },
  },
  async ({ sucursal = 0, tipoCPE = 74 }) => {
    try {
      const r = await arca().wscpe.ultimoNroOrden(sucursal, tipoCPE);
      return texto(
        `Sucursal ${r.sucursal}, tipo ${r.tipoCPE}: último número de orden ${r.nroOrden ?? 's/d'}`,
      );
    } catch (e) {
      return error(e);
    }
  },
);

// --- Padrón ------------------------------------------------------------------

server.registerTool(
  'consultar_padron',
  {
    title: 'Consultar el padrón por CUIT',
    description:
      'Razón social, estado de la clave fiscal, domicilio fiscal, forma jurídica y ' +
      'actividad principal de un CUIT. Sirve para saber contra quién se está operando. ' +
      'El régimen impositivo (monotributo vs. general) solo aparece si el certificado ' +
      'tiene habilitado el alcance A5 del padrón, que se pide aparte en ARCA.',
    inputSchema: { cuit: CUIT.describe('CUIT a consultar, con o sin guiones') },
  },
  async ({ cuit }) => {
    try {
      const p = await arca().padron.consultar(cuit);
      if (!p.encontrado) {
        return texto(`ARCA no tiene datos para el CUIT ${p.cuit}: ${p.error ?? 'sin detalle'}`);
      }

      const lineas = [
        `${p.razonSocial ?? 's/d'} (CUIT ${p.cuit})`,
        `  tipo: ${p.tipoPersona ?? 's/d'} | clave: ${p.estadoClave ?? 's/d'} | régimen: ${p.regimen ?? 's/d'}`,
      ];
      if (p.formaJuridica) lineas.push(`  forma jurídica: ${p.formaJuridica}${p.mesCierre ? ` | cierre de ejercicio: mes ${p.mesCierre}` : ''}`);
      if (p.categoriaMonotributo) lineas.push(`  categoría: ${p.categoriaMonotributo}`);
      if (p.domicilio) {
        lineas.push(
          `  domicilio: ${[p.domicilio.direccion, p.domicilio.localidad, p.domicilio.provincia]
            .filter(Boolean)
            .join(', ') || 's/d'}${p.domicilio.tipo ? ` (${p.domicilio.tipo})` : ''}`,
        );
      }
      if (p.impuestos?.length) {
        lineas.push(
          `  impuestos: ${p.impuestos
            .map((i) => `${i.descripcion ?? i.id}${i.estado ? ` (${i.estado})` : ''}`)
            .join(', ')}`,
        );
      }
      if (p.actividades?.length) {
        lineas.push(
          `  actividades: ${p.actividades.map((a) => a.descripcion ?? a.id).join(', ')}`,
        );
      }
      return texto(lineas.join('\n'));
    } catch (e) {
      return error(e);
    }
  },
);

// --- Comprobantes ------------------------------------------------------------

server.registerTool(
  'consultar_comprobante',
  {
    title: 'Consultar un comprobante emitido',
    description:
      'Detalle de un comprobante ya emitido: importes, IVA, CAE y estado. Solo consulta: ' +
      'no autoriza comprobantes ni pide CAE.',
    inputSchema: {
      puntoVenta: z.number().int().describe('Punto de venta'),
      tipoComprobante: z.number().int().describe('Tipo de comprobante (1 = Factura A, 6 = Factura B, ...)'),
      numero: z.number().int().describe('Número de comprobante'),
    },
  },
  async ({ puntoVenta, tipoComprobante, numero }) => {
    try {
      const c = await arca().wsfe.consultarComprobante(puntoVenta, tipoComprobante, numero);
      const plata = (n) =>
        n === null || n === undefined
          ? 's/d'
          : new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(n);

      const lineas = [
        `Comprobante tipo ${c.tipoComprobante} N° ${c.nroComprobante} (pto. vta. ${c.puntoVenta})`,
        `  fecha: ${c.fechaComprobante ?? 's/d'} | receptor: ${c.documentoReceptor ?? 's/d'}`,
        `  total: ${plata(c.importeTotal)} ${c.moneda ?? ''} | neto: ${plata(c.importeNeto)} | IVA: ${plata(c.importeIVA)}`,
        `  CAE: ${c.cae ?? 's/d'} | resultado: ${c.resultado ?? 's/d'}`,
      ];
      if (c.observaciones?.length) {
        lineas.push(`  observaciones: ${c.observaciones.map((o) => o.mensaje).join('; ')}`);
      }
      return texto(lineas.join('\n'));
    } catch (e) {
      return error(e);
    }
  },
);

// --- Diagnóstico -------------------------------------------------------------

server.registerTool(
  'estado_servicios',
  {
    title: 'Estado de los servicios de ARCA',
    description:
      'Chequea si los servidores de ARCA están respondiendo. No usa el certificado ni ' +
      'consulta datos de nadie: es lo primero que conviene mirar cuando algo falla, ' +
      'para separar una caída del organismo de un problema de credenciales.',
    inputSchema: {},
  },
  async () => {
    const cli = (() => {
      try {
        return arca();
      } catch {
        return null;
      }
    })();

    if (!cli) {
      return texto(
        'No hay credenciales configuradas, así que no se puede chequear ningún servicio.\n' +
          'Faltan ARCA_CERT, ARCA_KEY o ARCA_CUIT.',
      );
    }

    const servicios = [
      ['Cartas de porte (WSCPE)', () => cli.wscpe.dummy()],
      ['Padrón', () => cli.padron.dummy()],
      ['Comprobantes (WSFE)', () => cli.wsfe.dummy()],
    ];

    const lineas = [];
    for (const [nombre, chequear] of servicios) {
      try {
        const d = await chequear();
        const ok = [d.appServer, d.dbServer, d.authServer].every(
          (v) => String(v).toUpperCase() === 'OK',
        );
        lineas.push(
          `  ${ok ? 'OK' : 'CON PROBLEMAS'} — ${nombre} ` +
            `(app ${d.appServer ?? '?'}, base ${d.dbServer ?? '?'}, auth ${d.authServer ?? '?'})`,
        );
      } catch (e) {
        // Un certificado que falta es problema de configuración, no una caída
        // del organismo: decir "SIN RESPUESTA" mandaba a revisar ARCA al pedo.
        const esConfig = /no se encontró|certificado|clave privada|openssl/i.test(e.message);
        lineas.push(
          esConfig
            ? `  NO SE PUDO CHEQUEAR — ${nombre}: ${e.message}`
            : `  SIN RESPUESTA — ${nombre}: ${e.message}`,
        );
      }
    }
    return texto(`Estado de los servicios de ARCA:\n${lineas.join('\n')}`);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
