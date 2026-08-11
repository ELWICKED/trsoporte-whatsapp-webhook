const http = require("http");
const url = require("url");

const { createClient } = require("@supabase/supabase-js");

// =====================================================
// CONFIGURACIÓN
// =====================================================

const PORT = process.env.PORT || 3000;

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
    SUPABASE_SECRET_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    }
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
        }

        return;
    }


    // =================================================
    // WEBHOOK - VERIFICACIÓN DE META
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

        console.log(
            "Modo:",
            mode
        );

        console.log(
            "Token recibido:",
            token
        );


        // ---------------------------------------------
        // VALIDAR TOKEN
        // ---------------------------------------------

        if (
            mode === "subscribe" &&
            token === VERIFY_TOKEN
        ) {

            console.log(
                "WEBHOOK VERIFICADO CORRECTAMENTE."
            );

            res.writeHead(200, {
                "Content-Type": "text/plain"
            });

            res.end(challenge);

            return;
        }


        // ---------------------------------------------
        // TOKEN INCORRECTO
        // ---------------------------------------------

        console.log(
            "ERROR: Token de verificación incorrecto."
        );

        res.writeHead(403, {
            "Content-Type": "text/plain"
        });

        res.end("Forbidden");

        return;
    }


    // =================================================
    // WEBHOOK - MENSAJES DE WHATSAPP
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

                console.log(
                    "========================================"
                );

                console.log(
                    "WEBHOOK DE WHATSAPP RECIBIDO"
                );

                console.log(
                    "========================================"
                );


                // -------------------------------------
                // CONVERTIR JSON
                // -------------------------------------

                const data = JSON.parse(body);


                // -------------------------------------
                // MOSTRAR EVENTO COMPLETO
                // -------------------------------------

                console.log(
                    "Evento recibido:"
                );

                console.log(
                    JSON.stringify(
                        data,
                        null,
                        2
                    )
                );


                // -------------------------------------
                // RESPONDER A META
                // -------------------------------------

                res.writeHead(200, {
                    "Content-Type":
                        "application/json"
                });

                res.end(
                    JSON.stringify({
                        success: true
                    })
                );


                // -------------------------------------
                // DETECTAR MENSAJES
                // -------------------------------------

                const entry =
                    data.entry?.[0];

                const changes =
                    entry?.changes?.[0];

                const value =
                    changes?.value;

                const messages =
                    value?.messages;


                if (
                    messages &&
                    messages.length > 0
                ) {

                    for (
                        const message
                        of messages
                    ) {

                        console.log(
                            "--------------------------------"
                        );

                        console.log(
                            "MENSAJE DE WHATSAPP"
                        );

                        console.log(
                            "ID:",
                            message.id
                        );

                        console.log(
                            "TIPO:",
                            message.type
                        );

                        console.log(
                            "REMITENTE:",
                            message.from
                        );


                        // -----------------------------
                        // MENSAJE DE TEXTO
                        // -----------------------------

                        if (
                            message.type === "text"
                        ) {

                            const texto =
                                message.text?.body;

                            console.log(
                                "TEXTO:",
                                texto
                            );
                        }


                        console.log(
                            "--------------------------------"
                        );
                    }

                } else {

                    console.log(
                        "El evento no contiene mensajes."
                    );
                }

            } catch (error) {

                console.error(
                    "Error procesando webhook:"
                );

                console.error(error);

                // -------------------------------------
                // IMPORTANTE:
                // RESPONDEMOS 200 PARA QUE META NO
                // REINTENTE EL EVENTO DURANTE ESTA
                // ETAPA DE PRUEBA.
                // -------------------------------------

                if (!res.headersSent) {

                    res.writeHead(200, {
                        "Content-Type":
                            "application/json"
                    });

                    res.end(
                        JSON.stringify({
                            success: false,
                            error: error.message
                        })
                    );
                }
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


                // -------------------------------------
                // VALIDAR DATOS
                // -------------------------------------

                if (
                    !to ||
                    !message
                ) {

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


                // -------------------------------------
                // URL DE WHATSAPP
                // -------------------------------------

                const whatsappUrl =
                    `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`;


                // -------------------------------------
                // ENVIAR A META
                // -------------------------------------

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


                // -------------------------------------
                // META RECHAZÓ
                // -------------------------------------

                if (!response.ok) {

                    res.writeHead(
                        response.status,
                        {
                            "Content-Type":
                                "application/json"
                        }
                    );

                    res.end(
                        JSON.stringify(
                            result
                        )
                    );

                    return;
                }


                // -------------------------------------
                // GUARDAR EN SUPABASE
                // -------------------------------------

                if (conversacionId) {

                    const whatsappMessageId =
                        result
                            .messages?.[0]?.id
                        || null;


                    // -------------------------------
                    // OBTENER CLIENTE
                    // -------------------------------

                    const {
                        data: conversacion,
                        error:
                            errorConversacion
                    } =
                        await supabase
                            .from(
                                "conversaciones"
                            )
                            .select(
                                "cliente_id"
                            )
                            .eq(
                                "id",
                                conversacionId
                            )
                            .single();


                    if (
                        errorConversacion
                    ) {
                        throw errorConversacion;
                    }


                    // -------------------------------
                    // GUARDAR MENSAJE
                    // -------------------------------

                    const {
                        error:
                            errorMensaje
                    } =
                        await supabase
                            .from(
                                "mensajes"
                            )
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


                    if (
                        errorMensaje
                    ) {
                        throw errorMensaje;
                    }


                    // -------------------------------
                    // ACTUALIZAR INTERACCIÓN
                    // -------------------------------

                    const {
                        error:
                            errorActualizacion
                    } =
                        await supabase
                            .from(
                                "conversaciones"
                            )
                            .update({

                                ultima_interaccion:
                                    new Date()
                                        .toISOString()

                            })
                            .eq(
                                "id",
                                conversacionId
                            );


                    if (
                        errorActualizacion
                    ) {
                        throw errorActualizacion;
                    }


                    // -------------------------------
                    // HISTORIAL
                    // -------------------------------

                    const {
                        error:
                            errorHistorial
                    } =
                        await supabase
                            .from(
                                "ticket_historial"
                            )
                            .insert({

                                conversacion_id:
                                    conversacionId,

                                agente_id:
                                    agenteId ||
                                    null,

                                accion:
                                    "mensaje_enviado",

                                detalle:
                                    "El agente envió un mensaje al cliente por WhatsApp."

                            });


                    if (
                        errorHistorial
                    ) {
                        throw errorHistorial;
                    }

                }


                // -------------------------------------
                // RESPUESTA AL PANEL
                // -------------------------------------

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

                console.error(
                    error
                );


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
    // RUTA PRINCIPAL
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

    res.end(
        "Not Found"
    );

});


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
