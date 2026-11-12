// Carta 3D de la región en la portada: gira sola y se puede arrastrar.
// La carta completa, con los lugares de la ontología, está en grafo.html.
import * as THREE from 'three';
import { gx, gz, suelo, construirRegion, REGION } from './mapa-region.js';

// Ciudades principales [nombre, lat, lon]
const CIUDADES = [
  ['Punta Arenas', -53.16, -70.91],
  ['Puerto Natales', -51.73, -72.51],
  ['Porvenir', -53.30, -70.37],
  ['Puerto Williams', -54.93, -67.61]
];

const contenedor = document.getElementById('mapa-portada');
const lienzo = document.getElementById('mapa-portada-lienzo');
const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;

try {
  iniciar();
} catch (error) {
  // Sin WebGL la portada sigue funcionando: solo se oculta la carta
  console.error('No se pudo iniciar la carta 3D:', error);
  contenedor.hidden = true;
}

function iniciar() {
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const escena = new THREE.Scene();
  escena.fog = new THREE.Fog(0x0f2c49, 110, 230);
  const camara = new THREE.PerspectiveCamera(36, 1, 1, 400);

  construirRegion(escena);
  CIUDADES.forEach(([nombre, lat, lon]) => agregarCiudad(escena, nombre, lat, lon));

  // Arrastrar para girar
  let arrastre = 0;
  let x0 = null;
  lienzo.addEventListener('pointerdown', (e) => { x0 = e.clientX; lienzo.setPointerCapture(e.pointerId); });
  lienzo.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    arrastre += (e.clientX - x0) * 0.006;
    x0 = e.clientX;
  });
  const soltar = () => { x0 = null; };
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);

  const medir = () => {
    const w = contenedor.clientWidth;
    const h = contenedor.clientHeight;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  };
  new ResizeObserver(medir).observe(contenedor);
  medir();

  // Solo se dibuja mientras la carta está en pantalla
  let visible = true;
  new IntersectionObserver(([entrada]) => { visible = entrada.isIntersecting; }).observe(contenedor);

  function cuadro(ahora) {
    requestAnimationFrame(cuadro);
    if (!visible) return;
    const angulo = arrastre + (quieto ? 0.1 : 0.1 + Math.sin(ahora * 0.00018) * 0.18);
    const R = REGION.R * (camara.aspect < 0.9 ? 1.25 : 1);
    camara.position.set(REGION.x + Math.sin(angulo) * R, R * 0.85, REGION.z + Math.cos(angulo) * R);
    camara.lookAt(REGION.x, 0, REGION.z);
    renderer.render(escena, camara);
  }
  requestAnimationFrame(cuadro);
}

function agregarCiudad(escena, nombre, lat, lon) {
  const x = gx(lon);
  const z = gz(lat);
  const base = suelo(x, z);
  const alto = 6;
  const color = new THREE.Color('#f2b632');

  const grupo = new THREE.Group();
  grupo.position.set(x, base, z);
  grupo.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, alto, 0)]),
    new THREE.LineBasicMaterial({ color })
  ));

  const gema = new THREE.Mesh(new THREE.OctahedronGeometry(1.15), new THREE.MeshBasicMaterial({ color }));
  gema.position.y = alto;
  grupo.add(gema);

  const aro = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.12, 28),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
  );
  aro.rotation.x = -Math.PI / 2;
  aro.position.y = 0.15;
  grupo.add(aro);

  const rotulo = crearRotulo(nombre);
  rotulo.position.y = alto + 2.2;
  grupo.add(rotulo);

  escena.add(grupo);
}

function crearRotulo(texto) {
  const lienzoTexto = document.createElement('canvas');
  lienzoTexto.width = 512;
  lienzoTexto.height = 64;
  const ctx = lienzoTexto.getContext('2d');
  ctx.font = "600 34px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillStyle = '#eaf4f8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, 256, 32);

  const textura = new THREE.CanvasTexture(lienzoTexto);
  textura.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textura, transparent: true, depthWrite: false }));
  sprite.scale.set(14, 1.75, 1);
  return sprite;
}
