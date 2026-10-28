// pantallas/conexion.js — Primera ventana: servidores guardados y conexión.
// Se guardan nombre, dirección y usuario de cada servidor. Las contraseñas solo si se marca «Recuérdame» (cifradas por el sistema;
// la del usuario y la del servidor, nunca la de GM): la próxima vez aparecen ya escritas.
import { h } from '../util.js';
import { ajustes, guardar, credencialesDisponibles, hayContrasenas, leerContrasenas, guardarContrasenas, olvidarContrasenas } from '../ajustes.js';
import { importarZip } from '../archivos.js';

const OLVIDO = 'Si olvidaste tu contraseña, contacta al Game Master.';

export function crearConexion({ alConectar, aviso }) {
  const cuerpo = h('div', { class: 'conexion-cuerpo' });
  const avisoZip = h('p', { class: 'tenue pequeno', 'aria-live': 'polite', 'data-resultado': 'zip' });
  const tarjeta = h('div', { class: 'tarjeta-conexion' },
    h('h1', { class: 'titulo-app' }, h('img', { class: 'logo-app', src: 'img/app.png', alt: '', width: 64, height: 64 }), 'Campaigns and Dragons Online'),
    cuerpo,
    h('div', { class: 'conexion-archivos' },
      h('button', { type: 'button', class: 'btn btn-suave btn-mini', 'data-accion': 'importar-zip', title: 'El .zip con las imágenes y sonidos que te pasó el GM', onclick: async () => {
        try {
          const r = await importarZip('');
          if (r) avisoZip.textContent = `✅ ${r.copiados} archivos de «${r.nombre}» instalados.`;
        } catch (e) { avisoZip.textContent = `⚠️ ${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`; }
      } }, '📦 Importar archivos de campaña (.zip)…'),
      avisoZip),
    h('p', { class: 'tenue pequeno creditos', 'data-seccion': 'acerca-de' }, 'Creado por BluriSkayo · Íconos de habilidades: jfranci_px'));

  let mostrarError = () => {};
  const guardarLista = (lista) => guardar({ servidores: lista });
  const idNuevo = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // ── Lista de servidores guardados ──
  function verLista(textoAviso = '') {
    const lista = ajustes.servidores || [];
    const err = h('p', { class: 'error', role: 'alert', hidden: !textoAviso }, textoAviso);
    mostrarError = (t) => { err.textContent = t; err.hidden = !t; };
    cuerpo.replaceChildren(
      h('p', { class: 'tenue subtitulo' }, lista.length ? 'Elige un servidor para conectarte.' : 'Todavía no tienes servidores guardados.'),
      err,
      lista.length ? h('ul', { class: 'lista-servidores' }, lista.map((sv) => h('li', { class: 'servidor-guardado', 'data-servidor': sv.id },
        h('div', { class: 'servidor-texto' }, h('strong', null, sv.nombre || sv.direccion), h('span', { class: 'tenue pequeno' }, `${sv.direccion} · ${sv.usuario}`),
          hayContrasenas(sv.id, sv.usuario) ? h('span', { class: 'chip-recordado', 'data-recordado': 'si', title: 'Al pulsar «Conectar» tus contraseñas ya aparecen escritas. Para quitarlas: ✏️ → «Olvidar contraseñas».' }, '🔑 Contraseña recordada') : null),
        h('div', { class: 'servidor-botones' },
          h('button', { type: 'button', class: 'btn btn-acento', 'data-accion': 'elegir-servidor', onclick: () => verConectar(sv) }, 'Conectar'),
          h('button', { type: 'button', class: 'btn btn-mini', title: 'Editar', 'aria-label': `Editar ${sv.nombre}`, 'data-accion': 'editar-servidor', onclick: () => verConectar(sv, true) }, '✏️'),
          h('button', { type: 'button', class: 'btn btn-mini btn-peligro', title: 'Borrar de la lista', 'aria-label': `Borrar ${sv.nombre}`, 'data-accion': 'borrar-servidor', onclick: () => {
            if (window.confirm(`¿Quitar «${sv.nombre || sv.direccion}» de tu lista? (No borra nada del servidor.)`)) { olvidarContrasenas(sv.id); guardarLista(lista.filter((x) => x.id !== sv.id)); verLista(); }
          } }, '✕'))))) : null,
      h('button', { type: 'button', class: 'btn btn-grande', 'data-accion': 'anadir-servidor', onclick: () => verConectar(null, true) }, '➕ Añadir servidor'));
  }

  // ── Conectar a uno (o añadirlo / editarlo) ──
  function verConectar(sv, editar = false) {
    const nuevo = !sv;
    const nombre = h('input', { type: 'text', value: sv?.nombre || '', maxlength: '40', placeholder: 'Por ejemplo: Campaña de los jueves', autocomplete: 'off', id: 'f-nombre' });
    const direccion = h('input', { type: 'text', value: sv?.direccion || '', placeholder: 'Por ejemplo 192.168.1.20:8765', autocomplete: 'off', spellcheck: 'false', id: 'f-servidor' });
    const usuario = h('input', { type: 'text', value: sv?.usuario || '', maxlength: '20', placeholder: 'Tu nombre en la mesa', autocomplete: 'off', id: 'f-usuario' });
    const passServidor = h('input', { type: 'password', placeholder: 'Déjala vacía si no tiene', autocomplete: 'off', id: 'f-pass' });
    const passUsuario = h('input', { type: 'password', placeholder: 'Opcional: protege tu usuario', autocomplete: 'off', id: 'f-clave' });
    const passGM = h('input', { type: 'password', placeholder: 'Vacía si el servidor no tiene', autocomplete: 'off', id: 'f-gm' });
    const casillaGM = h('input', { type: 'checkbox', id: 'f-es-gm' });
    const bloqueGM = h('div', { class: 'campo', hidden: true }, h('label', { for: 'f-gm' }, 'Contraseña de GM'), passGM);
    // «Recuérdame»: guarda (cifradas) tu contraseña y la del servidor para que la próxima vez aparezcan escritas. Nunca la de GM:
    // al marcar «Entrar como Game Master» la casilla se oculta y no se guarda nada.
    const casillaRecordar = h('input', { type: 'checkbox', id: 'f-recordar' });
    const notaRecordar = h('p', { class: 'tenue pequeno', hidden: true });           // solo se usa si este equipo no puede guardar contraseñas
    const filaRecordar = h('div', { class: 'campo-recordar' }, h('label', { class: 'interruptor' }, casillaRecordar, h('span', null, 'Recuérdame')), notaRecordar);
    credencialesDisponibles().then((si) => {
      if (si) return;
      casillaRecordar.disabled = true; casillaRecordar.checked = false;
      notaRecordar.textContent = 'Este equipo no tiene dónde guardar contraseñas de forma segura, así que no se pueden recordar.';
      notaRecordar.hidden = false;
    });
    casillaGM.addEventListener('change', () => {
      bloqueGM.hidden = !casillaGM.checked; filaRecordar.hidden = casillaGM.checked;
      if (casillaGM.checked) passGM.focus();
    });
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    mostrarError = (t) => { err.textContent = t; err.hidden = !t; };
    const boton = h('button', { class: 'btn btn-acento btn-grande', type: 'submit' }, 'Conectar');
    const datos = () => ({ id: sv?.id || idNuevo(), nombre: nombre.value.trim() || direccion.value.trim(), direccion: direccion.value.trim(), usuario: usuario.value.trim() });
    const recordar = () => {           // añade o actualiza este servidor en la lista (sin contraseñas)
      const d = datos(), lista = [...(ajustes.servidores || [])];
      const i = lista.findIndex((x) => x.id === d.id);
      if (i >= 0) lista[i] = d; else lista.push(d);
      guardarLista(lista);
      sv = d;
    };
    const valido = () => {
      if (!direccion.value.trim()) { mostrarError('Escribe la dirección del servidor.'); direccion.focus(); return false; }
      if (!usuario.value.trim()) { mostrarError('Escribe tu nombre de usuario.'); usuario.focus(); return false; }
      return true;
    };
    const datosServidor = editar || nuevo
      ? [h('div', { class: 'campo' }, h('label', { for: 'f-nombre' }, 'Nombre (para reconocerlo)'), nombre),
        h('div', { class: 'campo' }, h('label', { for: 'f-servidor' }, 'Dirección del servidor'), direccion),
        h('div', { class: 'campo' }, h('label', { for: 'f-usuario' }, 'Usuario'), usuario)]
      : [h('div', { class: 'servidor-elegido' }, h('strong', null, sv.nombre || sv.direccion), h('span', { class: 'tenue pequeno' }, sv.direccion)),
        h('div', { class: 'campo' }, h('label', { for: 'f-usuario' }, 'Usuario'), usuario)];
    const formulario = h('form', { class: 'form-conexion', novalidate: true },
      ...datosServidor,
      h('div', { class: 'campo' }, h('label', { for: 'f-clave' }, 'Tu contraseña'), passUsuario),
      h('div', { class: 'campo' }, h('label', { for: 'f-pass' }, 'Contraseña del servidor'), passServidor),
      filaRecordar,
      h('label', { class: 'interruptor' }, casillaGM, h('span', null, 'Entrar como Game Master')),
      bloqueGM, err, boton,
      h('div', { class: 'fila-botones' },
        (ajustes.servidores || []).length || !nuevo ? h('button', { type: 'button', class: 'btn btn-suave', 'data-accion': 'volver-servidores', onclick: () => verLista() }, '← Mis servidores') : null,
        editar || nuevo ? h('button', { type: 'button', class: 'btn', 'data-accion': 'guardar-servidor', onclick: () => { if (valido()) { recordar(); verLista(); } } }, nuevo ? 'Guardar sin conectar' : 'Guardar cambios') : null,
        sv && hayContrasenas(sv.id, sv.usuario) ? h('button', { type: 'button', class: 'btn btn-suave', 'data-accion': 'olvidar-contrasenas', title: 'Borra de este equipo las contraseñas guardadas de este servidor',
          onclick: (e) => { olvidarContrasenas(sv.id); passUsuario.value = ''; passServidor.value = ''; casillaRecordar.checked = false; e.currentTarget.remove(); } }, '🔑 Olvidar contraseñas') : null));
    formulario.addEventListener('submit', async (e) => {
      e.preventDefault();
      mostrarError('');
      if (!valido()) return;
      boton.disabled = true;
      boton.textContent = 'Conectando…';
      try {
        await alConectar({
          direccion: direccion.value, usuario: usuario.value.trim(),
          password: passUsuario.value, passServidor: passServidor.value, passGM: casillaGM.checked ? passGM.value : '', gm: casillaGM.checked,
        });
        recordar();
        guardar({ servidor: direccion.value.trim(), usuario: usuario.value.trim() });
        if (!casillaGM.checked) {           // como GM no se toca nada (ni se guarda ni se borra)
          if (casillaRecordar.checked) await guardarContrasenas(sv.id, sv.usuario, { usuario: passUsuario.value, servidor: passServidor.value });
          else olvidarContrasenas(sv.id, sv.usuario);
        }
      } catch (err2) {
        const olvido = ['password_incorrecta', 'password_servidor_incorrecta', 'password_gm_incorrecta'].includes(err2.codigo);
        mostrarError(`${err2.message || 'No se pudo conectar.'}${olvido ? ` ${OLVIDO}` : ''}`);
        if (['password_requerida', 'password_incorrecta', 'password_nueva_requerida'].includes(err2.codigo)) passUsuario.focus();
        else if (err2.codigo === 'password_servidor_incorrecta') passServidor.focus();
        else if (err2.codigo === 'password_gm_incorrecta') passGM.focus();
        boton.disabled = false;
        boton.textContent = 'Conectar';
      }
    });
    cuerpo.replaceChildren(h('p', { class: 'tenue subtitulo' }, nuevo ? 'Añade un servidor: se guarda en tu lista (sin contraseñas).' : editar ? 'Edita los datos de este servidor.' : 'Escribe las contraseñas que hagan falta y conéctate.'), formulario);
    setTimeout(() => (nuevo ? direccion : usuario.value ? passUsuario : usuario).focus(), 0);
    // Contraseñas recordadas de este servidor y usuario: se escriben solas y el foco va a «Conectar» (basta con Intro).
    if (sv && hayContrasenas(sv.id, sv.usuario)) {
      leerContrasenas(sv.id, sv.usuario).then((g) => {
        if (!g) { olvidarContrasenas(sv.id, sv.usuario); return; }            // de otro equipo o usuario del sistema: no se pueden leer
        if (!passUsuario.value) passUsuario.value = g.usuario;
        if (!passServidor.value) passServidor.value = g.servidor;
        casillaRecordar.checked = true;
        if (!editar) boton.focus();
      });
    }
  }

  verLista(aviso || '');
  const el = h('div', { class: 'pantalla-centrada' }, tarjeta);
  return { el, mostrarError: (t) => mostrarError(t), destruir() {} };
}
