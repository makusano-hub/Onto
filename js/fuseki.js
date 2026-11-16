// Vite reenvía esta ruta a Fuseki (ver vite.config.mjs)
export const ENDPOINT = "/fuseki/turismo/query";

// Solo existen si Fuseki se inicia con fuseki/config.ttl:
// los mismos datos más lo que deduce el razonador, y la validación con SHACL
export const ENDPOINT_INFERIDO = "/fuseki/turismo-inferido/query";
export const ENDPOINT_SHACL = "/fuseki/turismo/shacl";

// Respuesta completa: variables, filas con su tipo (uri / literal) y tiempo que tardó
export async function consultarSPARQLDetallado(consulta, endpoint = ENDPOINT) {
    const inicio = performance.now();
    const parametros = new URLSearchParams({ query: consulta });

    const respuesta = await fetch(`${endpoint}?${parametros.toString()}`, {
        headers: { Accept: "application/sparql-results+json" }
    });

    if (!respuesta.ok) {
        // Fuseki explica los errores de sintaxis en el cuerpo de la respuesta
        const detalle = (await respuesta.text()).trim();
        const error = new Error(`Error en Fuseki: ${respuesta.status}`);
        error.detalle = detalle;
        error.estado = respuesta.status;
        throw error;
    }

    const datos = await respuesta.json();

    return {
        variables: datos.head?.vars ?? [],
        filas: datos.results?.bindings ?? [],
        booleano: datos.boolean,
        ms: Math.round(performance.now() - inicio)
    };
}

// Filas simplificadas a { variable: valor }
export async function consultarSPARQL(consulta) {
    const { filas } = await consultarSPARQLDetallado(consulta);

    return filas.map(fila => {
        const objeto = {};

        for (const variable in fila) {
            objeto[variable] = fila[variable].value;
        }

        return objeto;
    });
}
