import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { atracciones } from './ontologia.js';

const contenedor = document.getElementById('visor3d');
const estado = document.getElementById('estado-visor');

// El botón de la página principal indica qué atracción mostrar: atraccion.html?id=...
const id = new URLSearchParams(window.location.search).get('id');
const atraccion = atracciones.find((item) => item.id === id);

if (!atraccion) {
  document.getElementById('nombre-atraccion').textContent = 'Atracción no encontrada';
  estado.textContent = 'Esta atracción no existe. Vuelve a la lista para elegir otra.';
} else {
  mostrarDatos(atraccion);

  if (atraccion.modelo) {
    iniciarVisor(atraccion);
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
function publicarDatosEstructurados({ uri, nombre, comuna, descripcion, modelo }) {
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
    ...(modelo && {
      subjectOf: {
        '@type': '3DModel',
        name: `Modelo 3D de ${nombre}`,
        encoding: {
          '@type': 'MediaObject',
          contentUrl: new URL(modelo, window.location.href).href
        }
      }
    })
  });
  document.head.appendChild(datos);
}

function iniciarVisor({ nombre, modelo: rutaModelo }) {
  const escena = new THREE.Scene();
  escena.background = new THREE.Color(0xeeeeee);

  const camara = new THREE.PerspectiveCamera(
    60,
    contenedor.clientWidth / contenedor.clientHeight,
    0.1,
    1000
  );

  camara.position.set(3, 2, 5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(contenedor.clientWidth, contenedor.clientHeight);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', `Modelo 3D de ${nombre}`);
  contenedor.appendChild(renderer.domElement);

  const luz = new THREE.HemisphereLight(0xffffff, 0x777777, 3);
  escena.add(luz);

  const controles = new OrbitControls(camara, renderer.domElement);

  const loader = rutaModelo.toLowerCase().endsWith('.fbx') ? new FBXLoader() : new GLTFLoader();

  loader.load(
    rutaModelo,
    (resultado) => {
      // GLTFLoader entrega el modelo en .scene; FBXLoader lo entrega directamente
      const modelo = resultado.scene ?? resultado;
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

      estado.remove();
    },
    (progreso) => {
      if (progreso.lengthComputable) {
        estado.textContent = `Cargando modelo… ${Math.round((progreso.loaded / progreso.total) * 100)}%`;
      }
    },
    (error) => {
      console.error('Error cargando modelo:', error);
      estado.textContent = 'No se pudo cargar el modelo 3D.';
    }
  );

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
