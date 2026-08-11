const http = require("http");
const url = require("url");

const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;

// =====================================================
// VARIABLES DE ENTORNO
// =====================================================

const VERIFY_TOKEN =
    process.env.META_VERIFY_TOKEN;

const ACCESS_TOKEN =
    process.env.META_ACCESS_TOKEN;

const PHONE_NUMBER_ID =
    process.env.META_PHONE_NUMBER_ID;

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY;

// =====================================================
// SUPABASE
// =====================================================

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
);

console.log(
    "Cliente de Supabase inicializado."
);

// =====================================================
// RESPONDER JSON
// =====================================================

function responderJSON(
    res,
    statusCode,
    data
) {

    res.writeHead(
        statusCode,
        {
            "Content-Type":
                "application/json; charset=utf-8"
        }
    );

    res.end(
        JSON.stringify(data)
    );
}

// =====================================================
// LEER BODY
// =====================================================

function leerBody(req) {

    return new Promise(
        (resolve, reject) => {

            let body = "";

            req.on(
                "data",
                chunk => {

                    body +=
                        chunk.toString();

                }
            );

            req.on(
                "end",
                () => {

                    if (!body) {

                        resolve({});

                        return;
                    }

                    try {

                        resolve(
                            JSON.parse(body)
                        );

                    } catch (error) {

                        reject(
                            new Error(
                                "JSON inválido."
                            )
                        );
                    }
                }
            );

            req.on(
                "error",
                error => {

                    reject(error);

                }
            );
        }
    );
}

// =====================================================
// OBTENER ID TICKET
// =====================================================

function obtenerIdTicket(
    pathname
) {

    const partes =
        pathname
            .split("/")
            .filter(Boolean);

    if (
        partes.length !== 2 ||
        partes[0] !== "tickets"
    ) {

        return null;
    }

    const id =
        Number(partes[1]);

    if (
        !Number.isInteger(id) ||
        id <= 0
    ) {

        return null;
    }

    return id;
}

// =====================================================
// ENVIAR WHATSAPP
// =====================================================

async function enviarWhatsApp(
    to,
    message
) {

    const whatsappUrl =
        `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`;

    const response =
        await fetch(
            whatsappUrl,
            {

                method: "POST",

                headers: {

                    "Authorization":
                        `Bearer ${ACCESS_TOKEN}`,

                    "Content-Type":
                        "application/json"

                },

                body:
                    JSON.stringify({

                        messaging_product:
                            "whatsapp",

                        to:
                            to,

                        type:
                            "text",

                        text: {

                            body:
                                message

                        }

                    })
            }
        );

    const result =
        await response.json();

    console.log(
        "Respuesta de Meta:",
        result
    );

    if (!response.ok) {

        throw new Error(
            result?.error?.message ||
            "Meta rechazó el mensaje."
        );
    }

    return result;
}

// =====================================================
// GUARDAR MENSAJE SALIENTE
// =====================================================

async function guardarMensajeSaliente(
    conversacion,
    mensaje,
    agenteId = null,
    whatsappMessageId = null
) {

    const {
        error: errorMensaje
    } = await supabase
        .from("mensajes")
        .insert({

            cliente_id:
                conversacion.cliente_id,

            conversacion_id:
                conversacion.id,

            whatsapp_message_id:
                whatsappMessageId,

            direccion:
                "saliente",

            tipo:
                "text",

            contenido:
                mensaje,

            estado:
                "enviado"

        });

    if (errorMensaje) {

        throw errorMensaje;

    }

    const {
        error: errorActualizacion
    } = await supabase
        .from("conversaciones")
        .update({

            ultima_interaccion:
                new Date().toISOString()

        })
        .eq(
            "id",
            conversacion.id
        );

    if (errorActualizacion) {

        throw errorActualizacion;

    }

    await registrarHistorial(

        conversacion.id,

        agenteId,

        "mensaje_enviado",

        "Mensaje enviado al cliente por WhatsApp."

    );
}

// =====================================================
// HISTORIAL
// =====================================================

async function registrarHistorial(
    conversacionId,
    agenteId,
    accion,
    detalle
) {

    const {
        error
    } = await supabase
        .from("ticket_historial")
        .insert({

            conversacion_id:
                conversacionId,

            agente_id:
                agenteId || null,

            accion:
                accion,

            detalle:
                detalle

        });

    if (error) {

        throw error;

    }
}

// =====================================================
// OBTENER AGENTE
// =====================================================

async function obtenerAgente(
    agenteId
) {

    const {
        data,
        error
    } = await supabase
        .from("agentes")
        .select("*")
        .eq(
            "id",
            agenteId
        )
        .maybeSingle();

    if (error) {

        throw error;

    }

    return data;
}

