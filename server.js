const http = require("http");
const url = require("url");

const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;

// ======================================================
// CONFIGURACIÓN META WHATSAPP
// ======================================================

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

// ======================================================
// CONFIGURACIÓN SUPABASE
// ======================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

let supabase = null;

if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
    supabase = createClient(
        SUPABASE_URL,
        SUPABASE_SECRET_KEY
    );

    console.log("Cliente de Supabase inicializado.");
} else {
    console.error("ERROR: Faltan las variables de Supabase.");
}

// ======================================================
// COMPROBAR CONEXIÓN CON SUPABASE
// ======================================================

async function comprobarSupabase() {

    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
        console.error("Supabase: faltan credenciales.");
        return;
    }

    try {

        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/`,
            {
                method: "GET",
                headers: {
                    "apikey": SUPABASE_SECRET_KEY,
                    "Authorization": `Bearer ${SUPABASE_SECRET_KEY}`
                }
            }
        );

        if (response.ok) {

            console.log("========================================");
            console.log("SUPABASE CONECTADO CORRECTAMENTE");
            console.log("========================================");

        } else {

            const text = await response.text();

            console.error("ERROR CONECTANDO CON SUPABASE");
            console.error("HTTP:", response.status);
            console.error(text);
        }

    } catch (error) {

        console.error("ERROR DE CONEXIÓN CON SUPABASE:");
        console.error(error.message);
    }
}

// ======================================================
// SERVIDOR
// ======================================================

const server = http.createServer((req, res) => {

    const parsedUrl = url.parse(req.url, true);

    // ==================================================
    // PÁGINA PRINCIPAL
    // ==================================================

    if (
        req.method === "GET" &&
        parsedUrl.pathname === "/"
    ) {

        res.writeHead(200, {
            "Content-Type": "text/plain"
        });

        res.end(
            "TR Soporte - WhatsApp Webhook funcionando."
        );

        return;
    }

    // ==================================================
    // VERIFICACIÓN DEL WEBHOOK DE META
    // ==================================================

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

        if (
            mode === "subscribe" &&
            token === VERIFY_TOKEN
        ) {

            console.log(
                "Webhook de Meta verificado correctamente."
            );

            res.writeHead(200, {
                "Content-Type": "text/plain"
            });

            res.end(challenge);

        } else {

            console.log(
                "Error de verificación del Webhook."
            );

            res.writeHead(403);

            res.end("Forbidden");
        }

        return;
    }

    // ==================================================
    // RECEPCIÓN DE EVENTOS DE WHATSAPP
    // ==================================================

    if (
        req.method === "POST" &&
        parsedUrl.pathname === "/webhook"
    ) {

        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();
        });

        req.on("end", () => {

            console.log("");
            console.log("========================================");
            console.log("EVENTO RECIBIDO DE WHATSAPP");
            console.log("========================================");

            console.log(body);

            console.log("========================================");
            console.log("");

            res.writeHead(200, {
                "Content-Type": "application/json"
            });

            res.end(
                JSON.stringify({
                    status: "received"
                })
            );
        });

        return;
    }

    // ==================================================
    // ENVIAR MENSAJE DE WHATSAPP
    // ==================================================

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

                            messaging_product: "whatsapp",

                            to: to,

                            type: "template",

                            template: {

                                name:
                                    "3p_direct_integration_test_template",

                                language: {
                                    code: "en_US"
                                }
                            }
                        })
                    }
                );

                const result =
                    await response.json();

                console.log(
                    "Respuesta de Meta:"
                );

                console.log(result);

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
                        error: error.message
                    })
                );
            }
        });

        return;
    }

    // ==================================================
    // RUTA NO ENCONTRADA
    // ==================================================

    res.writeHead(404);

    res.end("Not Found");
});

// ======================================================
// INICIAR SERVIDOR
// ======================================================

server.listen(
    PORT,
    async () => {

        console.log(
            `Servidor iniciado en el puerto ${PORT}`
        );

        await comprobarSupabase();
    }
);
