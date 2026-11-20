este programa es para poder realizar ontologias a una web, para proyecto de ramo universitario


## Estructura del sitio

| Página | Para qué |
| --- | --- |
| `index.html` | Portada pública: bandera y escudo, accesos por categoría (monumentos, museos, plazas, actividades, restaurantes, hoteles) y filtros por comuna. |
| `atraccion.html?id=…` | Ficha pública con el visor 3D. |
| `panel.html` | Panel interno: **Explorar**, **Validación**, **Consultas SPARQL** y **Nuevo individuo**. |
| `grafo.html` | Carta 3D de la región. |
| `datos.html` | Datos abiertos: descarga del grafo en RDF/XML, Turtle y JSON-LD, y las reglas SHACL. |
| `ontologia/` | Vocabulario: el documento al que llevan los IRIs de la ontología, con una entrada por clase, propiedad e individuo. |
| `ficha/<id>.html` | Solo en el sitio compilado: una ficha por atracción con sus datos y su JSON-LD ya incrustados. |

Código compartido en `js/`:

- `catalogo.js`: registro central (categorías, clases raíz, nombres legibles). Una categoría nueva se añade solo aquí.
- `consultas.js`: todas las consultas SPARQL, con nombre; el panel las muestra y permite ejecutarlas.
- `fuseki.js`: envía las consultas. Si Fuseki responde, a Fuseki; si no, al motor del navegador.
- `motor-local.js`: motor SPARQL del navegador (Oxigraph en WebAssembly) sobre los archivos de `datos/`. Solo se descarga cuando no hay Fuseki.
- `ontologia.js`: convierte las respuestas SPARQL en objetos de atracción.
- `ficha.js` y `visor3d.js`: ficha y visor Three.js reutilizables (los usan la ficha pública y el panel).
- `ficha-datos.js`: campos de la ficha y datos estructurados (JSON-LD); no necesita navegador, así que también se usa al compilar.
- `validacion.js`: reglas de validación (ontología, datos, modelo/imágenes e interfaz).
- `shacl.js`: envía las reglas SHACL a Fuseki y lee su informe.

## Fuseki, inferencia y validación

Inicia Fuseki desde la carpeta del proyecto con la configuración del repositorio (ajusta la ruta de Fuseki):

```bash
java -jar C:\apache-jena-fuseki-6.2.0\fuseki-server.jar --localhost --config=fuseki/config.ttl
```

Carga `ontologia/turismo.rdf` al arrancar, así que no hay que subir el archivo a mano. Después de editar la ontología, reinicia Fuseki.

Esta configuración es de solo lectura: no hay `/turismo/update` ni `/turismo/data`. El sitio y la compilación solo consultan, y un endpoint de escritura sin contraseña lo puede usar cualquier página web abierta en el mismo navegador, aunque Fuseki escuche solo en tu equipo. Para cambiar los datos se edita `ontologia/turismo.rdf` y se reinicia Fuseki. Mantén `--localhost`: sin esa opción Fuseki responde a toda la red sin necesidad.

| Endpoint | Qué ofrece |
| --- | --- |
| `/turismo` | Los datos tal como están en el archivo. Es el que usa el sitio. |
| `/turismo-inferido` | Los mismos datos más lo que deduce el razonador (OWL Micro): tipos por `rdfs:subClassOf`, `rdfs:domain` y `rdfs:range`, propiedades por `rdfs:subPropertyOf`, inversas por `owl:inverseOf` y la comuna de cada lugar por la transitividad de `t:ubicadoEn`. En el panel: casilla *Con inferencia* de la pestaña *Consultas SPARQL*. |
| `/turismo/shacl` | Validación con las reglas de `ontologia/turismo.shacl.ttl`, que incluyen los axiomas de la ontología (clases disjuntas, propiedades funcionales y dominios). En el panel: bloque *Reglas SHACL* de la pestaña *Validación*. |

Las reglas SHACL también se pueden aplicar sin Fuseki en marcha:

