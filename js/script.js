import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { obtenerAtraccion } from './ontologia.js';

const contenedor = document.getElementById('visor3d');
const estado = document.getElementById('estado-visor');

iniciar();

async function iniciar() {
  // El botón de la página principal indica qué atracción mostrar: atraccion.html?id=...
  const id = new URLSearchParams(window.location.search).get('id');
  let atraccion;

  try {
    atraccion = await obtenerAtraccion(id);
  } catch (error) {
    console.error('Error consultando Fuseki:', error);
    estado.textContent = 'No se pudo conectar con Fuseki. Comprueba que esté en ejecución y recarga la página.';
    return;
  }

  if (!atraccion) {
    document.getElementById('nombre-atraccion').textContent = 'Atracción no encontrada';
    estado.textContent = 'Esta atracción no existe. Vuelve a la lista para elegir otra.';
    return;
  }

  mostrarDatos(atraccion);

  if (atraccion.modelos.length) {
    iniciarVisor(atraccion.modelos);
  } else {
    estado.textContent = 'Esta atracción aún no tiene modelo 3D.';
  }
}

function mostrarDatos(datos) {
  const { nombre, comuna, tipo, descripcion, calificacion, precio, requierePermiso, tieneTemporada } = datos;

  document.title = `${nombre} | Atracciones turísticas de Magallanes`;
  document.getElementById('nombre-atraccion').textContent = nombre;
  document.getElementById('categoria-atraccion').textContent = comuna ? `${tipo} · ${comuna}` : tipo;
  document.getElementById('descripcion-atraccion').textContent = descripcion;

  const lista = document.getElementById('datos-atraccion');
  agregarDato(lista, 'Calificación', calificacion && `${calificacion} de 5`);
  agregarDato(lista, 'Precio', precio && (Number(precio) === 0 ? 'Gratis' : `$${Number(precio).toLocaleString('es-CL')}`));
  agregarDato(lista, 'Permiso de la autoridad', requierePermiso && (requierePermiso === 'true' ? 'Requerido' : 'No requerido'));
  agregarDato(lista, 'Temporada', tieneTemporada && (tieneTemporada === 'true' ? 'Depende de la temporada' : 'Todo el año'));

  publicarDatosEstructurados(datos);
}

function agregarDato(lista, etiqueta, valor) {
  if (!valor) return;

  const grupo = document.createElement('div');
  const titulo = document.createElement('dt');
  const contenido = document.createElement('dd');

  titulo.textContent = etiqueta;
  contenido.textContent = valor;
  grupo.append(titulo, contenido);
  lista.appendChild(grupo);
}

// Datos estructurados de schema.org, enlazados con el individuo de la ontología
function publicarDatosEstructurados({ uri, nombre, comuna, descripcion, modelos }) {
  const datos = document.createElement('script');
  datos.type = 'application/ld+json';
  datos.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    '@id': uri,
    name: nombre,
    ...(descripcion && { description: descripcion }),
    ...(comuna && {
      address: {
        '@type': 'PostalAddress',
        addressLocality: comuna,
        addressRegion: 'Región de Magallanes',
        addressCountry: 'CL'
      }
    }),
    ...(modelos.length && {
      subjectOf: modelos.map((modelo) => ({
        '@type': '3DModel',
        name: `Modelo 3D de ${modelo.nombre}`,
        encoding: {
          '@type': 'MediaObject',
          contentUrl: new URL(modelo.ruta, window.location.href).href
        }
      }))
    })
  });
  document.head.appendChild(datos);
}

function iniciarVisor(modelos) {
  const escena = new THREE.Scene();
  escena.background = new THREE.Color(0xeeeeee);

  const camara = new THREE.PerspectiveCamera(
    60,
    contenedor.clientWidth / contenedor.clientHeight,
    0.1,
    1000
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
  renderer.domElement.setAttribute('role', 'img');
  contenedor.appendChild(renderer.domElement);

  const luz = new THREE.HemisphereLight(0xffffff, 0x777777, 3);
  escena.add(luz);

  const controles = new OrbitControls(camara, renderer.domElement);
  // Los modelos de modelos3d/ están comprimidos con Meshopt
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

  let modeloActual = null;
  // Si se cambia de modelo durante una descarga, solo se muestra el último elegido
  let ultimaCarga = 0;

  function cargarModelo({ nombre, ruta }) {
    const carga = ++ultimaCarga;

    retirarModeloActual();
    renderer.domElement.setAttribute('aria-label', `Modelo 3D de ${nombre}`);
    estado.hidden = false;
    estado.textContent = 'Cargando modelo…';

    loader.load(
      ruta,
      ({ scene: modelo }) => {
        if (carga !== ultimaCarga) return;

        modeloActual = modelo;
        escena.add(modelo);

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

        const distancia = tamano.length() * 0.75;
        camara.position.set(distancia, distancia * 0.6, distancia);
        camara.near = distancia / 100;
        camara.far = distancia * 10;
        camara.updateProjectionMatrix();
        camara.lookAt(0, 0, 0);
        controles.target.set(0, 0, 0);
        controles.update();

        estado.hidden = true;
      },
      (progreso) => {
        if (carga === ultimaCarga && progreso.lengthComputable) {
          estado.textContent = `Cargando modelo… ${Math.round((progreso.loaded / progreso.total) * 100)}%`;
        }
      },
      (error) => {
        console.error('Error cargando modelo:', error);
        if (carga === ultimaCarga) estado.textContent = 'No se pudo cargar el modelo 3D.';
      }
    );
  }

  // Los modelos son pesados: al cambiar de uno a otro se libera la memoria de la tarjeta gráfica
  function retirarModeloActual() {
    if (!modeloActual) return;

    escena.remove(modeloActual);
    modeloActual.traverse((objeto) => {
      if (!objeto.isMesh) return;
      objeto.geometry.dispose();
      [objeto.material].flat().forEach((material) => {
        Object.values(material).forEach((valor) => {
          if (valor?.isTexture) valor.dispose();
        });
        material.dispose();
      });
    });
    modeloActual = null;
  }

  if (modelos.length > 1) crearSelectorModelos(modelos, cargarModelo);
  cargarModelo(modelos[0]);

  window.addEventListener('resize', () => {
    camara.aspect = contenedor.clientWidth / contenedor.clientHeight;
    camara.updateProjectionMatrix();
    renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
  });

  function animar() {
    requestAnimationFrame(animar);
    controles.update();
    renderer.render(escena, camara);
  }

  animar();
}

function crearSelectorModelos(modelos, cargarModelo) {
  const selector = document.getElementById('selector-modelos');

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
