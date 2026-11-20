import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COPIA } from './grafo-datos.js';
import { NS, nombreClase as nomClase } from './catalogo.js'; // los nombres de clase son los mismos que en el resto del sitio
import { consultarSPARQLDetallado, origenDeDatos } from './fuseki.js'; // Fuseki o, si no responde, el motor SPARQL del navegador
import { gx, gz, paso, suelo, construirRegion, REGION } from './mapa-region.js';

/* ============ 1. CONFIGURACIÓN ============ */
const CONFIG = {
  enVivo: true, // true = consultar con SPARQL (js/fuseki.js); false = usar siempre la copia
  modelos: ""   // los .glb se sirven desde public/modelos3d/
};
const Q_INDIVIDUOS = `PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT ?s ?p ?o WHERE {
  ?s a owl:NamedIndividual ;
     ?p ?o .
}`;
// Solo la jerarquía propia: las superclases de schema.org no cuentan para agrupar los nodos
const Q_CLASES = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?clase ?padre WHERE {
  ?clase rdfs:subClassOf ?padre .
  FILTER (STRSTARTS(STR(?clase), "${NS}") && STRSTARTS(STR(?padre), "${NS}"))
}`;


/* ============ 2. MODELO ============ */
const GRUPOS = {
  Ciudad:{nombre:"Ciudad", color:"#f2b632"},
  Naturaleza:{nombre:"Naturaleza", color:"#74d6c2"},
  CulturalHistorico:{nombre:"Cultura e historia", color:"#ff8f66"},
  Establecimientos:{nombre:"Establecimientos", color:"#b79cff"},
  Lugares:{nombre:"Otros lugares", color:"#8ec5ff"}
};
const bonito = id => { const t=String(id).replace(/_/g," ").replace(/([a-zñáéíóú])([A-Z])/g,"$1 $2").trim(); return t.charAt(0).toUpperCase()+t.slice(1); };
const local = iri => { const s=String(iri); return s.includes("#") ? s.slice(s.lastIndexOf("#")+1) : s.replace(/\/$/,"").split("/").pop(); };
// Un IRI de otro sitio (owl:sameAs hacia Wikidata) se conserva entero para poder enlazarlo
const externo = v => /^https?:\/\//.test(v);
const nodo = iri => iri.includes("#") ? local(iri) : iri;
// Texto de un enlace externo: los sitios conocidos por su nombre, el resto por su dominio
const SITIOS = {"wikipedia.org":"Wikipedia", "wikidata.org":"Wikidata"};
const sitio = url => { try{ const h=new URL(url).hostname.replace(/^www\./,""); const d=Object.keys(SITIOS).find(k => h===k || h.endsWith("."+k)); return d ? SITIOS[d] : h; }catch(e){ return url; } };
// Búsqueda de Google Maps por nombre (formato documentado de Maps URLs): abre la ciudad con su ficha
const mapa = x => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(x.nombre + ", Región de Magallanes, Chile");
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));

let SUB = {}, IND = new Map(), LUGARES = [], ACTS = [];
function construir(sub, tri){
  SUB = sub; IND = new Map();
  for(const [s,p,o,iri] of tri){
    if(!IND.has(s)) IND.set(s,{id:s,tipos:[],p:{},tri:[]});
    const x=IND.get(s);
    if(p==="type"){ if(o!=="NamedIndividual"){ x.tipos.push(o); x.tri.push(["rdf:type",":"+o]); } }
    else { (x.p[p] ||= []).push(o); x.tri.push([p==="sameAs" ? "owl:sameAs" : ":"+p, !iri ? JSON.stringify(o) : externo(o) ? "<"+o+">" : ":"+o]); }
  }
  for(const x of IND.values()){
    const linaje = new Set();
    x.tipos.forEach(t => { for(let c=t, n=0; c && n<20; c=SUB[c], n++) linaje.add(c); });
    x.clase = x.tipos[0] || "Thing";
    x.nombre = (x.p.Nombre && x.p.Nombre[0]) || bonito(x.id);
    x.grupo = linaje.has("Actividad") ? "Actividad" : linaje.has("Ciudad") ? "Ciudad" : linaje.has("Comuna") ? "Comuna"
      : linaje.has("Naturaleza") ? "Naturaleza" : linaje.has("CulturalHistorico") ? "CulturalHistorico"
      : linaje.has("Establecimientos") ? "Establecimientos" : linaje.has("Lugares") ? "Lugares" : "Otro";
    x.rama = linaje.has("Turistica") ? "Turística" : linaje.has("Cotidiana") ? "Cotidiana" : "";
  }
  // relaciones inversas
  for(const x of IND.values()){ x.acts=[]; x.contiene=[]; }
  for(const x of IND.values()){
    (x.p.seRealizaEn||[]).forEach(l => IND.get(l) && IND.get(l).acts.push(x.id));
    (x.p.ubicadoEnCiudad||[]).forEach(c => IND.get(c) && IND.get(c).contiene.push(x.id));
  }
  for(const x of IND.values()) (x.p.permiteActividad||[]).forEach(a => { if(IND.has(a) && !x.acts.includes(a)) x.acts.push(a); });
  LUGARES = [...IND.values()].filter(x => GRUPOS[x.grupo]);
  ACTS = [...IND.values()].filter(x => x.grupo==="Actividad");
}

async function sparql(q){ return (await consultarSPARQLDetallado(q)).filas; }
async function cargar(){
  if(!CONFIG.enVivo){ construir(COPIA.sub, COPIA.tri); return {modo:"copia"}; }
  try{
    const [ti, tc] = await Promise.all([sparql(Q_INDIVIDUOS), sparql(Q_CLASES)]);
    const sub = {}; tc.forEach(b => { sub[local(b.clase.value)] = local(b.padre.value); });
    const tri = ti.map(b => [local(b.s.value), local(b.p.value), b.o.type==="uri" ? nodo(b.o.value) : b.o.value, b.o.type==="uri" ? 1 : 0]);
    if(!tri.length) throw new Error("el dataset no devolvió individuos");
    // Un turismo.rdf anterior usa otros identificadores: sin la jerarquía de clases de esta ontología la carta quedaría vacía
    if(!tc.length || !ti.some(b => b.s.value.startsWith(NS))) throw new Error("el dataset no usa los identificadores de esta ontología; carga el turismo.rdf actual");
    construir(sub, tri); return {modo:"vivo", origen: await origenDeDatos()};
  }catch(e){
    console.error("No se pudo consultar la ontología:", e);
    construir(COPIA.sub, COPIA.tri); return {modo:"error", error:e.message};
  }
}

/* ============ 3. GEOGRAFÍA → ESCENA (ver mapa-region.js) ============ */
// Coordenadas [lat, lon] de un individuo: vienen de la ontología (t:Latitud y t:Longitud)
function coord(id){
  const x=IND.get(id); if(!x) return null;
  const la=parseFloat(x.p.Latitud && x.p.Latitud[0]), lo=parseFloat(x.p.Longitud && x.p.Longitud[0]);
  return isFinite(la) && isFinite(lo) ? [la,lo] : null;
}
function ubicar(){           // asigna x,z a cada lugar: coordenada propia, o anillo en torno a su ciudad o comuna
  const anillos = new Map();
  for(const x of LUGARES){
    const c = coord(x.id);
    x.pos=null; x.satelite=false;
    if(c){ x.pos={x:gx(c[1]), z:gz(c[0])}; x.lat=c[0]; x.lon=c[1]; continue; }
    const ancla = [...(x.p.ubicadoEnCiudad||[]), ...(x.p.ubicadoEnComuna||[])].find(a => coord(a));
    if(ancla){ if(!anillos.has(ancla)) anillos.set(ancla,[]); anillos.get(ancla).push(x); }
  }
  anillos.forEach((lista, ancla) => {
    const [la,lo]=coord(ancla), n=lista.length;
    lista.forEach((x,k) => {
      const a = k/n*Math.PI*2 + .4, r = n>6 ? 2.4+(k%2)*1.5 : 2.2;
      x.pos={x:gx(lo)+Math.cos(a)*r, z:gz(la)+Math.sin(a)*r}; x.satelite=true; x.lat=la; x.lon=lo;
    });
  });
}

let estado = {sel:null, ocultas:new Set()}, tres = null;
const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;

function iniciar3D(){
  const cont=$("carta"), lienzo=$("lienzo");
  const renderer = new THREE.WebGLRenderer({canvas:lienzo, antialias:true, alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  const escena = new THREE.Scene();
  escena.fog = new THREE.Fog(0x0f2c49, 110, 230);
  const cam = new THREE.PerspectiveCamera(36,1,1,400);

  construirRegion(escena);

  const grupo = new THREE.Group(); escena.add(grupo);
  tres = {renderer, escena, cam, cont, grupo, nodos:new Map(), orden:[], arcos:[], t0:performance.now(), arrastre:0,
          vista:{...REGION}, meta:{...REGION}};

  let px=null;
  lienzo.addEventListener("pointerdown", e => { px=e.clientX; lienzo.setPointerCapture(e.pointerId); });
  lienzo.addEventListener("pointermove", e => { if(px===null) return; tres.arrastre += (e.clientX-px)*.006; px=e.clientX; });
  const soltar = () => { px=null; };
  lienzo.addEventListener("pointerup", soltar); lienzo.addEventListener("pointercancel", soltar);

  const medir = () => { const w=cont.clientWidth, h=cont.clientHeight; renderer.setSize(w,h,false); cam.aspect=w/h; cam.updateProjectionMatrix(); };
  new ResizeObserver(medir).observe(cont); medir();
  requestAnimationFrame(cuadro);
}

function poblar3D(){
  const {grupo, nodos} = tres;
  while(grupo.children.length) grupo.remove(grupo.children[0]);
  nodos.clear(); tres.arcos=[]; $("etiquetas").innerHTML="";
  LUGARES.filter(x=>x.pos).forEach((x,i) => {
    const info=GRUPOS[x.grupo], color=new THREE.Color(info.color), hub=x.grupo==="Ciudad";
    const base=suelo(x.pos.x,x.pos.z), alto = hub ? 6 : x.satelite ? 2.2+(i%3)*.9 : 3.2+(i%3)*1.1;
    const g=new THREE.Group(); g.position.set(x.pos.x,base,x.pos.z);
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(0,alto,0)]), new THREE.LineBasicMaterial({color, transparent:true, opacity:hub?1:.7})));
    const gema=new THREE.Mesh(new THREE.OctahedronGeometry(hub?1.15:x.satelite?.5:.75), new THREE.MeshBasicMaterial({color})); gema.position.y=alto; g.add(gema);
    const aro=new THREE.Mesh(new THREE.RingGeometry(.9,1.12,28), new THREE.MeshBasicMaterial({color, side:THREE.DoubleSide, transparent:true, opacity:.7}));
    aro.rotation.x=-Math.PI/2; aro.position.y=.15; aro.visible=!x.satelite; g.add(aro);
    grupo.add(g);
    const b=document.createElement("button"); b.type="button"; b.className="pin"+(hub?" hub":""); b.dataset.id=x.id; b.style.setProperty("--c",info.color);
    b.innerHTML="<i></i><span></span>"; b.lastChild.textContent=x.nombre; b.title=x.nombre; b.setAttribute("aria-label",x.nombre+", "+nomClase(x.clase));
    b.addEventListener("click",()=>elegir(x.id,{enfocar:true})); $("etiquetas").appendChild(b);
    nodos.set(x.id,{x,g,gema,aro,b,hub,cima:new THREE.Vector3(x.pos.x,base+alto,x.pos.z),nace:i*45,w:Math.min(x.nombre.length*(hub?7.4:6.8)+30,250),mini:false});
  });
  // Aristas ubicadoEnCiudad: radio recto para los satélites, arco para los lugares con coordenada propia
  nodos.forEach(n => (n.x.p.ubicadoEnCiudad||[]).forEach(cid => {
    const o=nodos.get(cid); if(!o) return;
    let pts;
    if(n.x.satelite) pts=[n.cima,o.cima];
    else { const m=n.cima.clone().add(o.cima).multiplyScalar(.5); m.y+=3+n.cima.distanceTo(o.cima)*.18; pts=new THREE.QuadraticBezierCurve3(n.cima,m,o.cima).getPoints(36); }
    const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color:0xeaf4f8, transparent:true, opacity:.22}));
    grupo.add(l); tres.arcos.push({l,a:n.x.id,o:cid});
  }));
  tres.orden = [...nodos.values()].sort((a,b) => (b.hub-a.hub) || (a.x.satelite-b.x.satelite));
  tres.t0=performance.now();
}

const v3 = new THREE.Vector3();
function cuadro(ahora){
  requestAnimationFrame(cuadro);
  if(!$("visor").hidden) return;
  const {renderer, escena, cam, cont, nodos, vista, meta} = tres, t=ahora-tres.t0;
  const w=cont.clientWidth, h=cont.clientHeight, k=quieto?1:.07;
  vista.x+=(meta.x-vista.x)*k; vista.z+=(meta.z-vista.z)*k; vista.R+=(meta.R-vista.R)*k;
  const ang = tres.arrastre + (quieto ? .1 : .1+Math.sin(ahora*.00018)*.18);
  const R = vista.R*(w/h<.9 ? 1.25 : 1);
  cam.position.set(vista.x+Math.sin(ang)*R, R*.85, vista.z+Math.cos(ang)*R); cam.lookAt(vista.x,0,vista.z);
  const puestos=[], zoom=Math.min(1,Math.max(.45,vista.R/86));
  const colocar = n => {
    const visible=!estado.ocultas.has(n.x.grupo), sel=estado.sel===n.x.id;
    const e = quieto ? 1 : paso(0,600,t-n.nace);
    n.g.visible=visible; n.g.scale.set(1,Math.max(e,.001),1);
    n.gema.scale.setScalar((sel?1.8:1)*zoom); if(!quieto) n.gema.rotation.y=ahora*.001;
    n.aro.visible = !n.x.satelite || sel; n.aro.scale.setScalar(sel ? (quieto?1.8:1.5+Math.sin(ahora*.004)*.4) : 1);
    v3.copy(n.cima).project(cam);
    const fuera = !visible || v3.z>1 || e<.6 || (1-v3.y)/2*h < 58;
    n.b.style.display = fuera ? "none" : "";
    if(fuera) return;
    const X=(v3.x+1)/2*w+10, Y=(1-v3.y)/2*h-11, r=[X,Y,X+n.w,Y+22];
    const choca = !sel && puestos.some(q => r[0]<q[2] && r[2]>q[0] && r[1]<q[3] && r[3]>q[1]);
    if(choca!==n.mini){ n.mini=choca; n.b.classList.toggle("mini",choca); }
    puestos.push(choca ? [X,Y,X+18,Y+18] : r);
    n.b.style.transform = `translate(${X.toFixed(1)}px,${Y.toFixed(1)}px)`;
  };
  const s = nodos.get(estado.sel); if(s) colocar(s);
  tres.orden.forEach(n => { if(n!==s) colocar(n); });
  tres.arcos.forEach(x => {
    const act = estado.sel===x.a || estado.sel===x.o;
    x.l.visible = !estado.ocultas.has(nodos.get(x.a).x.grupo) && !estado.ocultas.has(nodos.get(x.o).x.grupo);
    x.l.material.opacity = act ? 1 : .22; x.l.material.color.set(act ? 0xf2b632 : 0xeaf4f8);
  });
  renderer.render(escena,cam);
}

/* ============ 4. VISOR DE MODELOS .glb ============ */
let visor = null;
function abrirModelo(ruta, titulo){
  $("visor").hidden=false; $("visorTitulo").textContent=titulo; $("visorRuta").textContent=ruta;
  const aviso=$("visorAviso"); aviso.textContent="Cargando modelo";
  $("carta").scrollIntoView({behavior:quieto?"auto":"smooth", block:"center"});
  const falla = () => { aviso.innerHTML = `<div>No se pudo cargar <code>${esc(ruta)}</code>.<br>Revisa que el archivo esté en <code>public/modelos3d/</code> y que la página se abra con <code>npm run dev</code>.</div>`; };
  try{
    if(!visor){
      const lz=$("visorLienzo"), r=new THREE.WebGLRenderer({canvas:lz, antialias:true, alpha:true});
      r.setPixelRatio(Math.min(devicePixelRatio,2));
      const e=new THREE.Scene(), c=new THREE.PerspectiveCamera(40,1,.01,1000);
      e.add(new THREE.HemisphereLight(0xeaf4f8,0x777777,2.6)); const d=new THREE.DirectionalLight(0xffffff,1.6); d.position.set(3,5,4); e.add(d);
      const ctl=new OrbitControls(c,lz); ctl.enableDamping=true; ctl.autoRotate=!quieto; ctl.autoRotateSpeed=1.2;
      visor={r,e,c,ctl,modelo:null,carga:0,loader:new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)};
      (function bucle(){ requestAnimationFrame(bucle); if($("visor").hidden) return;
        const box=lz.parentElement, w=box.clientWidth, h=box.clientHeight;
        if(lz.width!==Math.floor(w*r.getPixelRatio()) || lz.height!==Math.floor(h*r.getPixelRatio())){ r.setSize(w,h,false); c.aspect=w/h; c.updateProjectionMatrix(); }
        ctl.update(); r.render(e,c); })();
    }
    retirarModelo();
    const carga = ++visor.carga;   // si se pide otro modelo durante la descarga, solo se muestra el último
    visor.loader.load(CONFIG.modelos+ruta, gltf => {
      if(carga!==visor.carga) return;
      const m=gltf.scene;
      m.traverse(o => { if(o.isMesh) [o.material].flat().forEach(mt => { mt.side=THREE.DoubleSide; }); });
      const caja=new THREE.Box3().setFromObject(m), centro=caja.getCenter(new THREE.Vector3()), tam=caja.getSize(new THREE.Vector3());
      const d=Math.max(tam.x,tam.y,tam.z)||1; m.position.sub(centro);
      visor.e.add(m); visor.modelo=m; visor.c.near=d/100; visor.c.far=d*100; visor.c.position.set(d*1.1,d*.7,d*1.5); visor.c.updateProjectionMatrix();
      visor.ctl.target.set(0,0,0); aviso.textContent="";
    }, p => { if(carga===visor.carga && p.lengthComputable) aviso.textContent=`Cargando modelo… ${Math.round(p.loaded/p.total*100)}%`; },
    e => { console.error(e); if(carga===visor.carga) falla(); });
  }catch(err){ console.error(err); falla(); }
}
// Los modelos son pesados: al cambiar o cerrar se libera la memoria de la tarjeta gráfica
function retirarModelo(){
  if(!visor || !visor.modelo) return;
  visor.e.remove(visor.modelo);
  visor.modelo.traverse(o => {
    if(!o.isMesh) return;
    o.geometry.dispose();
    [o.material].flat().forEach(mt => { Object.values(mt).forEach(v => { if(v && v.isTexture) v.dispose(); }); mt.dispose(); });
  });
  visor.modelo=null;
}
$("visorCerrar").addEventListener("click", () => { $("visor").hidden=true; if(visor) visor.carga++; retirarModelo(); });

/* ============ 5. INTERFAZ ============ */
const dinero = v => { const n=Number(v); return !isFinite(n) ? String(v) : n===0 ? "Sin costo" : "$" + n.toLocaleString("es-CL"); };
const enlace = id => { const y=IND.get(id); return y ? `<button type="button" class="ir" data-ir="${esc(id)}">${esc(y.nombre)}</button>` : `<span class="sinenlace">${esc(bonito(id))}</span>`; };
const texto1 = (x,p) => x.p[p] && x.p[p][0];
function etiquetasDato(x){
  const d=[];
  if(texto1(x,"Calificacion")!==undefined) d.push("★ "+texto1(x,"Calificacion"));
  if(texto1(x,"Precio")!==undefined) d.push(dinero(texto1(x,"Precio")));
  if(texto1(x,"requierePermisoAutoridad")==="true") d.push("Requiere permiso");
  if(texto1(x,"tieneTemporada")==="true") d.push("Por temporada");
  return d;
}

function elegir(id, opt={}){
  const x=IND.get(id); if(!x) return;
  estado.sel=id;
  const info=GRUPOS[x.grupo] || {nombre:x.grupo, color:"#f2b632"}, f=$("ficha");
  f.style.setProperty("--c",info.color);
  const datos=etiquetasDato(x), modelos=x.p.tieneModelo3D||[];
  const comunas=[...(x.p.ubicadoEnComuna||[]), ...(x.p.perteneceAComuna||[])];
  let h = `<div class="clase">${esc(info.nombre)} · ${esc(nomClase(x.clase))}</div><h2>${esc(x.nombre)}</h2>`;
  if(texto1(x,"Descripcion")) h += `<p>${esc(texto1(x,"Descripcion"))}</p>`;
  if(datos.length) h += `<div class="datos">${datos.map(d=>`<span class="dato">${esc(d)}</span>`).join("")}</div>`;
  if(modelos.length) h += `<div class="grupo"><h3>Modelo 3D</h3><div class="lista">${modelos.map(m=>`<button type="button" class="ir m3d" data-modelo="${esc(m)}">Ver ${esc(m.split("/").pop())}</button>`).join("")}</div></div>`;
  if((x.p.ubicadoEnCiudad||[]).length || comunas.length) h += `<div class="grupo"><h3>Ubicación</h3><div class="lista">${(x.p.ubicadoEnCiudad||[]).map(enlace).join("")}${comunas.map(c=>`<span class="dato">Comuna de ${esc(bonito(c))}</span>`).join("")}</div></div>`;
  // Enlaces externos: páginas (t:tieneEnlace), el mismo lugar en otras bases (owl:sameAs) y, en las ciudades, su mapa
  const vinculos=[...(x.p.tieneEnlace||[]), ...(x.p.sameAs||[])].filter(externo).map(u => [sitio(u), u]);
  if(x.grupo==="Ciudad") vinculos.push(["Google Maps", mapa(x)]);
  if(vinculos.length) h += `<div class="grupo"><h3>Enlaces</h3><div class="lista">${vinculos.map(([t,u])=>`<a class="ir" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)} ↗</a>`).join("")}</div></div>`;
  if(x.acts.length) h += `<div class="grupo"><h3>Actividades aquí</h3><div class="lista">${x.acts.map(a=>{const y=IND.get(a); return `<span class="ir">${esc(y.nombre)}<small>${esc(nomClase(y.clase))}</small></span>`;}).join("")}</div></div>`;
  if(x.contiene.length) h += `<div class="grupo"><h3>Lugares en esta ciudad</h3><div class="lista">${x.contiene.map(enlace).join("")}</div></div>`;
  h += `<details><summary>Tripletas RDF (${x.tri.length})</summary><div class="triplas"><div>:${esc(x.id)}</div>${x.tri.map(([p,o])=>`<div>&nbsp;&nbsp;<b>${esc(p)}</b> <span>${esc(o)}</span></div>`).join("")}</div></details>`;
  f.innerHTML=h; f.scrollTop=0;
  document.querySelectorAll(".pin,.fila").forEach(b => b.setAttribute("aria-pressed", b.dataset.id===id ? "true":"false"));
  if(tres && opt.enfocar && x.pos){ tres.meta={x:x.pos.x, z:x.pos.z, R:x.grupo==="Ciudad"?40:52}; $("vista").hidden=false; }
  if(opt.subir){ $("visor").hidden=true; $("carta").scrollIntoView({behavior:quieto?"auto":"smooth", block:"center"}); }
}
document.addEventListener("click", e => {
  const ir=e.target.closest("[data-ir]"); if(ir) return elegir(ir.dataset.ir,{enfocar:true, subir:!ir.closest(".ficha")});
  const m=e.target.closest("[data-modelo]"); if(m) abrirModelo(m.dataset.modelo, IND.get(estado.sel).nombre);
});

function pintar(){
  const ordenG=Object.keys(GRUPOS);
  const orden=[...LUGARES].sort((a,b)=>ordenG.indexOf(a.grupo)-ordenG.indexOf(b.grupo) || a.nombre.localeCompare(b.nombre,"es"));
  $("indice").innerHTML = orden.map(x => {
    const lugar = (x.p.ubicadoEnCiudad||[]).map(c=>IND.get(c)?IND.get(c).nombre:bonito(c))[0] || (x.p.ubicadoEnComuna||x.p.perteneceAComuna||[]).map(c=>"Comuna de "+bonito(c))[0] || "";
    const extra=[...etiquetasDato(x).slice(0,2), ...(x.p.tieneModelo3D?["3D"]:[])].join(" · ");
    return `<button type="button" class="fila" data-id="${esc(x.id)}" data-grupo="${x.grupo}" data-ir="${esc(x.id)}" style="--c:${GRUPOS[x.grupo].color}" aria-pressed="false">
      <strong>${esc(x.nombre)}</strong><span class="cl"><i></i>${esc(nomClase(x.clase))}</span><span class="pv">${esc(lugar)}</span><span class="xy">${esc(extra)}</span></button>`;
  }).join("");
  $("acts").innerHTML = [...ACTS].sort((a,b)=>b.rama.localeCompare(a.rama) || a.nombre.localeCompare(b.nombre,"es")).map(a => {
    const d=etiquetasDato(a), donde=(a.p.seRealizaEn||[]);
    return `<article class="act"><div class="tipo">${esc([a.rama,nomClase(a.clase)].filter(Boolean).join(" · "))}</div><h3>${esc(a.nombre)}</h3>
      ${texto1(a,"Descripcion") ? `<p>${esc(texto1(a,"Descripcion"))}</p>` : ""}
      ${d.length ? `<div class="datos">${d.map(t=>`<span class="dato">${esc(t)}</span>`).join("")}</div>` : ""}
      ${donde.length ? `<div class="lista">${donde.map(enlace).join("")}</div>` : `<span class="sinenlace">Sin lugar asignado en la ontología</span>`}</article>`;
  }).join("");
  const fl=$("filtros"); fl.innerHTML="";
  ordenG.filter(g => LUGARES.some(x=>x.grupo===g && x.pos)).forEach(g => {
    const b=document.createElement("button"); b.type="button"; b.className="chip"; b.style.setProperty("--c",GRUPOS[g].color); b.setAttribute("aria-pressed","true");
    b.innerHTML="<i></i>"+esc(GRUPOS[g].nombre);
    b.addEventListener("click",()=>{
      const on=b.getAttribute("aria-pressed")==="true"; b.setAttribute("aria-pressed",on?"false":"true");
      on ? estado.ocultas.add(g) : estado.ocultas.delete(g);
      document.querySelectorAll(".fila").forEach(f => f.hidden = estado.ocultas.has(f.dataset.grupo));
    });
    fl.appendChild(b);
  });
  const v=document.createElement("button"); v.type="button"; v.className="chip vista"; v.id="vista"; v.hidden=true; v.textContent="Ver toda la región";
  v.addEventListener("click",()=>{ if(tres) tres.meta={...REGION}; v.hidden=true; }); fl.appendChild(v);
}

$("consulta").textContent = "# 1. Todas las tripletas de los individuos\n" + Q_INDIVIDUOS + "\n\n# 2. Jerarquía de clases\n" + Q_CLASES;
document.querySelectorAll("[data-copiar]").forEach(b => b.addEventListener("click", async () => {
  const pre=$(b.dataset.copiar);
  try{ await navigator.clipboard.writeText(pre.textContent); b.textContent="Copiado"; }
  catch(e){ const r=document.createRange(); r.selectNodeContents(pre); const s=getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent="Seleccionado"; }
  setTimeout(()=>b.textContent="Copiar",1600);
}));

(async function(){
  try{ iniciar3D(); }catch(e){ console.error(e); tres=null; $("lienzo").style.display="none"; $("sinwebgl").style.display="grid"; }
  const {modo, error, origen} = await cargar();
  ubicar();
  const nm=[...IND.values()].reduce((s,x)=>s+(x.p.tieneModelo3D && x.grupo!=="Comuna" ? x.p.tieneModelo3D.length : 0),0);
  const resumen=`${IND.size} individuos · ${LUGARES.length} lugares y ciudades · ${ACTS.length} actividades · ${nm} modelos 3D`;
  const es=$("estado"); es.dataset.modo=modo;
  es.lastElementChild.textContent = modo==="vivo" ? `${origen==="navegador" ? "SPARQL en el navegador sobre turismo.rdf" : "En vivo desde Fuseki"} · ${resumen}`
    : modo==="error" ? `No se pudo consultar la ontología (${error}). Copia de turismo.rdf · ${resumen}` : `Copia de turismo.rdf · ${resumen}`;
  pintar();
  if(tres) poblar3D();
  elegir(IND.has("ParqueTorresDelPaine") ? "ParqueTorresDelPaine" : (LUGARES[0]||{}).id);
})();