// =====================================================
// OBTENER TICKET COMPLETO
// =====================================================

async function obtenerTicketCompleto(
    conversacionId
) {

    // -------------------------------------------------
    // TICKET
    // -------------------------------------------------

    const {
        data: ticket,
        error: errorTicket
    } = await supabase
        .from("conversaciones")
        .select("*")
        .eq(
            "id",
            conversacionId
        )
        .single();

    if (errorTicket) {

        throw errorTicket;

    }

    if (!ticket) {

        throw new Error(
            "Ticket no encontrado."
        );

    }

    // -------------------------------------------------
    // CLIENTE
    // -------------------------------------------------

    const {
        data: cliente,
        error: errorCliente
    } = await supabase
        .from("clientes")
        .select("*")
        .eq(
            "id",
            ticket.cliente_id
        )
        .maybeSingle();

    if (errorCliente) {

        throw errorCliente;

    }

    // -------------------------------------------------
    // AGENTE
    // -------------------------------------------------

    let agente = null;

    if (ticket.agente_id) {

        agente =
            await obtenerAgente(
                ticket.agente_id
            );
    }

    // -------------------------------------------------
    // MENSAJES
    // -------------------------------------------------

    const {
        data: mensajes,
        error: errorMensajes
    } = await supabase
        .from("mensajes")
        .select("*")
        .eq(
            "conversacion_id",
            conversacionId
        )
        .order(
            "id",
            {
                ascending: true
            }
        );

    if (errorMensajes) {

        throw errorMensajes;

    }

    // -------------------------------------------------
    // HISTORIAL
    // -------------------------------------------------

    const {
        data: historial,
        error: errorHistorial
    } = await supabase
        .from("ticket_historial")
        .select("*")
        .eq(
            "conversacion_id",
            conversacionId
        )
        .order(
            "id",
            {
                ascending: true
            }
        );

    if (errorHistorial) {

        throw errorHistorial;

    }

    return {

        ...ticket,

        cliente:
            cliente || null,

        agente:
            agente || null,

        mensajes:
            mensajes || [],

        historial:
            historial || []

    };
}

// =====================================================
// SERVIDOR
// =====================================================