```bash
java -cp C:\apache-jena-fuseki-6.2.0\fuseki-server.jar shacl.shacl validate --shapes ontologia/turismo.shacl.ttl --data ontologia/turismo.rdf --text
```

Si inicias Fuseki de otra forma (un dataset `turismo` vacío al que subes el archivo), el sitio funciona igual, pero el panel avisa de que faltan la inferencia y SHACL.

### Qué afirma la ontología

Además de las clases, las propiedades y su alineación con schema.org, `ontologia/turismo.rdf` declara estos axiomas:

| Axioma | Qué dice | Para qué sirve |
| --- | --- | --- |
| Clases disjuntas (`owl:disjointWith`) | Nada es a la vez actividad, lugar, ciudad o comuna. Tampoco actividad cotidiana y turística, ni establecimiento y naturaleza, ni dos de lago, montaña, río, parque y reserva. | Un individuo con dos tipos incompatibles es una contradicción. |
| Propiedades funcionales (`owl:FunctionalProperty`) | Un solo valor para `t:ubicadoEnCiudad`, `t:ubicadoEnComuna`, `t:perteneceAComuna`, `t:Latitud`, `t:Longitud`, `t:Precio`, `t:requierePermisoAutoridad` y `t:tieneTemporada`. | Dos valores distintos son una contradicción. |
| Individuos distintos (`owl:AllDifferent`) | Las comunas y las ciudades son todas distintas entre sí. | Sin esto, dos comunas para una ciudad se leerían como «son la misma comuna». |
| Propiedad transitiva (`owl:TransitiveProperty`) | `t:ubicadoEn` reúne a `t:ubicadoEnCiudad`, `t:ubicadoEnComuna` y `t:perteneceAComuna`. | El razonador deduce la comuna de un lugar que solo declara su ciudad. |
| Condiciones necesarias (`owl:someValuesFrom`) | Toda actividad se realiza en algún lugar, toda ciudad pertenece a alguna comuna y todo lugar está en alguna comuna. | Dejan escrito en OWL lo que SHACL exige. |
| Dominios | `t:Latitud` y `t:Longitud` son de lugares, ciudades o comunas; `t:Precio`, `t:Calificacion`, `t:requierePermisoAutoridad` y `t:tieneTemporada`, de lugares o actividades. | Una actividad con coordenadas o una comuna con precio son contradicciones. |

La cabecera lleva la versión (`owl:versionInfo`) y las fechas de creación y de última modificación (`dcterms:created`, `dcterms:modified`). El vocabulario (`ontologia/`) y `datos.html` las muestran: al cambiar la ontología, actualiza la versión y la fecha de modificación.

El razonador de Fuseki (OWL Micro) aplica la transitividad, los dominios y las inversas, pero no busca contradicciones. Para eso está HermiT, que viene con Protégé: abre `turismo.rdf` y elige *Reasoner → HermiT → Start reasoner*. Si la ontología se contradice, Protégé lo indica; si no, clasifica las clases.

Lo que bloquea el despliegue son las reglas SHACL, y tres de ellas leen esos mismos axiomas: `f:Disjuntas` (un individuo en dos clases disjuntas), `f:Funcionales` (dos valores en una propiedad funcional) y `f:Dominio` (una propiedad usada por algo que no es de su dominio). No sustituyen a HermiT, que además deduce y comprueba la consistencia completa, pero detienen las contradicciones que estos axiomas hacen posibles sin tener que acordarse de abrir Protégé.

Al añadir una comuna o una ciudad, inclúyela en la lista de individuos distintos (en Protégé, *Different individuals*).

Los nombres y las descripciones llevan su idioma (`xml:lang="es"` en RDF/XML, `"…"@es` en Turtle), para que quien reutilice los datos sepa en qué lengua están. Por eso el rango de `t:Nombre` y `t:Descripcion` es `rdf:PlainLiteral` (texto, con o sin idioma) y no `xsd:string`: con `xsd:string`, un texto con idioma hace inconsistente la ontología. Una regla SHACL avisa si alguno queda sin idioma. El sitio muestra un solo nombre por atracción: si añades el mismo nombre en otro idioma, SHACL avisará de que hay más de uno.

