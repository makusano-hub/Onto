
// Vite reenvía esta ruta a Fuseki (ver vite.config.mjs)
const ENDPOINT = "/fuseki/turismo/query";

export async function consultarSPARQL(consulta) {
    const parametros = new URLSearchParams({
        query: consulta
    });

    const respuesta = await fetch(
        `${ENDPOINT}?${parametros.toString()}`,
        {
            headers: {
                Accept: "application/sparql-results+json"
            }
        }
    );

    if (!respuesta.ok) {
        throw new Error(
            `Error en Fuseki: ${respuesta.status}`
        );
    }

    const datos = await respuesta.json();

    return datos.results.bindings.map(fila => {
        const objeto = {};

        for (const variable in fila) {
            objeto[variable] = fila[variable].value;
        }

        return objeto;
    });
}
