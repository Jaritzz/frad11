// Panel de administrador. Toda la seguridad la hace la base (RLS): esta página
// solo muestra los formularios; si el usuario no es administrador, la base rechaza los cambios.

const $ = (id) => document.getElementById(id);
const estado = { eventos: [], evento: null, etapas: [], inscriptos: [], seccion: "evento", prueba: null, preview: null };

// ---------- utilidades ----------------------------------------------------------
function avisar(msg, tipo = "ok") {
  $("aviso").innerHTML = msg ? `<div class="aviso ${tipo}">${esc(msg)}</div>` : "";
  if (msg && tipo === "ok") setTimeout(() => { if ($("aviso").textContent === msg) avisar(""); }, 5000);
}
function chequear(res) {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
async function intentar(fn) {
  try { await fn(); } catch (e) { avisar("Error: " + e.message, "error"); console.error(e); }
}
// "4:32.4", "1:04:32.4", "272.4" o "272,4" -> segundos
function leerTiempo(txt) {
  const t = String(txt || "").trim().replace(",", ".");
  if (!t) return null;
  const partes = t.split(":").map(Number);
  if (partes.some(isNaN)) return null;
  return partes.reduce((acc, p) => acc * 60 + p, 0);
}
const hora = (ts, ms = false) => (ts ? String(ts).replace(" ", "T").slice(11, ms ? 23 : 19) : "");

// Diálogo genérico: campos = [{id, label, tipo, valor, opciones}] -> objeto o null si cancela
function pedir(titulo, campos, textoOk = "Guardar") {
  return new Promise((resolver) => {
    const f = $("form-dialogo");
    f.innerHTML = `<h2 style="margin-top:0">${esc(titulo)}</h2>` +
      campos.map((c) => `<div class="fila"><label class="campo" style="flex:1">${esc(c.label)}${
        c.opciones
          ? `<select name="${c.id}">${c.opciones.map((o) => `<option value="${esc(o[0])}" ${o[0] === c.valor ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select>`
          : `<input name="${c.id}" type="${c.tipo || "text"}" value="${esc(c.valor ?? "")}" ${c.placeholder ? `placeholder="${esc(c.placeholder)}"` : ""}>`
      }</label></div>`).join("") +
      `<div class="fila" style="justify-content:flex-end;margin-top:12px">
         <button class="btn" value="cancelar">Cancelar</button>
         <button class="btn primario" value="ok">${esc(textoOk)}</button></div>`;
    const d = $("dialogo");
    d.onclose = () => {
      if (d.returnValue !== "ok") return resolver(null);
      const datos = {};
      for (const c of campos) datos[c.id] = f.elements[c.id].value.trim();
      resolver(datos);
    };
    d.showModal();
  });
}

// ---------- login ----------------------------------------------------------------
async function iniciar() {
  const { data } = await db.auth.getSession();
  if (!data.session) return mostrarLogin();
  const esAdmin = chequear(await db.rpc("es_admin"));
  if (!esAdmin) {
    mostrarLogin();
    $("aviso-login").innerHTML = `<div class="aviso error">Esta cuenta no es de administrador.</div>`;
    return;
  }
  $("login").hidden = true;
  $("panel").hidden = false;
  $("salir").hidden = false;
  $("usuario").textContent = data.session.user.email;
  await cargarEventos();
}
function mostrarLogin() {
  $("login").hidden = false;
  $("panel").hidden = true;
  $("salir").hidden = true;
  $("usuario").textContent = "";
}
$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("aviso-login").innerHTML = "";
  const { error } = await db.auth.signInWithPassword({ email: $("email").value, password: $("clave").value });
  if (error) $("aviso-login").innerHTML = `<div class="aviso error">Email o contraseña incorrectos.</div>`;
  else intentar(iniciar);
});
$("salir").addEventListener("click", async () => { await db.auth.signOut(); mostrarLogin(); });

// ---------- eventos -----------------------------------------------------------------
async function cargarEventos(elegir) {
  estado.eventos = chequear(await db.from("eventos").select("*").order("fecha_desde", { ascending: false, nullsFirst: false }));
  const id = elegir || estado.evento?.id || estado.eventos[0]?.id;
  $("sel-evento").innerHTML = estado.eventos.length
    ? estado.eventos.map((e) => `<option value="${e.id}" ${e.id === id ? "selected" : ""}>${esc(e.nombre)}${e.abierta === false ? " (cerrada)" : ""}</option>`).join("")
    : `<option value="">(sin eventos)</option>`;
  await elegirEvento(id);
}
async function elegirEvento(id) {
  estado.evento = estado.eventos.find((e) => e.id === id) || null;
  $("titulo-evento").textContent = estado.evento ? estado.evento.nombre : "Panel";
  estado.prueba = null;
  estado.preview = null;
  await cargarDetalle();
  dibujar();
}
async function cargarDetalle() {
  if (!estado.evento) { estado.etapas = []; estado.inscriptos = []; return; }
  const id = estado.evento.id;
  const etapas = chequear(await db.from("etapas").select("id,nombre,orden,pruebas(id,nombre,orden)").eq("evento_id", id));
  const porOrden = (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es", { numeric: true });
  estado.etapas = etapas.sort(porOrden).map((e) => ({ ...e, pruebas: e.pruebas.sort(porOrden) }));
  estado.inscriptos = chequear(await db.from("inscriptos").select("*").eq("evento_id", id))
    .sort((a, b) => (a.orden ?? 1e9) - (b.orden ?? 1e9) || compararNumero(a.numero, b.numero));
}
$("sel-evento").addEventListener("change", (e) => intentar(() => elegirEvento(e.target.value)));
$("btn-nuevo-evento").addEventListener("click", () => intentar(async () => {
  const d = await pedir("Nueva fecha del campeonato", [
    { id: "nombre", label: "Nombre del rally" },
    { id: "desde", label: "Desde", tipo: "date" },
    { id: "hasta", label: "Hasta", tipo: "date" },
  ], "Crear");
  if (!d || !d.nombre) return;
  const abiertas = estado.eventos.filter((e) => e.abierta !== false);
  if (abiertas.length && confirm(`¿Cerrar las fechas abiertas (${abiertas.map((e) => e.nombre).join(", ")}) para que la nueva quede como la fecha en curso?`))
    chequear(await db.from("eventos").update({ abierta: false }).in("id", abiertas.map((e) => e.id)));
  const ev = chequear(await db.from("eventos").insert({
    nombre: d.nombre, fecha_desde: d.desde || null, fecha_hasta: d.hasta || d.desde || null,
  }).select().single());
  avisar("Fecha creada.");
  await cargarEventos(ev.id);
}));

for (const b of document.querySelectorAll(".pestana[data-sec]")) {
  b.addEventListener("click", () => {
    estado.seccion = b.dataset.sec;
    document.querySelectorAll(".pestana[data-sec]").forEach((x) => x.setAttribute("aria-selected", x === b));
    avisar("");
    dibujar();
  });
}

function dibujar() {
  if (!estado.evento) {
    $("seccion").innerHTML = `<div class="tarjeta vacio">Creá la primera fecha con "+ Nueva fecha".</div>`;
    return;
  }
  const fn = ({ evento: dibujarEvento, inscriptos: dibujarInscriptos, tiempos: dibujarTiempos,
                anticipadas: dibujarAnticipadas, auditoria: dibujarAuditoria })[estado.seccion];
  intentar(async () => { await fn(); });
}

// ---------- sección: evento, etapas, pruebas, logo -----------------------------------------
function dibujarEvento() {
  const ev = estado.evento;
  const abierta = ev.abierta !== false;
  $("seccion").innerHTML = `
    <div class="tarjeta">
      <h2>Estado de la fecha</h2>
      <div class="fila" style="align-items:center">
        <span class="estado-fecha ${abierta ? "abierta" : "cerrada"}">${abierta ? "Abierta · en curso" : "Cerrada · finalizada"}</span>
        <button class="btn ${abierta ? "" : "primario"}" onclick="intentar(()=>cambiarApertura(${!abierta}))">
          ${abierta ? "Cerrar fecha" : "Reabrir fecha"}</button>
      </div>
      <p class="marca-suave">${abierta
        ? "Abierta: aparece arriba en la web como fecha en curso y sus pruebas se pueden elegir en las apps de largada y llegada."
        : "Cerrada: pasa a \"Fechas anteriores\" en la web (los resultados se siguen viendo) y deja de aparecer en las apps."}</p>
    </div>
    <div class="tarjeta">
      <h2>Datos de la fecha</h2>
      <div class="fila">
        <label class="campo" style="flex:1;min-width:220px">Nombre<input id="ev-nombre" type="text" value="${esc(ev.nombre)}"></label>
        <label class="campo">Desde<input id="ev-desde" type="date" value="${esc(ev.fecha_desde || "")}"></label>
        <label class="campo">Hasta<input id="ev-hasta" type="date" value="${esc(ev.fecha_hasta || "")}"></label>
        <button class="btn primario" onclick="intentar(guardarEvento)">Guardar</button>
      </div>
      <h3>Logo</h3>
      <div class="fila">
        ${ev.logo_url ? `<img class="logo-mini" src="${esc(ev.logo_url)}" alt="">` : `<span class="marca-suave">Sin logo</span>`}
        <input id="ev-logo" type="file" accept="image/*">
        <button class="btn" onclick="intentar(subirLogo)">Subir logo</button>
      </div>
    </div>
    <div class="tarjeta">
      <h2>Etapas y pruebas</h2>
      ${estado.etapas.length ? "" : `<p class="marca-suave">Todavía no hay etapas.</p>`}
      ${estado.etapas.map((e) => `
        <div class="etapa-bloque">
          <div class="fila">
            <span class="titulo-etapa">${esc(e.nombre)}</span>
            <button class="btn mini" onclick="intentar(()=>renombrarEtapa('${e.id}'))">Renombrar</button>
            <button class="btn mini peligro" onclick="intentar(()=>borrarEtapa('${e.id}'))">Borrar</button>
          </div>
          <ul class="lista-pruebas">
            ${e.pruebas.map((p) => `<li><span class="nombre-prueba">${esc(p.nombre)}</span>
              <button class="btn mini" onclick="intentar(()=>renombrarPrueba('${e.id}','${p.id}'))">Renombrar</button>
              <button class="btn mini peligro" onclick="intentar(()=>borrarPrueba('${p.id}'))">Borrar</button></li>`).join("")}
            <li><input type="text" id="nueva-prueba-${e.id}" placeholder="Nueva prueba (ej. PE1 Los Cerros)">
              <button class="btn mini" onclick="intentar(()=>agregarPrueba('${e.id}'))">+ Agregar prueba</button></li>
          </ul>
        </div>`).join("")}
      <div class="fila"><input type="text" id="nueva-etapa" placeholder="Nueva etapa (ej. Etapa 1)">
        <button class="btn" onclick="intentar(agregarEtapa)">+ Agregar etapa</button></div>
      <p class="marca-suave">Los nombres tienen que coincidir con los que se eligen en las apps de largada y llegada
        (las apps los bajan de acá con "Bajar pruebas de la web"). Si renombrás algo, los tiempos ya subidos se actualizan solos.</p>
    </div>
    <div class="tarjeta">
      <h2>Borrar fecha</h2>
      <p class="marca-suave">Borra la fecha con sus etapas, pruebas, inscriptos, penalizaciones y tiempos. No se puede deshacer.</p>
      <button class="btn peligro" onclick="intentar(borrarEvento)">Borrar esta fecha</button>
    </div>`;
}

async function guardarEvento() {
  const ev = estado.evento;
  const nombre = $("ev-nombre").value.trim();
  if (!nombre) return avisar("El nombre no puede quedar vacío.", "error");
  chequear(await db.from("eventos").update({
    nombre, fecha_desde: $("ev-desde").value || null, fecha_hasta: $("ev-hasta").value || null,
  }).eq("id", ev.id));
  if (nombre !== ev.nombre) {   // mantener enlazados los tiempos ya subidos
    chequear(await db.from("largadas").update({ evento: nombre }).eq("evento", ev.nombre));
    chequear(await db.from("llegadas").update({ evento: nombre }).eq("evento", ev.nombre));
  }
  avisar("Fecha guardada.");
  await cargarEventos(ev.id);
}

async function cambiarApertura(abrir) {
  const ev = estado.evento;
  if (!abrir) {
    if (!confirm(`¿Cerrar "${ev.nombre}"?\n\nPasa a "Fechas anteriores" en la web y deja de aparecer en las apps de largada y llegada. Se puede reabrir cuando quieras.`)) return;
  } else {
    const otras = estado.eventos.filter((e) => e.id !== ev.id && e.abierta !== false);
    if (otras.length && confirm(`Hay otras fechas abiertas: ${otras.map((e) => e.nombre).join(", ")}.\n\n¿Cerrarlas para que quede solo "${ev.nombre}" en curso?`)) {
      chequear(await db.from("eventos").update({ abierta: false }).in("id", otras.map((e) => e.id)));
    }
  }
  chequear(await db.from("eventos").update({ abierta: abrir }).eq("id", ev.id));
  avisar(abrir ? "Fecha abierta." : "Fecha cerrada.");
  await cargarEventos(ev.id);
}

async function subirLogo() {
  const archivo = $("ev-logo").files[0];
  if (!archivo) return avisar("Elegí una imagen primero.", "error");
  const ext = (archivo.name.split(".").pop() || "png").toLowerCase();
  const ruta = `${estado.evento.id}/${Date.now()}.${ext}`;
  chequear(await db.storage.from("logos").upload(ruta, archivo, { contentType: archivo.type }));
  const url = db.storage.from("logos").getPublicUrl(ruta).data.publicUrl;
  chequear(await db.from("eventos").update({ logo_url: url }).eq("id", estado.evento.id));
  avisar("Logo actualizado.");
  await cargarEventos(estado.evento.id);
}

async function borrarEvento() {
  const ev = estado.evento;
  const d = await pedir(`Borrar "${ev.nombre}"`, [{ id: "conf", label: `Para confirmar, escribí BORRAR` }], "Borrar");
  if (!d || d.conf.toUpperCase() !== "BORRAR") return;
  chequear(await db.from("largadas").delete().eq("evento", ev.nombre));
  chequear(await db.from("llegadas").delete().eq("evento", ev.nombre));
  chequear(await db.from("eventos").delete().eq("id", ev.id));
  avisar("Fecha borrada.");
  estado.evento = null;
  await cargarEventos();
}

async function agregarEtapa() {
  const nombre = $("nueva-etapa").value.trim();
  if (!nombre) return;
  const orden = Math.max(0, ...estado.etapas.map((e) => e.orden)) + 1;
  chequear(await db.from("etapas").insert({ evento_id: estado.evento.id, nombre, orden }));
  await cargarDetalle(); dibujar();
}
async function agregarPrueba(etapaId) {
  const nombre = $("nueva-prueba-" + etapaId).value.trim();
  if (!nombre) return;
  const etapa = estado.etapas.find((e) => e.id === etapaId);
  const orden = Math.max(0, ...etapa.pruebas.map((p) => p.orden)) + 1;
  chequear(await db.from("pruebas").insert({ etapa_id: etapaId, nombre, orden }));
  await cargarDetalle(); dibujar();
}
async function renombrarEtapa(id) {
  const e = estado.etapas.find((x) => x.id === id);
  const d = await pedir("Renombrar etapa", [{ id: "nombre", label: "Nombre", valor: e.nombre }]);
  if (!d || !d.nombre || d.nombre === e.nombre) return;
  chequear(await db.from("etapas").update({ nombre: d.nombre }).eq("id", id));
  for (const t of ["largadas", "llegadas"])
    chequear(await db.from(t).update({ etapa: d.nombre }).eq("evento", estado.evento.nombre).eq("etapa", e.nombre));
  await cargarDetalle(); dibujar(); avisar("Etapa renombrada.");
}
async function renombrarPrueba(etapaId, id) {
  const e = estado.etapas.find((x) => x.id === etapaId);
  const p = e.pruebas.find((x) => x.id === id);
  const d = await pedir("Renombrar prueba", [{ id: "nombre", label: "Nombre", valor: p.nombre }]);
  if (!d || !d.nombre || d.nombre === p.nombre) return;
  chequear(await db.from("pruebas").update({ nombre: d.nombre }).eq("id", id));
  for (const t of ["largadas", "llegadas"])
    chequear(await db.from(t).update({ prueba: d.nombre })
      .eq("evento", estado.evento.nombre).eq("etapa", e.nombre).eq("prueba", p.nombre));
  await cargarDetalle(); dibujar(); avisar("Prueba renombrada.");
}
async function borrarEtapa(id) {
  if (!confirm("¿Borrar la etapa con todas sus pruebas, penalizaciones y tiempos manuales?")) return;
  chequear(await db.from("etapas").delete().eq("id", id));
  await cargarDetalle(); dibujar();
}
async function borrarPrueba(id) {
  if (!confirm("¿Borrar la prueba con sus penalizaciones y tiempos manuales?")) return;
  chequear(await db.from("pruebas").delete().eq("id", id));
  await cargarDetalle(); dibujar();
}

// ---------- sección: inscriptos ------------------------------------------------------------
function dibujarInscriptos() {
  const p = estado.preview;
  $("seccion").innerHTML = `
    <div class="tarjeta">
      <h2>Importar inscriptos</h2>
      <div class="fila">
        <input id="archivo-ins" type="file" accept=".xlsx,.xls,.csv,.pdf">
        <button class="btn" onclick="intentar(leerArchivo)">Leer archivo</button>
      </div>
      <p class="marca-suave">Excel o PDF con columnas Orden, Nº, Piloto - Navegante, Clase y Auto (como la "Asignación de Números").
        Antes de guardar vas a ver todo para revisarlo y corregirlo.</p>
      ${p ? dibujarPreview(p) : ""}
    </div>
    <div class="tarjeta">
      <h2>Inscriptos cargados (${estado.inscriptos.length})</h2>
      <button class="btn" onclick="intentar(()=>editarInscripto(null))">+ Agregar inscripto</button>
      ${estado.inscriptos.length ? `
      <div class="tabla-env" style="margin:12px 0 0">
        <table class="admin"><thead><tr><th>Orden</th><th>N.º</th><th>Piloto</th><th>Navegante</th><th>Clase</th><th>Auto</th><th></th></tr></thead>
        <tbody>${estado.inscriptos.map((i) => `<tr>
          <td>${i.orden ?? ""}</td><td class="auto">${esc(i.numero)}</td><td>${esc(i.piloto)}</td><td>${esc(i.navegante)}</td>
          <td>${chipClase(i.clase)}</td><td class="modelo">${esc(i.auto)}</td>
          <td style="white-space:nowrap"><button class="btn mini" onclick="intentar(()=>editarInscripto('${i.id}'))">Editar</button>
              <button class="btn mini peligro" onclick="intentar(()=>borrarInscripto('${i.id}'))">Borrar</button></td>
        </tr>`).join("")}</tbody></table></div>` : ""}
    </div>`;
}

function dibujarPreview(p) {
  return `
    <h3>Vista previa: ${p.inscriptos.length} inscriptos</h3>
    ${p.avisos.map((a) => `<div class="aviso error">${esc(a)}</div>`).join("")}
    <p class="marca-suave">Podés corregir cualquier celda. Las filas en rojo tienen algo para revisar.</p>
    <div class="tabla-env" style="margin-bottom:10px">
      <table class="admin"><thead><tr><th>Orden</th><th>N.º</th><th>Piloto</th><th>Navegante</th><th>Clase</th><th>Auto</th><th></th></tr></thead>
      <tbody>${p.inscriptos.map((i, k) => `<tr ${i.revisar ? `class="revisar"` : ""}>
        ${["orden", "numero", "piloto", "navegante", "clase", "auto"].map((c) =>
          `<td><input type="text" data-k="${k}" data-c="${c}" value="${esc(i[c] ?? "")}" ${c === "orden" || c === "numero" ? `class="chico"` : ""}
                onchange="estado.preview.inscriptos[${k}]['${c}']=this.value"></td>`).join("")}
        <td><button class="btn mini peligro" onclick="estado.preview.inscriptos.splice(${k},1);dibujar()">Quitar</button></td>
      </tr>`).join("")}</tbody></table></div>
    <div class="fila">
      <label class="campo" style="flex-direction:row;align-items:center;gap:6px">
        <input type="checkbox" id="reemplazar" ${estado.inscriptos.length ? "" : "checked"}>
        Reemplazar todos los inscriptos actuales (si no, se agregan/actualizan por número)</label>
    </div>
    <div class="fila">
      <button class="btn primario" onclick="intentar(guardarPreview)">Guardar inscriptos</button>
      <button class="btn" onclick="estado.preview=null;dibujar()">Cancelar</button>
    </div>`;
}

async function leerArchivo() {
  const archivo = $("archivo-ins").files[0];
  if (!archivo) return avisar("Elegí un archivo primero.", "error");
  avisar("Leyendo archivo…");
  estado.preview = /\.pdf$/i.test(archivo.name) ? await leerPdf(archivo) : await leerExcel(archivo);
  avisar(estado.preview.inscriptos.length ? "" : "No se encontraron inscriptos en el archivo.", "error");
  dibujar();
}

async function guardarPreview() {
  const lista = estado.preview.inscriptos
    .map((i) => ({ evento_id: estado.evento.id, orden: Number(i.orden) || null, numero: String(i.numero).trim(),
                   piloto: String(i.piloto).trim(), navegante: String(i.navegante || "").trim() || null,
                   clase: normalizarClase(i.clase), auto: String(i.auto || "").trim() || null }))
    .filter((i) => i.numero);
  const faltan = lista.filter((i) => !i.piloto || !i.clase);
  if (faltan.length) return avisar(`Faltan piloto o clase en los números: ${faltan.map((i) => i.numero).join(", ")}`, "error");
  const repetidos = lista.map((i) => i.numero).filter((n, k, a) => a.indexOf(n) !== k);
  if (repetidos.length) return avisar(`Números repetidos: ${[...new Set(repetidos)].join(", ")}`, "error");

  if ($("reemplazar").checked) chequear(await db.from("inscriptos").delete().eq("evento_id", estado.evento.id));
  chequear(await db.from("inscriptos").upsert(lista, { onConflict: "evento_id,numero" }));
  await sincronizarClases();
  estado.preview = null;
  await cargarDetalle(); dibujar();
  avisar(`${lista.length} inscriptos guardados.`);
}

async function sincronizarClases() {
  const clases = [...new Set(chequear(await db.from("inscriptos").select("clase").eq("evento_id", estado.evento.id)).map((r) => r.clase))];
  if (clases.length)
    chequear(await db.from("clases").upsert(clases.map((nombre) => ({ evento_id: estado.evento.id, nombre })),
                                          { onConflict: "evento_id,nombre", ignoreDuplicates: true }));
}

async function editarInscripto(id) {
  const i = estado.inscriptos.find((x) => x.id === id) || {};
  const d = await pedir(id ? `Editar auto ${i.numero}` : "Agregar inscripto", [
    { id: "orden", label: "Orden", valor: i.orden ?? "" },
    { id: "numero", label: "Número", valor: i.numero ?? "" },
    { id: "piloto", label: "Piloto", valor: i.piloto ?? "" },
    { id: "navegante", label: "Navegante", valor: i.navegante ?? "" },
    { id: "clase", label: "Clase", valor: i.clase ?? "" },
    { id: "auto", label: "Auto", valor: i.auto ?? "" },
  ]);
  if (!d) return;
  if (!d.numero || !d.piloto || !d.clase) return avisar("Número, piloto y clase son obligatorios.", "error");
  const fila = { evento_id: estado.evento.id, orden: Number(d.orden) || null, numero: d.numero, piloto: d.piloto,
                 navegante: d.navegante || null, clase: normalizarClase(d.clase), auto: d.auto || null };
  if (id) chequear(await db.from("inscriptos").update(fila).eq("id", id));
  else chequear(await db.from("inscriptos").insert(fila));
  await sincronizarClases();
  await cargarDetalle(); dibujar(); avisar("Inscripto guardado.");
}
async function borrarInscripto(id) {
  const i = estado.inscriptos.find((x) => x.id === id);
  if (!confirm(`¿Borrar el auto ${i.numero} (${i.piloto})?`)) return;
  chequear(await db.from("inscriptos").delete().eq("id", id));
  await cargarDetalle(); dibujar();
}

// ---------- sección: tiempos ------------------------------------------------------------------
async function dibujarTiempos() {
  const opciones = estado.etapas.flatMap((e) => e.pruebas.map((p) => [p.id, `${e.nombre} · ${p.nombre}`]));
  if (!opciones.length) {
    $("seccion").innerHTML = `<div class="tarjeta vacio">Primero cargá etapas y pruebas.</div>`;
    return;
  }
  if (!estado.prueba || !opciones.some((o) => o[0] === estado.prueba)) estado.prueba = opciones[0][0];
  $("seccion").innerHTML = `
    <div class="controles">
      <label class="etiqueta">Prueba <select id="sel-prueba">${opciones.map((o) =>
        `<option value="${o[0]}" ${o[0] === estado.prueba ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select></label>
      <button class="btn" onclick="intentar(dibujarTiempos)">Actualizar</button>
    </div>
    <div id="tiempos-cont"><div class="tarjeta vacio">Cargando…</div></div>`;
  $("sel-prueba").addEventListener("change", (e) => { estado.prueba = e.target.value; intentar(dibujarTiempos); });

  const etapa = estado.etapas.find((e) => e.pruebas.some((p) => p.id === estado.prueba));
  const prueba = etapa.pruebas.find((p) => p.id === estado.prueba);
  const ev = estado.evento;
  const [res, lar, lle, pen, man, est] = await Promise.all([
    db.rpc("resultados", { p_evento_id: ev.id }),
    db.from("largadas").select("*").eq("evento", ev.nombre).eq("etapa", etapa.nombre).eq("prueba", prueba.nombre).order("hora_programada"),
    db.from("llegadas").select("*").eq("evento", ev.nombre).eq("etapa", etapa.nombre).eq("prueba", prueba.nombre).order("hora_llegada"),
    db.from("penalizaciones").select("*").eq("prueba_id", prueba.id).order("creado"),
    db.from("tiempos_manuales").select("*").eq("prueba_id", prueba.id),
    db.from("estados_auto").select("*").eq("evento_id", ev.id),
  ]);
  const filas = chequear(res).filter((f) => f.prueba_id === prueba.id);
  const largadas = chequear(lar), llegadas = chequear(lle), penal = chequear(pen);
  const manuales = chequear(man), estados = chequear(est);
  const inscriptos = new Set(estado.inscriptos.map((i) => i.numero));
  const anticipadas = new Set(largadas.filter((l) => l.anticipada).map((l) => l.numero));
  const ESTADO = { ok: "OK", sin_llegada: "Sin llegada", sin_largada: "Sin largada", abandono: "Abandono", excluido: "Excluido" };

  const filasAutos = filas.sort((a, b) => compararNumero(a.numero, b.numero)).map((f) => {
    const ea = estados.find((x) => x.numero === f.numero);
    return `<tr>
      <td class="auto">${esc(f.numero)}</td><td>${esc(f.piloto)}</td><td>${chipClase(f.clase)}</td>
      <td class="num">${hora(f.hora_largada)}</td><td class="num">${hora(f.hora_llegada, true)}</td>
      <td class="num">${fmtTiempo(f.tiempo_seg)}${f.origen !== "cronometro" ? ` <span class="marca-suave">(${f.origen})</span>` : ""}</td>
      <td class="num">${Number(f.penalizacion_seg) ? "+" + fmtTiempo(f.penalizacion_seg) : ""}</td>
      <td class="num tiempo">${fmtTiempo(f.total_seg)}</td>
      <td>${ESTADO[f.estado] || f.estado}${ea ? ` <span class="marca-suave">(${ea.estado})</span>` : ""}</td>
      <td>${anticipadas.has(f.numero) ? `<span class="marca-roja">SÍ</span>` : ""}</td>
      <td style="white-space:nowrap">
        <button class="btn mini" onclick="intentar(()=>penalizar('${f.numero}'))">Penalizar</button>
        <button class="btn mini" onclick="intentar(()=>tiempoManual('${f.numero}'))">Tiempo manual</button>
        <button class="btn mini" onclick="intentar(()=>cambiarEstado('${f.numero}'))">Estado</button>
      </td></tr>`;
  }).join("");

  const repetidos = (n) => llegadas.filter((l) => l.estado === "asignada" && l.numero === n).length > 1;
  const filasLlegadas = llegadas.map((l) => {
    const avisos = [];
    if (l.estado === "pendiente") avisos.push("sin número");
    else if (l.estado === "asignada" && !inscriptos.has(l.numero)) avisos.push("no inscripto");
    if (l.estado === "asignada" && repetidos(l.numero)) avisos.push("repetido");
    return `<tr ${l.estado === "descartada" ? `class="fuera"` : ""}>
      <td>${l.orden ?? ""}</td><td class="num">${hora(l.hora_llegada, true)}</td>
      <td><input type="text" class="chico" id="lle-${l.id}" value="${esc(l.numero ?? "")}"></td>
      <td>${esc(l.estado)}${l.corregido ? ` <span class="marca-suave">(corregido)</span>` : ""}</td>
      <td class="marca-roja">${avisos.join(", ")}</td>
      <td style="white-space:nowrap">
        <button class="btn mini" onclick="intentar(()=>corregirLlegada('${l.id}','asignada'))">Guardar número</button>
        ${l.estado !== "descartada" ? `<button class="btn mini peligro" onclick="intentar(()=>corregirLlegada('${l.id}','descartada'))">Descartar</button>` : ""}
      </td></tr>`;
  }).join("");

  const filasLargadas = largadas.map((l) => `<tr>
      <td class="num">${hora(l.hora_programada)}</td><td class="auto">${esc(l.numero)}</td><td>${esc(l.estado)}</td>
      <td>${l.anticipada ? `<span class="marca-roja">ANTICIPADA</span>` : ""}</td>
      <td class="marca-roja">${inscriptos.has(l.numero) ? "" : "no inscripto"}</td></tr>`).join("");

  $("tiempos-cont").innerHTML = `
    <div class="tarjeta">
      <h2>${esc(etapa.nombre)} · ${esc(prueba.nombre)}</h2>
      <div class="tabla-env" style="margin:0">
        <table class="admin"><thead><tr><th>N.º</th><th>Piloto</th><th>Clase</th><th class="num">Largada</th><th class="num">Llegada</th>
          <th class="num">Tiempo</th><th class="num">Penal.</th><th class="num">Total</th><th>Estado</th><th>Antic.</th><th></th></tr></thead>
        <tbody>${filasAutos || `<tr><td colspan="11" class="vacio">No hay inscriptos.</td></tr>`}</tbody></table></div>
      ${penal.length ? `<h3>Penalizaciones de esta prueba</h3><ul class="lista-pruebas">${penal.map((p) =>
        `<li>Auto ${esc(p.numero)}: +${fmtTiempo(p.segundos)} — ${esc(p.motivo)}
         <button class="btn mini peligro" onclick="intentar(()=>borrarPenalizacion('${p.id}'))">Quitar</button></li>`).join("")}</ul>` : ""}
    </div>
    <div class="tarjeta">
      <h2>Cruces de llegada (${llegadas.length})</h2>
      <p class="marca-suave">Corregí el número de un cruce mal asignado o asigná los que quedaron sin número. Una corrección no la pisa una nueva subida desde la llegada.</p>
      ${llegadas.length ? `<div class="tabla-env" style="margin:0"><table class="admin">
        <thead><tr><th>Orden</th><th class="num">Hora</th><th>N.º</th><th>Estado</th><th>Aviso</th><th></th></tr></thead>
        <tbody>${filasLlegadas}</tbody></table></div>` : `<p class="marca-suave">Todavía no se subieron llegadas.</p>`}
    </div>
    <div class="tarjeta">
      <h2>Largadas registradas (${largadas.length})</h2>
      ${largadas.length ? `<div class="tabla-env" style="margin:0"><table class="admin">
        <thead><tr><th class="num">Hora</th><th>N.º</th><th>Estado</th><th>Anticipada</th><th>Aviso</th></tr></thead>
        <tbody>${filasLargadas}</tbody></table></div>` : `<p class="marca-suave">Todavía no se subieron largadas.</p>`}
    </div>`;
}

async function penalizar(numero) {
  const d = await pedir(`Penalizar auto ${numero}`, [
    { id: "tiempo", label: "Tiempo a sumar (ej. 0:10, 1:00 o 10)", placeholder: "0:10" },
    { id: "motivo", label: "Motivo" },
  ], "Penalizar");
  if (!d) return;
  const seg = leerTiempo(d.tiempo);
  if (!seg || seg <= 0) return avisar("Tiempo inválido.", "error");
  if (!d.motivo) return avisar("Poné un motivo.", "error");
  chequear(await db.from("penalizaciones").insert({ prueba_id: estado.prueba, numero, segundos: seg, motivo: d.motivo }));
  avisar(`Penalización de ${fmtTiempo(seg)} al auto ${numero}.`);
  await dibujarTiempos();
}
async function borrarPenalizacion(id) {
  if (!confirm("¿Quitar esta penalización?")) return;
  chequear(await db.from("penalizaciones").delete().eq("id", id));
  await dibujarTiempos();
}
async function tiempoManual(numero) {
  const actual = chequear(await db.from("tiempos_manuales").select("*").eq("prueba_id", estado.prueba).eq("numero", numero))[0];
  const d = await pedir(`Tiempo manual · auto ${numero}`, [
    { id: "tiempo", label: "Tiempo (m:ss.d) — vacío para quitar el tiempo manual", valor: actual ? fmtTiempo(actual.segundos) : "", placeholder: "4:32.4" },
    { id: "motivo", label: "Tipo", valor: actual?.motivo || "manual", opciones: [["manual", "Carga manual"], ["reenganche", "Reenganche (tiempo asignado)"]] },
    { id: "nota", label: "Nota", valor: actual?.nota || "" },
  ]);
  if (!d) return;
  if (!d.tiempo) {
    if (actual) chequear(await db.from("tiempos_manuales").delete().eq("id", actual.id));
    avisar("Tiempo manual quitado: vuelve a valer el del cronómetro.");
  } else {
    const seg = leerTiempo(d.tiempo);
    if (seg === null || seg <= 0) return avisar("Tiempo inválido.", "error");
    chequear(await db.from("tiempos_manuales").upsert({ prueba_id: estado.prueba, numero, segundos: seg,
      motivo: d.motivo, nota: d.nota || null }, { onConflict: "prueba_id,numero" }));
    avisar(`Tiempo manual ${fmtTiempo(seg)} para el auto ${numero}.`);
  }
  await dibujarTiempos();
}
async function cambiarEstado(numero) {
  const actual = chequear(await db.from("estados_auto").select("*").eq("evento_id", estado.evento.id).eq("numero", numero))[0];
  const d = await pedir(`Estado del auto ${numero} en el evento`, [
    { id: "estado", label: "Estado", valor: actual?.estado || "", opciones: [["", "Normal"], ["abandono", "Abandono"], ["excluido", "Excluido"]] },
    { id: "motivo", label: "Motivo", valor: actual?.motivo || "" },
  ]);
  if (!d) return;
  if (!d.estado) {
    if (actual) chequear(await db.from("estados_auto").delete().eq("id", actual.id));
  } else {
    chequear(await db.from("estados_auto").upsert({ evento_id: estado.evento.id, numero, estado: d.estado,
      desde_prueba_id: estado.prueba, motivo: d.motivo || null }, { onConflict: "evento_id,numero" }));
  }
  avisar("Estado actualizado.");
  await dibujarTiempos();
}
async function corregirLlegada(id, nuevoEstado) {
  const numero = $("lle-" + id).value.trim();
  if (nuevoEstado === "asignada" && !numero) return avisar("Escribí el número.", "error");
  if (nuevoEstado === "descartada" && !confirm("¿Descartar este cruce?")) return;
  chequear(await db.from("llegadas").update({
    numero: numero || null, estado: nuevoEstado, corregido: true,
  }).eq("id", id));
  avisar("Cruce corregido.");
  await dibujarTiempos();
}

// ---------- sección: anticipadas ---------------------------------------------------------------
async function dibujarAnticipadas() {
  $("seccion").innerHTML = `<div class="tarjeta vacio">Cargando…</div>`;
  const filas = chequear(await db.from("largadas").select("*").eq("evento", estado.evento.nombre)
    .eq("anticipada", true).order("hora_programada"));
  const nombre = (n) => estado.inscriptos.find((i) => i.numero === n)?.piloto || "";
  $("seccion").innerHTML = `
    <div class="tarjeta">
      <h2>Largadas anticipadas (${filas.length})</h2>
      <p class="marca-suave">Solo las ve el administrador. No penalizan solas: si los comisarios lo deciden, cargá la penalización en "Tiempos".</p>
      ${filas.length ? `<div class="tabla-env" style="margin:0"><table class="admin">
        <thead><tr><th>Etapa</th><th>Prueba</th><th>N.º</th><th>Piloto</th><th class="num">Hora de largada</th><th>Estado</th></tr></thead>
        <tbody>${filas.map((l) => `<tr><td>${esc(l.etapa)}</td><td>${esc(l.prueba)}</td><td class="auto">${esc(l.numero)}</td>
          <td>${esc(nombre(l.numero))}</td><td class="num">${hora(l.hora_programada)}</td><td>${esc(l.estado)}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="marca-suave">No hubo largadas anticipadas.</p>`}
    </div>`;
}

// ---------- sección: auditoría -----------------------------------------------------------------
async function dibujarAuditoria() {
  $("seccion").innerHTML = `<div class="tarjeta vacio">Cargando…</div>`;
  const filas = chequear(await db.from("auditoria").select("*").order("cuando", { ascending: false }).limit(100));
  const ACCION = { INSERT: "Alta", UPDATE: "Cambio", DELETE: "Baja" };
  const resumen = (a) => {
    const r = a.despues || a.antes || {};
    const partes = [r.nombre, r.numero && "auto " + r.numero, r.piloto, r.motivo, r.estado,
                    r.segundos && fmtTiempo(r.segundos)].filter(Boolean);
    if (a.accion === "UPDATE" && a.antes && a.despues) {
      const cambios = Object.keys(a.despues).filter((k) => !["recibido", "actualizado"].includes(k) &&
        JSON.stringify(a.antes[k]) !== JSON.stringify(a.despues[k]));
      if (cambios.length) partes.push("(" + cambios.map((k) => `${k}: ${a.antes[k] ?? "—"} → ${a.despues[k] ?? "—"}`).join(", ") + ")");
    }
    return partes.join(" · ");
  };
  $("seccion").innerHTML = `
    <div class="tarjeta">
      <h2>Últimos cambios hechos desde la web</h2>
      ${filas.length ? `<div class="tabla-env" style="margin:0"><table class="admin">
        <thead><tr><th>Cuándo</th><th>Qué</th><th>Tabla</th><th>Detalle</th></tr></thead>
        <tbody>${filas.map((a) => `<tr><td>${new Date(a.cuando).toLocaleString("es-AR", { hour12: false })}</td>
          <td>${ACCION[a.accion] || a.accion}</td><td>${esc(a.tabla)}</td>
          <td style="white-space:normal">${esc(resumen(a))}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="marca-suave">Todavía no hay cambios.</p>`}
    </div>`;
}

intentar(iniciar);
