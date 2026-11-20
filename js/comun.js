// Configuración y utilidades compartidas por todas las páginas.
// La publishable key es pública por diseño: la seguridad la dan las reglas de la base (RLS).
const SUPABASE_URL = "https://vrhpmvdtbwovyturrloc.supabase.co";
const SUPABASE_KEY = "sb_publishable_4NjfbBRWAaHWRwcDF98wMg_f7VOFS6V";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Segundos -> "m:ss.d" o "h:mm:ss.d", con las décimas TRUNCADAS (reglamento).
function fmtTiempo(seg) {
  if (seg === null || seg === undefined || isNaN(seg)) return "";
  const negativo = seg < 0;
  let dec = Math.floor(Math.abs(seg) * 10 + 1e-6);
  const d = dec % 10; dec = (dec - d) / 10;
  const s = dec % 60; dec = (dec - s) / 60;
  const m = dec % 60; const h = (dec - m) / 60;
  const ss = String(s).padStart(2, "0");
  const txt = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}.${d}` : `${m}:${ss}.${d}`;
  return (negativo ? "-" : "") + txt;
}

function fmtDiferencia(seg) {
  return seg > 0 ? "+" + fmtTiempo(seg) : "";
}

function fmtFechas(desde, hasta) {
  const f = (iso) => {
    if (!iso) return "";
    const [a, m, d] = iso.split("-");
    return `${Number(d)}/${Number(m)}/${a}`;
  };
  if (desde && hasta && desde !== hasta) return `${f(desde)} al ${f(hasta)}`;
  return f(desde || hasta);
}

function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Color fijo para cada clase (siempre el mismo para el mismo nombre).
const COLORES_CLASE = ["#1f6feb", "#f2661d", "#7c3aed", "#12925a", "#d4a106", "#db2777",
                       "#0891b2", "#b45309", "#4d7c0f", "#9333ea", "#c8282f", "#0f766e"];
function colorClase(nombre) {
  if (/^invitad/i.test(nombre || "")) return "#9aa0ab";
  let h = 0;
  for (const c of String(nombre || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORES_CLASE[h % COLORES_CLASE.length];
}
function chipClase(nombre) {
  return `<span class="chip-clase" style="--c:${colorClase(nombre)}">${esc(nombre)}</span>`;
}

// Encabezado y pie comunes del Campeonato.
function encabezado(extra = "", ancho = false) {
  const c = ancho ? "contenedor ancho" : "contenedor";
  return `
  <div class="franja-campeonato"><div class="${c}">
    <span><b>Campeonato Regional de Rally</b> <span class="punto">●</span> FRAD 11</span>
    <span class="derecha">Cronometraje oficial</span>
  </div></div>
  <header class="sitio"><div class="${c}">
    <a class="marca" href="index.html">
      <span class="marca-sello">11</span>
      <span class="marca-texto"><strong>Rally FRAD 11</strong><small>Campeonato Regional</small></span>
    </a>
    ${extra}
  </div></header>`;
}
function pie(ancho = false) {
  return `<footer class="sitio"><div class="${ancho ? "contenedor ancho" : "contenedor"}">
    <span><b>Campeonato Regional de Rally · FRAD 11</b></span>
  </div></footer>`;
}

function parametro(nombre) {
  return new URLSearchParams(location.search).get(nombre);
}
