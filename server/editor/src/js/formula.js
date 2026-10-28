// formula.js — Revisión rápida de fórmulas mientras se escriben (la definitiva la hace el servidor: mesa/formulas.py).
// Misma sintaxis: números (1,5 o 1.5), dados (2d6), [a.X] [o.X] [h.X] [X], + - * / %, ( ), < > <= >= = <>,
// y funciones con argumentos separados por «;»: max, min, redondear, abajo, arriba, abs, si, tabla(Nombre; valor).

export const FUNCIONES = { max: [1, 20], min: [1, 20], redondear: [1, 1], abajo: [1, 1], arriba: [1, 1], abs: [1, 1], si: [3, 3], tabla: [2, 2], ventaja: [0, 0] };
export const MAX_LONGITUD = 1000;

/**
 * → texto del problema, o '' si está bien.
 * nombres: estadísticas y recursos de la campaña; opciones.tablas: nombres de tablas; opciones.valoresHabilidad: nombres para [h.X] (null = no es de una habilidad).
 */
export function revisarFormula(texto, nombres, { tablas = [], valoresHabilidad = null } = {}) {
  const t = String(texto || '').trim();
  if (!t) return 'Escribe una fórmula.';
  if (t.length > MAX_LONGITUD) return `La fórmula es demasiado larga (máximo ${MAX_LONGITUD} letras).`;
  const conocidos = new Set(nombres.map((n) => n.toLowerCase()));
  const nTablas = new Set(tablas.map((n) => n.trim().toLowerCase()));
  const vh = valoresHabilidad ? new Set(valoresHabilidad.map((n) => n.trim().toLowerCase())) : null;
  const f = [];          // fichas: {t: 'n'|'('|')'|'op'|'cmp'|';'|'fn', v}
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    const resto = t.slice(i);
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[') {
      const fin = t.indexOf(']', i);
      const dentro = fin > i ? t.slice(i + 1, fin) : '';
      if (fin > i && !dentro.includes('[') && /^(?:[aoh]\s*\.)?[^\d\s+\-*/%()[\];<>=,][^+\-*/%()[\];<>=]*$/i.test(dentro.trim())) {
        const m = /^([aoh])\s*\.\s*(.*)$/i.exec(dentro.trim());
        const pre = m ? m[1].toLowerCase() : 'a';
        const nombre = (m ? m[2] : dentro).trim();
        if (pre === 'h') {
          if (!vh) return `[h.${nombre}] solo se puede usar en la fórmula de una habilidad.`;
          if (!vh.has(nombre.toLowerCase())) return `La habilidad no tiene el valor «${nombre}» (añádelo en «Valores propios»).`;
        } else if (!conocidos.has(nombre.toLowerCase())) return `«${nombre}» no es una estadística ni un recurso de la campaña.`;
        f.push({ t: 'n' }); i = fin + 1; continue;
      }
      f.push({ t: '(' }); i++; continue;
    }
    if (c === ']' || c === ')') { f.push({ t: ')' }); i++; continue; }
    if (c === '(') { f.push({ t: '(' }); i++; continue; }
    if (c === ';') { f.push({ t: ';' }); i++; continue; }
    if (c === ',') return 'Separa los argumentos con «;» (la coma es para decimales: 1,5).';
    let m = /^(<=|>=|<>|<|>|=)/.exec(resto);
    if (m) { f.push({ t: 'cmp' }); i += m[0].length; continue; }
    if ('+-*/%'.includes(c)) { f.push({ t: 'op', v: c }); i++; continue; }
    m = /^(\d*)d(\d+)(?![\w])/i.exec(resto);
    if (m && !/[\w.]/.test(t[i - 1] || '')) {
      const n = m[1] ? Number(m[1]) : 1, caras = Number(m[2]);
      if (n < 1 || n > 100 || caras < 1 || caras > 1000) return `Dado no permitido: ${n}d${caras} (hasta 100 dados de 1000 caras).`;
      f.push({ t: 'n' }); i += m[0].length; continue;
    }
    m = /^\d+(?:[.,]\d+)?/.exec(resto);
    if (m) { f.push({ t: 'n' }); i += m[0].length; continue; }
    m = /^([a-zñáéíóú_]+)\s*\(/i.exec(resto);
    if (m) {
      const nombre = m[1].toLowerCase();
      if (!FUNCIONES[nombre]) return `Función desconocida: «${m[1]}». Disponibles: ${Object.keys(FUNCIONES).join(', ')}.`;
      i += m[0].length;
      f.push({ t: 'fn', v: nombre }, { t: '(' });
      if (nombre === 'tabla') {                  // tabla(Nombre de la tabla; …): el nombre va tal cual hasta el «;»
        const fin = t.indexOf(';', i);
        const nt = fin > i ? t.slice(i, fin).trim() : '';
        if (!nt) return 'Escribe tabla(Nombre de la tabla; valor).';
        if (!nTablas.has(nt.toLowerCase())) return `No hay ninguna tabla llamada «${nt}» (se crean en Reglas del juego → Tablas).`;
        f.push({ t: 'n' }, { t: ';' });
        i = fin + 1;
      }
      continue;
    }
    return `No entiendo «${t.slice(i, i + 8)}». Usa números, dados (2d6), + - * /, [Estadística] y funciones como max(…; …).`;
  }
  // Analizador: comparación := suma (cmp suma)? ; suma := termino (± termino)* ; termino := unario (*/% unario)* ; unario := ±* primario
  let p = 0;
  let error = '';
  const comparacion = () => { if (!suma()) return false; if (f[p]?.t === 'cmp') { p++; if (!suma()) return false; if (f[p]?.t === 'cmp') { error = 'Compara solo dos cosas a la vez (usa si(…) para más).'; return false; } } return true; };
  const suma = () => { if (!termino()) return false; while (f[p]?.t === 'op' && '+-'.includes(f[p].v)) { p++; if (!termino()) return false; } return true; };
  const termino = () => { if (!unario()) return false; while (f[p]?.t === 'op' && '*/%'.includes(f[p].v)) { p++; if (!unario()) return false; } return true; };
  const unario = () => { while (f[p]?.t === 'op' && '+-'.includes(f[p].v)) p++; return primario(); };
  const primario = () => {
    const x = f[p];
    if (!x) return false;
    if (x.t === 'n') { p++; return true; }
    if (x.t === '(') { p++; if (!comparacion()) return false; if (f[p]?.t !== ')') return false; p++; return true; }
    if (x.t === 'fn') {
      p += 2;
      let n = 0;
      if (f[p]?.t === ')') { p++; if (FUNCIONES[x.v][0] > 0) { error = `«${x.v}» necesita valores entre los paréntesis.`; return false; } return true; }
      for (;;) {
        if (!comparacion()) return false;
        n++;
        if (f[p]?.t === ';') { p++; continue; }
        if (f[p]?.t === ')') { p++; break; }
        return false;
      }
      const [mn, mx] = FUNCIONES[x.v];
      if (n < mn || n > mx) { error = `«${x.v}» necesita ${mn === mx ? mn : `entre ${mn} y ${mx}`} valor(es) separados por «;».`; return false; }
      return true;
    }
    return false;
  };
  if (!comparacion() || p !== f.length) return error || 'La fórmula está incompleta o mal escrita (revisa los paréntesis, los signos y los «;»).';
  return '';
}
