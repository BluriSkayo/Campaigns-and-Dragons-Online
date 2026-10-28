// red.js — Conexión WebSocket con el servidor.

/** «ws://…» fuerza conexión sin cifrar; cualquier otra forma (con o sin «wss://») es cifrada. */
export function normalizarDireccion(texto) {
  const crudo = (texto || '').trim();
  const seguro = !/^(ws|http):\/\//i.test(crudo);
  let t = crudo.replace(/^(wss?|https?):\/\//i, '').replace(/\/.*$/, '');
  if (!t) throw new Error('Escribe la dirección del servidor');
  if (!/:\d+$/.test(t)) t += ':8765';
  const url = new URL(`${seguro ? 'wss' : 'ws'}://${t}`);
  return { url: url.href.replace(/\/$/, ''), host: url.hostname, puerto: Number(url.port) || 8765, seguro };
}

class Red {
  constructor() {
    this.ws = null;
    this.manejadores = new Map();
  }

  on(tipo, fn) {
    if (!this.manejadores.has(tipo)) this.manejadores.set(tipo, new Set());
    this.manejadores.get(tipo).add(fn);
  }

  _emitir(tipo, msg) {
    for (const fn of this.manejadores.get(tipo) || []) {
      try { fn(msg); } catch (e) { console.error(`Error procesando «${tipo}»`, e); }
    }
  }

  conectar(url, espera = 6000) {
    this.cerrar(true);
    return new Promise((resolver, rechazar) => {
      let ws;
      try { ws = new WebSocket(url); } catch { return rechazar(new Error('La dirección no es válida')); }
      const plazo = setTimeout(() => {
        ws.close();
        rechazar(new Error('El servidor no responde. Comprueba la dirección y que el servidor esté encendido.'));
      }, espera);
      ws.onopen = () => { clearTimeout(plazo); this.ws = ws; resolver(); };
      ws.onerror = () => {
        clearTimeout(plazo);
        rechazar(new Error('No se pudo conectar. Comprueba la dirección y que el servidor esté encendido.'));
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg && typeof msg.tipo === 'string') this._emitir(msg.tipo, msg);
      };
      ws.onclose = () => {
        if (this.ws === ws) { this.ws = null; this._emitir('__cerrado', {}); }
      };
    });
  }

  enviar(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  /** Cierra la conexión. Si estaba abierta avisa con «__cerrado» (voluntario), salvo que `silencioso` sea true. */
  cerrar(silencioso = false) {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.close();
      if (!silencioso) this._emitir('__cerrado', { voluntario: true });
    }
  }
}

export const red = new Red();