const server =
    http.createServer(
        async (
            req,
            res
        ) => {

            const parsedUrl =
                url.parse(
                    req.url,
                    true
                );

            const pathname =
                parsedUrl.pathname;

            // =================================================
            // HEALTH
            // =================================================

            if (
                req.method === "GET" &&
                pathname === "/health"
            ) {

                try {

                    const {
                        error
                    } = await supabase
                        .from("agentes")
                        .select("id")
                        .limit(1);

                    if (error) {

                        responderJSON(
                            res,
                            200,
                            {

                                servidor:
                                    "OK",

                                supabase:
                                    "ERROR",

                                estado:
                                    "DEGRADED",

                                error:
                                    error.message

                            }
                        );

                        return;
                    }

                    responderJSON(
                        res,
                        200,
                        {

                            servidor:
                                "OK",

                            supabase:
                                "OK",

                            estado:
                                "ONLINE"

                        }
                    );

                } catch (error) {

                    responderJSON(
                        res,
                        500,
                        {

                            servidor:
                                "OK",

                            supabase:
                                "ERROR",

                            estado:
                                "ERROR",

                            error:
                                error.message

                        }
                    );
                }

                return;
            }

            // =================================================
            // VERIFICACIÓN META
            // =================================================

            if (
                req.method === "GET" &&
                pathname === "/webhook"
            ) {

                const mode =
                    parsedUrl.query[
                        "hub.mode"
                    ];

                const token =
                    parsedUrl.query[
                        "hub.verify_token"
                    ];

                const challenge =
                    parsedUrl.query[
                        "hub.challenge"
                    ];

                if (
                    mode === "subscribe" &&
                    token === VERIFY_TOKEN
                ) {

                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                "text/plain"
                        }
                    );

                    res.end(
                        challenge
                    );

                } else {

                    res.writeHead(
                        403,
                        {
                            "Content-Type":
                                "text/plain"
                        }
                    );

                    res.end(
                        "Forbidden"
                    );
                }

                return;
            }

            // =================================================
            // WEBHOOK WHATSAPP
            // =================================================

            if (
                req.method === "POST" &&
                pathname === "/webhook"
            ) {

                try {

                    const data =
                        await leerBody(req);

                    console.log(
                        "========================================="
                    );

                    console.log(
                        "WEBHOOK DE WHATSAPP RECIBIDO"
                    );

                    console.log(
                        JSON.stringify(
                            data,
                            null,
                            2
                        )
                    );

                    const entries =
                        data.entry || [];

                    for (
                        const entry of entries
                    ) {

                        const changes =
                            entry.changes || [];

                        for (
                            const change of changes
                        ) {

                            const value =
                                change.value;

                            if (!value) {
                                continue;
                            }

                            const messages =
                                value.messages || [];

                            for (
                                const message of messages
                            ) {

                                const whatsappMessageId =
                                    message.id ||
                                    null;

                                const telefono =
                                    message.from ||
                                    null;

                                const tipo =
                                    message.type ||
                                    "unknown";

                                let contenido =
                                    null;

                                if (
                                    message.type === "text" &&
                                    message.text
                                ) {

                                    contenido =
                                        message.text.body;

                                } else {

                                    contenido =
                                        `[Mensaje de tipo ${tipo}]`;

                                }

                                if (!telefono) {
                                    continue;
                                }

                                // -----------------------------------------
                                // EVITAR DUPLICADOS
                                // -----------------------------------------

                                if (
                                    whatsappMessageId
                                ) {

                                    const {
                                        data: existente,
                                        error
                                    } = await supabase
                                        .from("mensajes")
                                        .select("id")
                                        .eq(
                                            "whatsapp_message_id",
                                            whatsappMessageId
                                        )
                                        .maybeSingle();

                                    if (error) {
                                        throw error;
                                    }

                                    if (existente) {

                                        console.log(
                                            "Mensaje duplicado ignorado."
                                        );

                                        continue;
                                    }
                                }

                                // -----------------------------------------
                                // BUSCAR CLIENTE
                                // -----------------------------------------

                                let cliente = null;

                                const {
                                    data: clienteExistente,
                                    error: errorCliente
                                } = await supabase
                                    .from("clientes")
                                    .select("*")
                                    .eq(
                                        "telefono",
                                        telefono
                                    )
                                    .maybeSingle();

                                if (errorCliente) {
                                    throw errorCliente;
                                }

                                if (
                                    clienteExistente
                                ) {

                                    cliente =
                                        clienteExistente;

                                } else {

                                    const nombre =
                                        value
                                            .contacts?.[0]
                                            ?.profile
                                            ?.name ||
                                        telefono;

                                    const {
                                        data: nuevoCliente,
                                        error
                                    } = await supabase
                                        .from("clientes")
                                        .insert({

                                            telefono:
                                                telefono,

                                            nombre:
                                                nombre,

                                            activo:
                                                true,

                                            baja_comunicaciones:
                                                false

                                        })
                                        .select()
                                        .single();

                                    if (error) {
                                        throw error;
                                    }

                                    cliente =
                                        nuevoCliente;
                                }

                                // =================================================
                                // CALIFICACIÓN
                                // =================================================

                                const texto =
                                    String(
                                        contenido || ""
                                    ).trim();

                                const esCalificacion =
                                    tipo === "text" &&
                                    /^[1-5]$/.test(
                                        texto
                                    );

                                if (
                                    esCalificacion
                                ) {

                                    const {
                                        data: ultimaConversacion,
                                        error
                                    } = await supabase
                                        .from("conversaciones")
                                        .select("*")
                                        .eq(
                                            "cliente_id",
                                            cliente.id
                                        )
                                        .eq(
                                            "estado",
                                            "cerrada"
                                        )
                                        .order(
                                            "creado_en",
                                            {
                                                ascending:
                                                    false
                                            }
                                        )
                                        .limit(1)
                                        .maybeSingle();

                                    if (error) {
                                        throw error;
                                    }

                                    if (
                                        ultimaConversacion
                                    ) {

                                        // -----------------------------------------
                                        // GUARDAR RESPUESTA DEL CLIENTE
                                        // -----------------------------------------

                                        const {
                                            error: errorMensaje
                                        } = await supabase
                                            .from("mensajes")
                                            .insert({

                                                cliente_id:
                                                    cliente.id,

                                                conversacion_id:
                                                    ultimaConversacion.id,

                                                whatsapp_message_id:
                                                    whatsappMessageId,

                                                direccion:
                                                    "entrante",

                                                tipo:
                                                    tipo,

                                                contenido:
                                                    contenido,

                                                estado:
                                                    "recibido"

                                            });

                                        if (errorMensaje) {
                                            throw errorMensaje;
                                        }

                                        // -----------------------------------------
                                        // GUARDAR CALIFICACIÓN
                                        // -----------------------------------------

                                        const {
                                            error: errorCalificacion
                                        } = await supabase
                                            .from("conversaciones")
                                            .update({

                                                calificacion:
                                                    Number(
                                                        texto
                                                    ),

                                                calificado_en:
                                                    new Date()
                                                        .toISOString()

                                            })
                                            .eq(
                                                "id",
                                                ultimaConversacion.id
                                            );

                                        if (errorCalificacion) {
                                            throw errorCalificacion;
                                        }

                                        // -----------------------------------------
                                        // HISTORIAL
                                        // -----------------------------------------

                                        await registrarHistorial(

                                            ultimaConversacion.id,

                                            ultimaConversacion.agente_id ||
                                            null,

                                            "ticket_calificado",

                                            `El cliente calificó la atención con ${texto}/5.`

                                        );

                                        // -----------------------------------------
                                        // AGRADECIMIENTO
                                        // -----------------------------------------

                                        const mensajeGracias =
                                            `⭐ Gracias por calificar la atención del ticket #${ultimaConversacion.numero_ticket}.\n\nTu valoración fue registrada correctamente.\n\n¡Gracias por confiar en TR Soporte!`;

                                        const resultado =
                                            await enviarWhatsApp(
                                                telefono,
                                                mensajeGracias
                                            );

                                        const mensajeId =
                                            resultado
                                                ?.messages?.[0]?.id ||
                                            null;

                                        await guardarMensajeSaliente(

                                            ultimaConversacion,

                                            mensajeGracias,

                                            ultimaConversacion.agente_id ||
                                            null,

                                            mensajeId

                                        );

                                        console.log(
                                            `Calificación ${texto}/5 registrada para #${ultimaConversacion.numero_ticket}.`
                                        );

                                        continue;
                                    }
                                }

                                // =================================================
                                // BUSCAR TICKET ABIERTO
                                // =================================================

                                const {
                                    data: conversacionesAbiertas,
                                    error: errorConversaciones
                                } = await supabase
                                    .from("conversaciones")
                                    .select("*")
                                    .eq(
                                        "cliente_id",
                                        cliente.id
                                    )
                                    .eq(
                                        "estado",
                                        "abierta"
                                    )
                                    .order(
                                        "ultima_interaccion",
                                        {
                                            ascending:
                                                false
                                        }
                                    )
                                    .limit(1);

                                if (errorConversaciones) {
                                    throw errorConversaciones;
                                }

                                let conversacion =
                                    null;

                                let ticketCreado =
                                    false;

                                if (
                                    conversacionesAbiertas &&
                                    conversacionesAbiertas.length
                                ) {

                                    conversacion =
                                        conversacionesAbiertas[0];

                                } else {

                                    const {
                                        data: nuevaConversacion,
                                        error
                                    } = await supabase
                                        .from("conversaciones")
                                        .insert({

                                            cliente_id:
                                                cliente.id,

                                            estado:
                                                "abierta",

                                            ultima_interaccion:
                                                new Date()
                                                    .toISOString()

                                        })
                                        .select()
                                        .single();

                                    if (error) {
                                        throw error;
                                    }

                                    conversacion =
                                        nuevaConversacion;

                                    ticketCreado =
                                        true;
                                }

                                // =================================================
                                // CONTAR MENSAJES ENTRANTES
                                // =================================================

                                const {
                                    count,
                                    error: errorConteo
                                } = await supabase
                                    .from("mensajes")
                                    .select(
                                        "id",
                                        {
                                            count:
                                                "exact",
                                            head:
                                                true
                                        }
                                    )
                                    .eq(
                                        "conversacion_id",
                                        conversacion.id
                                    )
                                    .eq(
                                        "direccion",
                                        "entrante"
                                    );

                                if (errorConteo) {
                                    throw errorConteo;
                                }

                                const numeroMensaje =
                                    (
                                        count || 0
                                    ) + 1;

                                // =================================================
                                // GUARDAR MENSAJE ENTRANTE
                                // =================================================

                                const {
                                    error: errorMensaje
                                } = await supabase
                                    .from("mensajes")
                                    .insert({

                                        cliente_id:
                                            cliente.id,

                                        conversacion_id:
                                            conversacion.id,

                                        whatsapp_message_id:
                                            whatsappMessageId,

                                        direccion:
                                            "entrante",

                                        tipo:
                                            tipo,

                                        contenido:
                                            contenido,

                                        estado:
                                            "recibido"

                                    });

                                if (errorMensaje) {
                                    throw errorMensaje;
                                }

                                // =================================================
                                // ACTUALIZAR INTERACCIÓN
                                // =================================================

                                await supabase
                                    .from("conversaciones")
                                    .update({

                                        ultima_interaccion:
                                            new Date()
                                                .toISOString()

                                    })
                                    .eq(
                                        "id",
                                        conversacion.id
                                    );

                                // =================================================
                                // HISTORIAL
                                // =================================================

                                if (
                                    ticketCreado
                                ) {

                                    await registrarHistorial(

                                        conversacion.id,

                                        null,

                                        "ticket_creado",

                                        "Ticket creado automáticamente desde WhatsApp."

                                    );

                                } else {

                                    await registrarHistorial(

                                        conversacion.id,

                                        conversacion.agente_id ||
                                        null,

                                        "mensaje_recibido",

                                        "El cliente envió un nuevo mensaje por WhatsApp."

                                    );
                                }

                                // =================================================
                                // RESPUESTAS AUTOMÁTICAS
                                // =================================================

                                let respuestaAutomatica =
                                    null;

                                if (
                                    numeroMensaje === 1
                                ) {

                                    respuestaAutomatica =
                                        "Hola 👋 Gracias por comunicarte con TR Soporte.\n\nRecibimos tu mensaje correctamente.\n\nMientras tanto, contanos brevemente cuál es el problema que estás teniendo para que podamos ayudarte mejor. 🛠️";

                                } else if (
                                    numeroMensaje === 2
                                ) {

                                    respuestaAutomatica =
                                        `📋 Tu número de caso es #${conversacion.numero_ticket}.\n\nGracias por la información. Un agente de soporte revisará tu solicitud y se comunicará con vos.\n\nPor favor, aguardá el contacto del agente.`;
                                }

                                // =================================================
                                // ENVIAR RESPUESTA AUTOMÁTICA
                                // =================================================

                                if (
                                    respuestaAutomatica
                                ) {

                                    const resultado =
                                        await enviarWhatsApp(

                                            telefono,

                                            respuestaAutomatica

                                        );

                                    const respuestaId =
                                        resultado
                                            ?.messages?.[0]?.id ||
                                        null;

                                    await guardarMensajeSaliente(

                                        conversacion,

                                        respuestaAutomatica,

                                        null,

                                        respuestaId

                                    );
                                }
                            }
                        }
                    }

                    responderJSON(
                        res,
                        200,
                        {
                            success:
                                true
                        }
                    );

                } catch (error) {

                    console.error(
                        "ERROR PROCESANDO WEBHOOK"
                    );

                    console.error(error);

                    responderJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            error:
                                error.message

                        }
                    );
                }

                return;
            }

            // =================================================
            // LISTAR AGENTES
            // =================================================

            if (
                req.method === "GET" &&
                pathname === "/agentes"
            ) {

                try {

                    const {
                        data,
                        error
                    } = await supabase
                        .from("agentes")
                        .select("*")
                        .order(
                            "nombre",
                            {
                                ascending:
                                    true
                            }
                        );

                    if (error) {
                        throw error;
                    }

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            agentes:
                                data || []

                        }
                    );

                } catch (error) {

                    responderJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            error:
                                error.message

                        }
                    );
                }

                return;
            }

            // =================================================
            // LISTAR TICKETS
            // =================================================

            if (
                req.method === "GET" &&
                pathname === "/tickets"
            ) {

                try {

                    const {
                        data: conversaciones,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .select("*")
                        .order(
                            "ultima_interaccion",
                            {
                                ascending:
                                    false
                            }
                        );

                    if (error) {
                        throw error;
                    }

                    const tickets = [];

                    for (
                        const conversacion
                        of conversaciones || []
                    ) {

                        // -----------------------------------------
                        // CLIENTE
                        // -----------------------------------------

                        const {
                            data: cliente,
                            error: errorCliente
                        } = await supabase
                            .from("clientes")
                            .select("*")
                            .eq(
                                "id",
                                conversacion.cliente_id
                            )
                            .maybeSingle();

                        if (errorCliente) {
                            throw errorCliente;
                        }

                        // -----------------------------------------
                        // AGENTE
                        // -----------------------------------------

                        let agente =
                            null;

                        if (
                            conversacion.agente_id
                        ) {

                            agente =
                                await obtenerAgente(
                                    conversacion.agente_id
                                );
                        }

                        // -----------------------------------------
                        // OBJETO TICKET
                        // -----------------------------------------

                        tickets.push({

                            id:
                                conversacion.id,

                            numero_ticket:
                                conversacion.numero_ticket,

                            estado:
                                conversacion.estado,

                            prioridad:
                                conversacion.prioridad,

                            categoria:
                                conversacion.categoria,

                            calificacion:
                                conversacion.calificacion,

                            calificado_en:
                                conversacion.calificado_en,

                            ultima_interaccion:
                                conversacion.ultima_interaccion,

                            creado_en:
                                conversacion.creado_en,

                            cerrado_en:
                                conversacion.cerrado_en,

                            cliente_id:
                                conversacion.cliente_id,

                            cliente_nombre:
                                cliente?.nombre ||
                                null,

                            cliente_telefono:
                                cliente?.telefono ||
                                null,

                            cliente_empresa:
                                cliente?.empresa ||
                                null,

                            agente_id:
                                conversacion.agente_id ||
                                null,

                            agente_nombre:
                                agente?.nombre ||
                                null,

                            cliente:
                                cliente ||
                                null,

                            agente:
                                agente ||
                                null

                        });
                    }

                    // =================================================
                    // BUSCADOR
                    // =================================================

                    const buscar =
                        String(
                            parsedUrl.query.buscar ||
                            ""
                        )
                        .trim()
                        .toLowerCase();

                    let resultado =
                        tickets;

                    if (
                        buscar
                    ) {

                        resultado =
                            tickets.filter(
                                ticket => {

                                    const numero =
                                        String(
                                            ticket.numero_ticket ||
                                            ""
                                        )
                                        .toLowerCase();

                                    const nombre =
                                        String(
                                            ticket.cliente?.nombre ||
                                            ""
                                        )
                                        .toLowerCase();

                                    const telefono =
                                        String(
                                            ticket.cliente?.telefono ||
                                            ""
                                        )
                                        .toLowerCase();

                                    const empresa =
                                        String(
                                            ticket.cliente?.empresa ||
                                            ""
                                        )
                                        .toLowerCase();

                                    const estado =
                                        String(
                                            ticket.estado ||
                                            ""
                                        )
                                        .toLowerCase();

                                    const agente =
                                        String(
                                            ticket.agente?.nombre ||
                                            ""
                                        )
                                        .toLowerCase();

                                    return (

                                        numero.includes(
                                            buscar
                                        ) ||

                                        nombre.includes(
                                            buscar
                                        ) ||

                                        telefono.includes(
                                            buscar
                                        ) ||

                                        empresa.includes(
                                            buscar
                                        ) ||

                                        estado.includes(
                                            buscar
                                        ) ||

                                        agente.includes(
                                            buscar
                                        )

                                    );
                                }
                            );
                    }

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            buscar:
                                buscar,

                            total:
                                resultado.length,

                            tickets:
                                resultado

                        }
                    );

                } catch (error) {

                    responderJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            error:
                                error.message

                        }
                    );
                }

                return;
            }

            // =================================================
            // OBTENER TICKET COMPLETO
            // =================================================

            if (
                req.method === "GET" &&
                pathname.startsWith("/tickets/")
            ) {

                const id =
                    obtenerIdTicket(
                        pathname
                    );

                if (!id) {

                    responderJSON(
                        res,
                        400,
                        {

                            success:
                                false,

                            error:
                                "ID de ticket inválido."

                        }
                    );

                    return;
                }

                try {

                    const ticket =
                        await obtenerTicketCompleto(
                            id
                        );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket:
                                ticket,

                            mensajes:
                                ticket.mensajes,

                            historial:
                                ticket.historial

                        }
                    );

                } catch (error) {

                    responderJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            error:
                                error.message

                        }
                    );
                }

                return;
            }

            // =================================================
            // ASIGNAR TICKET
            // =================================================

            if (
                req.method === "POST" &&
                pathname.startsWith("/tickets/") &&
                pathname.endsWith("/assign")
            ) {

                try {

                    const partes =
                        pathname
                            .split("/")
                            .filter(Boolean);

                    const id =
                        Number(
                            partes[1]
                        );

                    const data =
                        await leerBody(req);

                    const agenteId =
                        data.agente_id;

                    if (
                        !Number.isInteger(id) ||
                        id <= 0
                    ) {

                        throw new Error(
                            "ID de ticket inválido."
                        );
                    }

                    if (
                        agenteId === undefined
                    ) {

                        throw new Error(
                            "Falta agente_id."
                        );
                    }

                    let agente =
                        null;

                    if (
                        agenteId !== null
                    ) {

                        agente =
                            await obtenerAgente(
                                agenteId
                            );

                        if (!agente) {

                            throw new Error(
                                "El agente no existe."
                            );
                        }
                    }

                    const {
                        data: ticket,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            agente_id:
                                agenteId

                        })
                        .eq(
                            "id",
                            id
                        )
                        .select()
                        .single();

                    if (error) {
                        throw error;
                    }

                    await registrarHistorial(

                        id,

                        agenteId,

                        agenteId === null
                            ? "ticket_desasignado"
                            : "ticket_asignado",

                        agenteId === null
                            ? "Ticket desasignado."
                            : `Ticket asignado a ${agente.nombre}.`

                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket:
                                ticket,

                            agente:
                                agente

                        }
                    );

                } catch (error) {

                    responderJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            error:
                                error.message

                        }
                    );
                }

                return;
            }

            // =================================================
            // CAMBIAR ESTADO
            // =================================================

            if (
                req.method === "POST" &&
                pathname.startsWith("/tickets/") &&
                pathname.endsWith("/status")
            ) {

                try {

                    const partes =
                        pathname
                            .split("/")
                            .filter(Boolean);

                    const id =
                        Number(
                            partes[1]
                        );

                    const data =
                        await leerBody(req);

                    const estado =
                        data.estado;

                    const agenteId =
                        data.agente_id ||
                        null;

                    const estadosPermitidos =
                        [
                            "abierta",
                            "en_proceso",
                            "en_espera",
                            "resuelta",
                            "cerrada"
                        ];

                    if (
                        !estadosPermitidos.includes(
                            estado
                        )
                    ) {

                        throw new Error(
                            "Estado no válido."
                        );
                    }

                    const campos = {

                        estado:
                            estado

                    };

                    if (
                        estado === "cerrada"
                    ) {

                        campos.cerrado_en =
                            new Date()
                                .toISOString();

                    } else {

                        campos.cerrado_en =
                            null;
                    }

                    const {
                        data: ticket,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update(
                            campos
                        )
                        .eq(
                            "id",
                            id
                        )
                        .select()
                        .single();

                    if (error) {
                        throw error;
                    }

                    await registrarHistorial(

                        id,

                        agenteId,

                        "estado_cambiado",

                        `Estado del ticket cambiado a "${estado}".`

                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket:
                                ticket

                        }
                    );

                } catch (error) {

                    responderJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            error:
                                error.message

                        }
                    );
                }

                return;
            }

            // =================================================
            // CAMBIAR PRIORIDAD
            // =================================================

            if (
                req.method === "POST" &&
                pathname.startsWith("/tickets/") &&
                pathname.endsWith("/priority")
            ) {

                try {

                    const partes =
                        pathname
                            .split("/")
                            .filter(Boolean);

                    const id =
                        Number(
                            partes[1]
                        );

                    const data =
                        await leerBody(req);

                    const prioridad =
                        data.prioridad;

                    const agenteId =
                        data.agente_id ||
                        null;

                    const prioridades =
                        [
                            "baja",
                            "normal",
                            "alta",
                            "urgente"
                        ];

                    if (
                        !prioridades.includes(
                            prioridad
                        )
                    ) {

                        throw new Error(
                            "Prioridad no válida."
                        );
                    }

                    const {
                        data: ticket,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            prioridad:
                                prioridad

                        })
                        .eq(
                            "id",
                            id
                        )
                        .select()
                        .single();

                    if (error) {
                        throw error;
                    }

                    await registrarHistorial(

                        id,

                        agenteId,

                        "prioridad_cambiada",

                        `Prioridad cambiada a "${prioridad}".`

                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket:
                                ticket

                        }
                    );

                } catch (error) {

                    responderJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            error:
                                error.message

                        }
                    );
                }

                return;
            }

            // =================================================
            // CAMBIAR CATEGORÍA
            // =================================================

            if (
                req.method === "POST" &&
                pathname.startsWith("/tickets/") &&
                pathname.endsWith("/category")
            ) {

                try {

                    const partes =
                        pathname
                            .split("/")
                            .filter(Boolean);

                    const id =
                        Number(
                            partes[1]
                        );

                    const data =
                        await leerBody(req);

                    const categoria =
                        data.categoria;

                    const agenteId =
                        data.agente_id ||
                        null;

                    const {
                        data: ticket,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            categoria:
                                categoria ||
                                null

                        })
                        .eq(
                            "id",
                            id
                        )
                        .select()
                        .single();

                    if (error) {
                        throw error;
                    }

                    await registrarHistorial(

                        id,

                        agenteId,

                        "categoria_cambiada",

                        categoria
                            ? `Categoría cambiada a "${categoria}".`
                            : "Categoría eliminada."

                    );

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket:
                                ticket

                        }
                    );

                } catch (error) {

                    responderJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            error:
                                error.message

                        }
                    );
                }

                return;
            }

            // =================================================
            // CERRAR TICKET
            // =================================================

            if (
                req.method === "POST" &&
                pathname.startsWith("/tickets/") &&
                pathname.endsWith("/close")
            ) {

                try {

                    const partes =
                        pathname
                            .split("/")
                            .filter(Boolean);

                    const id =
                        Number(
                            partes[1]
                        );

                    if (
                        !Number.isInteger(id) ||
                        id <= 0
                    ) {

                        throw new Error(
                            "ID de ticket inválido."
                        );
                    }

                    const data =
                        await leerBody(req);

                    const agenteId =
                        data.agente_id ||
                        null;

                    // -----------------------------------------
                    // CERRAR
                    // -----------------------------------------

                    const {
                        data: ticket,
                        error
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            estado:
                                "cerrada",

                            cerrado_en:
                                new Date()
                                    .toISOString()

                        })
                        .eq(
                            "id",
                            id
                        )
                        .select()
                        .single();

                    if (error) {
                        throw error;
                    }

                    // -----------------------------------------
                    // HISTORIAL
                    // -----------------------------------------

                    await registrarHistorial(

                        id,

                        agenteId,

                        "ticket_cerrado",

                        "Ticket cerrado por el agente."

                    );

                    // -----------------------------------------
                    // BUSCAR CLIENTE
                    // -----------------------------------------

                    const {
                        data: cliente,
                        error: errorCliente
                    } = await supabase
                        .from("clientes")
                        .select("*")
                        .eq(
                            "id",
                            ticket.cliente_id
                        )
                        .single();

                    if (errorCliente) {
                        throw errorCliente;
                    }

                    // -----------------------------------------
                    // MENSAJE WHATSAPP
                    // -----------------------------------------

                    if (
                        cliente &&
                        cliente.telefono
                    ) {

                        const mensaje =
                            `📋 Tu ticket #${ticket.numero_ticket} fue cerrado correctamente.\n\nEsperamos haber podido ayudarte.\n\n⭐ ¿Cómo calificarías la atención recibida?\n\nRespondé con un número del 1 al 5:\n\n1️⃣ Muy mala\n2️⃣ Mala\n3️⃣ Regular\n4️⃣ Buena\n5️⃣ Excelente`;

                        const resultado =
                            await enviarWhatsApp(

                                cliente.telefono,

                                mensaje

                            );

                        const whatsappId =
                            resultado
                                ?.messages?.[0]?.id ||
                            null;

                        await guardarMensajeSaliente(

                            ticket,

                            mensaje,

                            agenteId,

                            whatsappId

                        );
                    }

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            ticket:
                                ticket,

                            mensaje_cliente:
                                "Ticket cerrado y mensaje enviado."

                        }
                    );

                } catch (error) {

                    console.error(
                        "Error cerrando ticket:"
                    );

                    console.error(error);

                    responderJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            error:
                                error.message

                        }
                    );
                }

                return;
            }

            // =================================================
            // ENVIAR MENSAJE MANUAL
            // =================================================

            if (
                req.method === "POST" &&
                pathname === "/send-message"
            ) {

                try {

                    const data =
                        await leerBody(req);

                    const to =
                        data.to;

                    const message =
                        data.message;

                    const conversacionId =
                        data.conversacion_id;

                    const agenteId =
                        data.agente_id ||
                        null;

                    if (
                        !to ||
                        !message
                    ) {

                        responderJSON(
                            res,
                            400,
                            {

                                success:
                                    false,

                                error:
                                    "Faltan los campos 'to' y 'message'."

                            }
                        );

                        return;
                    }

                    const result =
                        await enviarWhatsApp(

                            to,

                            message

                        );

                    if (
                        conversacionId
                    ) {

                        const {
                            data: conversacion,
                            error
                        } = await supabase
                            .from("conversaciones")
                            .select("*")
                            .eq(
                                "id",
                                conversacionId
                            )
                            .single();

                        if (error) {
                            throw error;
                        }

                        const whatsappMessageId =
                            result
                                ?.messages?.[0]?.id ||
                            null;

                        await guardarMensajeSaliente(

                            conversacion,

                            message,

                            agenteId,

                            whatsappMessageId

                        );
                    }

                    responderJSON(
                        res,
                        200,
                        {

                            success:
                                true,

                            whatsapp:
                                result

                        }
                    );

                } catch (error) {

                    console.error(
                        "Error enviando mensaje:"
                    );

                    console.error(error);

                    responderJSON(
                        res,
                        500,
                        {

                            success:
                                false,

                            error:
                                error.message

                        }
                    );
                }

                return;
            }

            // =================================================
            // RUTA RAÍZ
            // =================================================

            if (
                req.method === "GET" &&
                pathname === "/"
            ) {

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "text/plain; charset=utf-8"
                    }
                );

                res.end(
                    "TR Soporte - WhatsApp Webhook funcionando."
                );

                return;
            }

            // =================================================
            // NO ENCONTRADO
            // =================================================

            responderJSON(
                res,
                404,
                {

                    success:
                        false,

                    error:
                        "Ruta no encontrada."

                }
            );
        }
    );

// =====================================================
// INICIAR SERVIDOR
// =====================================================

server.listen(
    PORT,
    () => {

        console.log(
            `Servidor iniciado en el puerto ${PORT}`
        );

    }
);
