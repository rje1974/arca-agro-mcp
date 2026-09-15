import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';

const SERVER = path.join(import.meta.dirname, '..', 'server.js');

// Credenciales que no existen: alcanza para que el servidor levante y liste sus
// herramientas. Ninguna de estas pruebas sale a la red ni firma nada.
const ENV_FALSO = {
  ...process.env,
  ARCA_CERT: '/no/existe/x.crt',
  ARCA_KEY: '/no/existe/x.key',
  ARCA_CUIT: '30123456789',
};

const HANDSHAKE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  },
};

function hablarConElServidor(mensajes, env = ENV_FALSO) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVER], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', () => {
      const respuestas = stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      resolve({ respuestas, stdout, stderr });
    });

    for (const m of [HANDSHAKE, ...mensajes]) proc.stdin.write(`${JSON.stringify(m)}\n`);
    // El servidor necesita un momento para responder antes de que se cierre stdin.
    setTimeout(() => proc.stdin.end(), 1500);
  });
}

const listarTools = async () => {
  const { respuestas } = await hablarConElServidor([
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);
  return respuestas.find((r) => r.id === 2)?.result?.tools ?? [];
};

test('el servidor responde el handshake con su nombre', async () => {
  const { respuestas } = await hablarConElServidor([]);
  const init = respuestas.find((r) => r.id === 1);
  assert.equal(init?.result?.serverInfo?.name, 'arca-agro');
});

test('expone exactamente las siete herramientas de consulta', async () => {
  const nombres = (await listarTools()).map((t) => t.name).sort();
  assert.deepEqual(nombres, [
    'consultar_comprobante',
    'consultar_cpe',
    'consultar_padron',
    'cpes_por_fecha',
    'estado_servicios',
    'tipos_de_grano',
    'ultimo_nro_orden',
  ]);
});

test('ninguna herramienta permite escribir en ARCA', async () => {
  const sospechosas = /anular|autorizar|emitir|generar|confirmar|rechazar|solicitar|crear|enviar|informar|presentar/i;
  for (const t of await listarTools()) {
    assert.ok(!sospechosas.test(t.name), `"${t.name}" parece permitir escritura`);
  }
});

test('toda herramienta explica que hace', async () => {
  for (const t of await listarTools()) {
    assert.ok(t.description?.length > 40, `"${t.name}" tiene una descripcion demasiado corta`);
  }
});

test('nada fuera del protocolo se escribe en stdout', async () => {
  const { stdout } = await hablarConElServidor([
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);
  for (const linea of stdout.split('\n').filter(Boolean)) {
    assert.doesNotThrow(() => JSON.parse(linea), `stdout contaminado: ${linea}`);
  }
});

test('sin credenciales devuelve un error legible y el servidor sigue vivo', async () => {
  const env = { ...process.env };
  delete env.ARCA_CERT;
  delete env.ARCA_KEY;
  delete env.ARCA_CUIT;

  const { respuestas } = await hablarConElServidor(
    [
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'consultar_cpe', arguments: { nroCTG: '12345678901' } },
      },
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
    ],
    env,
  );

  const llamada = respuestas.find((r) => r.id === 2);
  assert.ok(llamada?.result?.isError, 'deberia marcarse como error');
  assert.match(JSON.stringify(llamada.result), /ARCA_CERT|cert/);
  assert.ok(respuestas.find((r) => r.id === 3), 'el servidor deberia seguir respondiendo');
});

test('un CTG con letras se rechaza antes de salir a la red', async () => {
  const { respuestas } = await hablarConElServidor([
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'consultar_cpe', arguments: { nroCTG: 'abc' } },
    },
  ]);
  const r = respuestas.find((x) => x.id === 2);
  assert.match(JSON.stringify(r), /dígitos|digitos|invalid/i);
});

test('estado_servicios avisa cuando faltan credenciales en vez de fallar', async () => {
  const env = { ...process.env };
  delete env.ARCA_CERT;
  delete env.ARCA_KEY;
  delete env.ARCA_CUIT;

  const { respuestas } = await hablarConElServidor(
    [
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'estado_servicios', arguments: {} },
      },
    ],
    env,
  );
  const r = respuestas.find((x) => x.id === 2);
  assert.match(JSON.stringify(r?.result), /credenciales/i);
});