### Sin Fuseki: SPARQL en el navegador

Cada página pregunta primero a Fuseki (`ASK {}`). Si no responde, como ocurre en el sitio publicado en GitHub Pages, las mismas consultas las resuelve un motor SPARQL que corre en el navegador: [Oxigraph](https://github.com/oxigraph/oxigraph) compilado a WebAssembly (1,5 MB comprimido, se descarga solo en ese caso). Carga `datos/turismo.rdf`, el mismo archivo que el sitio ofrece para descargar.

| | Con Fuseki | Sin Fuseki |
| --- | --- | --- |
| Portada, ficha, carta 3D y panel | Consultan `/turismo` | Consultan `datos/turismo.rdf` en el navegador |
| *Con inferencia* (panel) | Consulta `/turismo-inferido` | Consulta `datos/turismo-inferido.ttl`, el grafo que el razonador de Fuseki dedujo al compilar |
| Reglas SHACL (panel) | Las aplica `/turismo/shacl` | Lee `datos/informe-shacl.nt`, el informe que Fuseki dejó al compilar |

El panel indica arriba quién responde: *Fuseki conectado* o *Sin Fuseki · SPARQL en el navegador*.

En desarrollo (`npx vite`) sin Fuseki, el sitio también funciona con `ontologia/turismo.rdf`, pero sin *Con inferencia* ni SHACL: esos dos archivos los escribe Fuseki.

Las respuestas de los dos motores se compararon consulta por consulta y dan las mismas atracciones. Dos diferencias no afectan al sitio: Oxigraph quita los ceros finales de los decimales (`-73.10` pasa a `-73.1`) y el orden dentro de una lista de valores no está definido, así que `js/ontologia.js` las ordena.

## Publicar el sitio

Con Fuseki en marcha, compila:

```bash
npx vite build
```

Además de las páginas, `scripts/publicacion.mjs` deja en `dist/` lo que una máquina puede leer sin ejecutar JavaScript ni consultar Fuseki:

| En `dist/` | Qué es |
| --- | --- |
| `datos/turismo.rdf`, `.ttl`, `.jsonld` | El grafo completo en tres formatos, más `turismo.shacl.ttl`. |
| `datos/turismo-inferido.ttl` | El grafo con lo que deduce el razonador de Fuseki. Lo consulta el panel del sitio publicado. |
| `datos/informe-shacl.nt` | El resultado de validar el grafo con las reglas SHACL. Lo muestra el panel del sitio publicado. |
| `ficha/<id>.html` | Una página por atracción con el texto, el JSON-LD de schema.org y los datos del visor 3D incrustados. |
| `index.html` | La lista de atracciones ya escrita, con enlaces a esas fichas y un `ItemList` en JSON-LD. |
| `datos.html` | La descripción del conjunto de datos (`schema:Dataset`) con sus descargas. |
| `ontologia/index.html` | El vocabulario, con el grafo completo incrustado en JSON-LD. |
| `sitemap.xml` | Las páginas publicadas con su dirección definitiva; cada una lleva además su enlace canónico. |

Los datos se publican con licencia CC BY 4.0, declarada en la ontología (`dcterms:license`), en `datos.html` y en `scripts/publicacion.mjs`; no cubre los modelos 3D.

El sitio compilado se puede servir como archivos estáticos y funciona entero sin Fuseki: las fichas y la lista ya vienen escritas, y los filtros de la portada, la carta 3D y el panel consultan el grafo en el navegador (ver *Sin Fuseki: SPARQL en el navegador*).

Si Fuseki no responde al compilar, la compilación termina igual con un aviso, pero solo publica `turismo.rdf` y las reglas SHACL. Si responde pero no se inició con `fuseki/config.ttl`, avisa de que no puede publicar el grafo con inferencia ni el informe SHACL.

Los modelos de `public/modelos3d/` que ningún individuo usa (y los originales en formatos que el visor no abre, como `.fbx`) no se copian al sitio compilado; la compilación indica cuáles dejó fuera.

Si cambias el marcado donde la compilación escribe (la lista de `index.html`, `<div id="ficha">`, `#descargas`, `#terminos`) y deja de reconocerlo, la compilación falla con un mensaje que dice qué no encontró, en vez de publicar la página incompleta.

### Dirección del sitio e IRIs

El sitio se publica en GitHub Pages, en `https://makusano-hub.github.io/Onto/`. Esa dirección está en `js/catalogo.js` (`SITIO`) y de ella cuelgan los IRIs de la ontología:

```
https://makusano-hub.github.io/Onto/ontologia#FuerteBulnes
```

Al abrir un IRI, el navegador llega al vocabulario (`ontologia/`) y salta a la entrada de ese término. Así los identificadores se pueden consultar, que es lo que pide la web de datos enlazados.

Para publicar en otro dominio hay que cambiar tres cosas a la vez: `SITIO` en `js/catalogo.js`, la base de los IRIs en `ontologia/turismo.rdf` (buscar y reemplazar `https://makusano-hub.github.io/Onto/`) y los prefijos y el patrón de `ontologia/turismo.shacl.ttl`.

### Despliegue en GitHub Pages

`.github/workflows/pages.yml` publica el sitio en cada cambio de la rama `main`: valida la ontología con SHACL, inicia Fuseki con `fuseki/config.ttl`, regenera la copia de respaldo de la carta 3D, compila y sube `dist/`. Si la ontología tiene errores SHACL o la publicación queda incompleta, no se despliega.

En un pull request el mismo flujo valida y compila, pero no publica: un error aparece como comprobación fallida antes de fusionar, en vez de descubrirse cuando el despliegue de `main` ya ha fallado.

Solo hay que activarlo una vez en GitHub: *Settings → Pages → Source → GitHub Actions*.

## Agregar contenido sin tocar el código

1. Modelo 3D: copia el `.glb` a `public/modelos3d/` y añade `t:tieneModelo3D "modelos3d/archivo.glb"`.
2. Imagen: cópiala a `public/imagenes/` y añade `t:tieneImagen "imagenes/archivo.jpg"`.
3. Enlace: `t:tieneEnlace "https://…"` (puede repetirse).
4. Coordenadas: `t:Latitud` y `t:Longitud` en grados decimales. La carta 3D ubica el lugar con ellas; sin coordenadas lo dibuja alrededor de su ciudad o comuna. Una ciudad con coordenadas aparece también en el mapa de la portada.
5. Mismo lugar en otras bases de datos: `owl:sameAs <http://www.wikidata.org/entity/Q…>` y, si Wikidata da su identificador de GeoNames (propiedad P1566), `owl:sameAs <https://sws.geonames.org/…/>`. Cada entidad externa se enlaza con un solo individuo, y solo si es el mismo objeto: una bahía de GeoNames no es el sitio histórico que lleva su nombre.
6. Individuo nuevo: usa la pestaña *Nuevo individuo* del panel, que genera el Turtle con el nombre y la descripción ya marcados como español (`@es`). Pégalo en Protégé y guarda `turismo.rdf`. También genera un `INSERT DATA`, que solo sirve en un Fuseki propio con endpoint de escritura: el de `fuseki/config.ttl` no lo tiene.
7. Reinicia Fuseki (o recarga el dataset `turismo` si lo subes a mano) y revisa la pestaña *Validación*.
8. Si cambiaste `ontologia/turismo.rdf`, regenera la copia de respaldo de la carta 3D con `node scripts/generar-copia.mjs`.

Las clases y propiedades están alineadas con schema.org (`rdfs:subClassOf`, `rdfs:subPropertyOf`). El `@type` del JSON-LD de cada ficha sale de esa alineación: para que una clase nueva tenga tipo, hazla subclase de una clase de `https://schema.org/`.

La bandera y el escudo se leen de `public/identidad/bandera.svg` y `public/identidad/escudo.svg`.
