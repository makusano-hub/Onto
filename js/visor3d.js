// Visor Three.js reutilizable: lo usan la ficha pública (atraccion.html) y el panel
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Los modelos de modelos3d/ están comprimidos con Meshopt
const crearLoader = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// Giro automático del modelo, en radianes por segundo: una vuelta cada 50 s, como el visor de la carta 3D.
// Quien pide menos movimiento en su sistema ve el modelo quieto (igual que en la carta).
const VELOCIDAD_GIRO = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : (2 * Math.PI) / 50;

export function crearVisor(contenedor, { estado, selector, fondo = 0xeeeeee } = {}) {
  const escena = new THREE.Scene();
  escena.background = new THREE.Color(fondo);

  const camara = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.setAttribute('role', 'img');
  contenedor.appendChild(renderer.domElement);

  escena.add(new THREE.HemisphereLight(0xffffff, 0x777777, 3));

  const controles = new OrbitControls(camara, renderer.domElement);
  const loader = crearLoader();

  let modeloActual = null;
  // Si se cambia de modelo durante una descarga, solo se muestra el último elegido
  let ultimaCarga = 0;
  let activo = true;

  const avisar = (texto) => {
    if (!estado) return;
    estado.hidden = !texto;
    estado.textContent = texto ?? '';
  };

  function ajustarTamano() {
    const ancho = contenedor.clientWidth || 1;
    const alto = contenedor.clientHeight || 1;
    camara.aspect = ancho / alto;
    camara.updateProjectionMatrix();
    renderer.setSize(ancho, alto);
  }

  const observador = new ResizeObserver(ajustarTamano);
  observador.observe(contenedor);
  ajustarTamano();

  function cargarModelo({ nombre, ruta }) {
    const carga = ++ultimaCarga;

    retirarModeloActual();
    renderer.domElement.setAttribute('aria-label', `Modelo 3D de ${nombre}`);
    avisar('Cargando modelo…');

    loader.load(
      ruta,
      ({ scene: modelo }) => {
        if (carga !== ultimaCarga || !activo) return;

        modeloActual = new THREE.Group();
        modeloActual.add(modelo);
        escena.add(modeloActual);

        // Algunos modelos son superficies delgadas: sin esto desaparecen al mirarlos por detrás
        modelo.traverse((objeto) => {
          if (!objeto.isMesh) return;
          [objeto.material].flat().forEach((material) => {
            material.side = THREE.DoubleSide;
          });
        });

        // Centrar el modelo y ajustar la cámara
        const caja = new THREE.Box3().setFromObject(modelo);
        const centro = caja.getCenter(new THREE.Vector3());
        const tamano = caja.getSize(new THREE.Vector3());

        modelo.position.sub(centro);

        const distancia = tamano.length() * 0.75 || 1;
        camara.position.set(distancia, distancia * 0.6, distancia);
        camara.near = distancia / 100;
        camara.far = distancia * 10;
        camara.updateProjectionMatrix();
        camara.lookAt(0, 0, 0);
        controles.target.set(0, 0, 0);
        controles.update();

        avisar(null);
      },
      (progreso) => {
        if (carga === ultimaCarga && progreso.lengthComputable) {
          avisar(`Cargando modelo… ${Math.round((progreso.loaded / progreso.total) * 100)}%`);
        }
      },
      (error) => {
        console.error('Error cargando modelo:', error);
        if (carga === ultimaCarga) avisar('No se pudo cargar el modelo 3D.');
      }
    );
  }

  // Los modelos son pesados: al cambiar de uno a otro se libera la memoria de la tarjeta gráfica
  function retirarModeloActual() {
    if (!modeloActual) return;

    escena.remove(modeloActual);
    liberar(modeloActual);
    modeloActual = null;
  }

  let tiempoAnterior = performance.now();
  function animar(tiempo = performance.now()) {
    if (!activo) return;
    requestAnimationFrame(animar);
    const delta = Math.min((tiempo - tiempoAnterior) / 1000, 0.05);
    tiempoAnterior = tiempo;
    if (modeloActual) modeloActual.rotation.y += VELOCIDAD_GIRO * delta;
    controles.update();
    renderer.render(escena, camara);
  }
  animar();

  return {
    mostrar(modelos) {
      selector?.replaceChildren();
      if (!modelos.length) {
        avisar('Esta atracción aún no tiene modelo 3D.');
        return;
      }
      if (modelos.length > 1 && selector) crearSelectorModelos(selector, modelos, cargarModelo);
      cargarModelo(modelos[0]);
    },
    destruir() {
      activo = false;
      ultimaCarga++;
      observador.disconnect();
      retirarModeloActual();
      controles.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}

function liberar(raiz) {
  raiz.traverse((objeto) => {
    if (!objeto.isMesh) return;
    objeto.geometry.dispose();
    [objeto.material].flat().forEach((material) => {
      Object.values(material).forEach((valor) => {
        if (valor?.isTexture) valor.dispose();
      });
      material.dispose();
    });
  });
}

function crearSelectorModelos(selector, modelos, cargarModelo) {
  modelos.forEach((modelo, indice) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'button outline boton-filtro';
    boton.textContent = modelo.nombre;
    boton.setAttribute('aria-pressed', String(indice === 0));

    boton.addEventListener('click', () => {
      if (boton.getAttribute('aria-pressed') === 'true') return;

      selector.querySelectorAll('button').forEach((otro) => {
        otro.setAttribute('aria-pressed', String(otro === boton));
      });
      cargarModelo(modelo);
    });

    selector.appendChild(boton);
  });
}

// Usado por la validación: descarga y analiza un modelo sin dibujarlo
export async function probarModelo(ruta) {
  const inicio = performance.now();
  const gltf = await crearLoader().loadAsync(ruta);
  let mallas = 0;
  let triangulos = 0;

  gltf.scene.traverse((objeto) => {
    if (!objeto.isMesh) return;
    mallas++;
    const geometria = objeto.geometry;
    triangulos += (geometria.index ? geometria.index.count : geometria.attributes.position.count) / 3;
  });

  const tamano = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
  liberar(gltf.scene);

  return {
    ms: Math.round(performance.now() - inicio),
    mallas,
    triangulos: Math.round(triangulos),
    vacio: mallas === 0 || !Number.isFinite(tamano.length()) || tamano.length() === 0
  };
}
