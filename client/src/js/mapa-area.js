// mapa-area.js — Las casillas que alcanza una habilidad con área (lo usan el mapa y la ficha de la habilidad).

const redondear = (v) => Math.floor(Math.abs(v) + 0.5) * (v >= 0 ? 1 : -1);
/** Casillas de un área (copia de EstadoPartida.celdas_area en el servidor). */
export function celdasArea(origen, px, py, area, alcance, sinLimite, ancho, alto) {
  const dentro = (x, y) => x >= 0 && y >= 0 && x < ancho && y < alto;
  const tam = area.tamano || 1, res = [];
  if (area.forma === 'explosion') {
    for (let y = py - tam; y <= py + tam; y++) for (let x = px - tam; x <= px + tam; x++) if (dentro(x, y)) res.push([x, y]);
    return res;
  }
  const dx = px - origen.x, dy = py - origen.y, n = Math.max(Math.abs(dx), Math.abs(dy));
  if (!n) return [];
  if (area.forma === 'linea') {
    const largo = sinLimite ? ancho + alto : alcance;
    for (let k = 1; k <= largo; k++) {
      const x = origen.x + redondear((k * dx) / n), y = origen.y + redondear((k * dy) / n);
      if (!dentro(x, y)) break;
      res.push([x, y]);
    }
    return res;
  }
  if (area.forma === 'cono' || area.forma === 'casillas') {
    const [fx, fy] = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
    const rx = -fy, ry = fx, vistas = new Set();
    const rel = [];
    if (area.forma === 'cono') { for (let k = 1; k <= tam; k++) for (let l = -(k - 1); l < k; l++) rel.push([k, l]); } else rel.push(...(area.casillas || []));
    for (const [f, l] of rel) {
      const x = origen.x + f * fx + l * rx, y = origen.y + f * fy + l * ry;
      if (dentro(x, y) && !vistas.has(`${x},${y}`)) { vistas.add(`${x},${y}`); res.push([x, y]); }
    }
    return res;
  }
  if (area.forma === 'frente') {
    const sx = Math.sign(dx), sy = Math.sign(dy), qx = -sy, qy = sx, mitad = Math.floor(tam / 2);
    for (let k = -mitad; k < tam - mitad; k++) if (dentro(px + k * qx, py + k * qy)) res.push([px + k * qx, py + k * qy]);
    return res;
  }
  return [[px, py]];
}
