const http = require("http");
const url = require("url");

const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

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

                const data = JSON.parse(body);

                const to = data.to;
                const message = data.message;
                const conversacionId = data.conversacion_id;
                const agenteId = data.agente_id;


                // -----------------------------------------
                // VALIDAR DATOS
                // -----------------------------------------

                if (!to || !message) {

                    res.writeHead(400, {
                        "Content-Type": "application/json"
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
                // ENVIAR MENSAJE A WHATSAPP
                // -----------------------------------------

                const whatsappUrl =
                    `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`;

                const response = await fetch(
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

                            to: to,

                            type: "text",

                            text: {
                                body: message
                            }

                        })
                    }
                );


                const result = await response.json();


                console.log(
                    "Respuesta de Meta:",
                    result
                );


                // -----------------------------------------
                // SI WHATSAPP RECHAZÓ EL MENSAJE
                // -----------------------------------------

                if (!response.ok) {

                    res.writeHead(response.status, {
                        "Content-Type":
                            "application/json"
                    });

                    res.end(
                        JSON.stringify(result)
                    );

                    return;
                }


                // -----------------------------------------
                // GUARDAR MENSAJE EN SUPABASE
                // -----------------------------------------

                if (conversacionId) {

                    const whatsappMessageId =
                        result.messages?.[0]?.id || null;


                    // -------------------------------------
                    // OBTENER CLIENTE
                    // -------------------------------------

                    const {
                        data: conversacion,
                        error: errorConversacion
                    } = await supabase
                        .from("conversaciones")
                        .select("cliente_id")
                        .eq("id", conversacionId)
                        .single();


                    if (errorConversacion) {
                        throw errorConversacion;
                    }


                    // -------------------------------------
                    // GUARDAR MENSAJE
                    // -------------------------------------

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


                    // -------------------------------------
                    // ACTUALIZAR ÚLTIMA INTERACCIÓN
                    // -------------------------------------

                    const {
                        error: errorActualizacion
                    } = await supabase
                        .from("conversaciones")
                        .update({

                            ultima_interaccion:
                                new Date().toISOString()

                        })
                        .eq("id", conversacionId);


                    if (errorActualizacion) {
                        throw errorActualizacion;
                    }


                    // -------------------------------------
                    // GUARDAR EN HISTORIAL
                    // -------------------------------------

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
                // RESPUESTA AL PANEL
                // -----------------------------------------

                res.writeHead(200, {
                    "Content-Type":
                        "application/json"
                });

                res.end(
                    JSON.stringify({

                        success: true,

                        whatsapp: result

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
    // RUTA NO ENCONTRADA
    // =================================================

    res.writeHead(404);

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
