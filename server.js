const http = require("http");
const url = require("url");

const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;

// =====================================================
// VARIABLES DE ENTORNO
// =====================================================

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

// =====================================================
// SUPABASE
// =====================================================

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
);

console.log("Cliente de Supabase inicializado.");

// =====================================================
// SERVIDOR
// =====================================================

const server = http.createServer(async (req, res) => {

    const parsedUrl = url.parse(req.url, true);

    // =================================================
    // HEALTH CHECK
    // =================================================

    if (
        req.method === "GET" &&
        parsedUrl.pathname === "/health"
    ) {

        try {

            const { error } = await supabase
                .from("agentes")
                .select("id")
                .limit(1);

            if (error) {

                res.writeHead(200, {
                    "Content-Type": "application/json"
                });

                res.end(
                    JSON.stringify({
                        servidor: "OK",
                        supabase: "ERROR",
                        estado: "DEGRADED",
                        error: error.message
                    })
                );

                return;
            }

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(
                JSON.stringify({
                    servidor: "OK",
                    supabase: "OK",
                    estado: "ONLINE"
                })
            );

        } catch (error) {

            res.writeHead(500, {
                "Content-Type": "application/json"
            });

            res.end(
                JSON.stringify({
                    servidor: "OK",
                    supabase: "ERROR",
                    estado: "ERROR",
                    error: error.message
                })
            );
        }

        return;
    }

    // =================================================
    // VERIFICACIÓN DEL WEBHOOK DE META
    // =================================================

    if (
        req.method === "GET" &&
        parsedUrl.pathname === "/webhook"
    ) {

        const mode =
            parsedUrl.query["hub.mode"];

        const token =
            parsedUrl.query["hub.verify_token"];

        const challenge =
            parsedUrl.query["hub.challenge"];

        console.log("Solicitud de verificación de Meta.");

        if (
            mode === "subscribe" &&
            token === VERIFY_TOKEN
        ) {

            console.log("Webhook de Meta verificado correctamente.");

            res.writeHead(200, {
                "Content-Type": "text/plain"
            });

            res.end(challenge);

        } else {

            console.log("Token de verificación incorrecto.");

            res.writeHead(403, {
                "Content-Type": "text/plain"
            });

            res.end("Forbidden");
        }

        return;
    }

    // =================================================
    // RECIBIR WEBHOOK DE WHATSAPP
    // =================================================

    if (
        req.method === "POST" &&
        parsedUrl.pathname === "/webhook"
    ) {

        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();
        });

        req.on("end", async () => {

            try {

                const data = JSON.parse(body);

                console.log("");
                console.log("=========================================");
                console.log("WEBHOOK DE WHATSAPP RECIBIDO");
                console.log("=========================================");
                console.log(
                    JSON.stringify(data, null, 2)
                );

                // -----------------------------------------
                // RECORRER ENTRIES
                // -----------------------------------------

                const entries = data.entry || [];

                for (const entry of entries) {

                    const changes = entry.changes || [];

                    for (const change of changes) {

                        const value = change.value;

                        if (!value) {
                            continue;
                        }

                        const messages =
                            value.messages || [];

                        // -------------------------------------
                        // PROCESAR CADA MENSAJE
                        // -------------------------------------

                        for (const message of messages) {

                            console.log("");
                            console.log("-----------------------------------------");
                            console.log("MENSAJE DE WHATSAPP");
                            console.log("-----------------------------------------");

                            const whatsappMessageId =
                                message.id || null;

                            const telefono =
                                message.from || null;

                            const tipo =
                                message.type || "unknown";

                            let contenido = null;

                            // ---------------------------------
                            // TEXTO
                            // ---------------------------------

                            if (
                                message.type === "text" &&
                                message.text
                            ) {

                                contenido =
                                    message.text.body;
                            }

                            // ---------------------------------
                            // OTROS TIPOS
                            // ---------------------------------

                            else {

                                contenido =
                                    `[Mensaje de tipo ${tipo}]`;
                            }

                            console.log(
                                "ID:",
                                whatsappMessageId
                            );

                            console.log(
                                "TELÉFONO:",
                                telefono
                            );

                            console.log(
                                "TIPO:",
                                tipo
                            );

                            console.log(
                                "CONTENIDO:",
                                contenido
                            );

                            // ---------------------------------
                            // VALIDACIÓN
                            // ---------------------------------

                            if (!telefono) {

                                console.log(
                                    "Mensaje ignorado: no tiene teléfono."
                                );

                                continue;
                            }

                            // =================================================
                            // 1. BUSCAR CLIENTE
                            // =================================================

                            let cliente = null;

                            const {
                                data: clienteExistente,
                                error: errorCliente
                            } = await supabase
                                .from("clientes")
                                .select("*")
                                .eq("telefono", telefono)
                                .maybeSingle();

                            if (errorCliente) {
                                throw errorCliente;
                            }

                            // ---------------------------------
                            // CLIENTE EXISTENTE
                            // ---------------------------------

                            if (clienteExistente) {

                                cliente =
                                    clienteExistente;

                                console.log(
                                    "Cliente encontrado:",
                                    cliente.id
                                );
                            }

                            // ---------------------------------
                            // CLIENTE NUEVO
                            // ---------------------------------

                            else {

                                const nombre =
                                    value.contacts?.[0]?.profile?.name ||
                                    telefono;

                                const {
                                    data: nuevoCliente,
                                    error: errorNuevoCliente
                                } = await supabase
                                    .from("clientes")
                                    .insert({
                                        telefono: telefono,
                                        nombre: nombre,
                                        activo: true,
                                        baja_comunicaciones: false
                                    })
                                    .select()
                                    .single();

                                if (errorNuevoCliente) {
                                    throw errorNuevoCliente;
                                }

                                cliente =
                                    nuevoCliente;

                                console.log(
                                    "Cliente nuevo creado:",
                                    cliente.id
                                );
                            }

                            // =================================================
                            // 2. BUSCAR CONVERSACIÓN ABIERTA
                            // =================================================

                            const {
                                data: conversacionesAbiertas,
                                error: errorConversaciones
                            } = await supabase
                                .from("conversaciones")
                                .select("*")
                                .eq("cliente_id", cliente.id)
                                .eq("estado", "abierta")
                                .order(
                                    "ultima_interaccion",
                                    {
                                        ascending: false,
                                        nullsFirst: false
                                    }
                                )
                                .limit(1);

                            if (errorConversaciones) {
                                throw errorConversaciones;
                            }

                            let conversacion = null;

                            if (
                                conversacionesAbiertas &&
                                conversacionesAbiertas.length > 0
                            ) {

                                conversacion =
                                    conversacionesAbiertas[0];

                                console.log(
                                    "Conversación abierta encontrada:",
                                    conversacion.id
                                );
                            }

                            // =================================================
                            // 3. SI NO EXISTE, CREAR CONVERSACIÓN
                            // =================================================

                            let ticketCreado = false;

                            if (!conversacion) {

                                const {
                                    data: nuevaConversacion,
                                    error: errorNuevaConversacion
                                } = await supabase
                                    .from("conversaciones")
                                    .insert({
                                        cliente_id:
                                            cliente.id,

                                        estado:
                                            "abierta",

                                        ultima_interaccion:
                                            new Date().toISOString()
                                    })
                                    .select()
                                    .single();

                                if (errorNuevaConversacion) {
                                    throw errorNuevaConversacion;
                                }

                                conversacion =
                                    nuevaConversacion;

                                ticketCreado = true;

                                console.log(
                                    "Nueva conversación creada:",
                                    conversacion.id
                                );
                            }

                            // =================================================
                            // 4. GUARDAR MENSAJE
                            // =================================================

                            const {
                                data: mensajeGuardado,
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

                                })
                                .select()
                                .single();

                            if (errorMensaje) {
                                throw errorMensaje;
                            }

                            console.log(
                                "Mensaje guardado:",
                                mensajeGuardado.id
                            );

                            // =================================================
                            // 5. ACTUALIZAR ÚLTIMA INTERACCIÓN
                            // =================================================

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

                            // =================================================
                            // 6. GUARDAR HISTORIAL
                            // =================================================

                            if (ticketCreado) {

                                const {
                                    error: errorHistorial
                                } = await supabase
                                    .from("ticket_historial")
                                    .insert({

                                        conversacion_id:
                                            conversacion.id,

                                        agente_id:
                                            conversacion.agente_id || null,

                                        accion:
                                            "ticket_creado",

                                        detalle:
                                            "Ticket creado automáticamente desde WhatsApp."

                                    });

                                if (errorHistorial) {
                                    throw errorHistorial;
                                }

                                console.log(
                                    "Historial: ticket_creado"
                                );

                            } else {

                                const {
                                    error: errorHistorial
                                } = await supabase
                                    .from("ticket_historial")
                                    .insert({

                                        conversacion_id:
                                            conversacion.id,

                                        agente_id:
                                            conversacion.agente_id || null,

                                        accion:
                                            "mensaje_recibido",

                                        detalle:
                                            "El cliente envió un nuevo mensaje por WhatsApp."

                                    });

                                if (errorHistorial) {
                                    throw errorHistorial;
                                }

                                console.log(
                                    "Historial: mensaje_recibido"
                                );
                            }

                        }
                    }
                }

                // =================================================
                // RESPONDER A META
                // =================================================

                res.writeHead(200, {
                    "Content-Type": "application/json"
                });

                res.end(
                    JSON.stringify({
                        success: true
                    })
                );

            } catch (error) {

                console.error("");
                console.error(
                    "========================================="
                );
                console.error(
                    "ERROR PROCESANDO WEBHOOK"
                );
                console.error(
                    "========================================="
                );
                console.error(error);

                res.writeHead(500, {
                    "Content-Type": "application/json"
                });

                res.end(
                    JSON.stringify({
                        success: false,
                        error: error.message
                    })
                );
            }

        });

        return;
    }

    // =================================================
    // ENVIAR MENSAJE DE WHATSAPP
    // =================================================

    if (
        req.method === "POST" &&
        parsedUrl.pathname === "/send-message"
    ) {

        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();
        });

        req.on("end", async () => {

            try {

                const data =
                    JSON.parse(body);

                const to =
                    data.to;

                const message =
                    data.message;

                const conversacionId =
                    data.conversacion_id;

                const agenteId =
                    data.agente_id;

                if (!to || !message) {

                    res.writeHead(400, {
                        "Content-Type":
                            "application/json"
                    });

                    res.end(
                        JSON.stringify({
                            error:
                                "Faltan los campos 'to' y 'message'."
                        })
                    );

                    return;
                }

                // -----------------------------------------
                // ENVIAR A WHATSAPP
                // -----------------------------------------

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

                            body: JSON.stringify({

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

                // -----------------------------------------
                // META RECHAZÓ EL MENSAJE
                // -----------------------------------------

                if (!response.ok) {

                    res.writeHead(
                        response.status,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );

                    res.end(
                        JSON.stringify(result)
                    );

                    return;
                }

                // -----------------------------------------
                // GUARDAR EN SUPABASE
                // -----------------------------------------

                if (conversacionId) {

                    const whatsappMessageId =
                        result.messages?.[0]?.id ||
                        null;

                    const {
                        data: conversacion,
                        error: errorConversacion
                    } = await supabase
                        .from("conversaciones")
                        .select("cliente_id")
                        .eq(
                            "id",
                            conversacionId
                        )
                        .single();

                    if (errorConversacion) {
                        throw errorConversacion;
                    }

                    const {
                        error: errorMensaje
                    } = await supabase
                        .from("mensajes")
                        .insert({

                            cliente_id:
                                conversacion.cliente_id,

                            conversacion_id:
                                conversacionId,

                            whatsapp_message_id:
                                whatsappMessageId,

                            direccion:
                                "saliente",

                            tipo:
                                "text",

                            contenido:
                                message,

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
                            conversacionId
                        );

                    if (errorActualizacion) {
                        throw errorActualizacion;
                    }

                    const {
                        error: errorHistorial
                    } = await supabase
                        .from("ticket_historial")
                        .insert({

                            conversacion_id:
                                conversacionId,

                            agente_id:
                                agenteId || null,

                            accion:
                                "mensaje_enviado",

                            detalle:
                                "El agente envió un mensaje al cliente por WhatsApp."

                        });

                    if (errorHistorial) {
                        throw errorHistorial;
                    }
                }

                // -----------------------------------------
                // RESPUESTA
                // -----------------------------------------

                res.writeHead(200, {
                    "Content-Type":
                        "application/json"
                });

                res.end(
                    JSON.stringify({

                        success:
                            true,

                        whatsapp:
                            result

                    })
                );

            } catch (error) {

                console.error(
                    "Error enviando mensaje:"
                );

                console.error(error);

                res.writeHead(500, {
                    "Content-Type":
                        "application/json"
                });

                res.end(
                    JSON.stringify({
                        error:
                            error.message
                    })
                );
            }

        });

        return;
    }

    // =================================================
    // RUTA RAÍZ
    // =================================================

    if (
        req.method === "GET" &&
        parsedUrl.pathname === "/"
    ) {

        res.writeHead(200, {
            "Content-Type":
                "text/plain"
        });

        res.end(
            "TR Soporte - WhatsApp Webhook funcionando."
        );

        return;
    }

    // =================================================
    // RUTA NO ENCONTRADA
    // =================================================

    res.writeHead(404, {
        "Content-Type":
            "text/plain"
    });

    res.end("Not Found");

});

// =====================================================
// INICIAR SERVIDOR
// =====================================================

server.listen(PORT, () => {

    console.log(
        `Servidor iniciado en el puerto ${PORT}`
    );

});
