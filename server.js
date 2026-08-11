const http = require("http");
const url = require("url");

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "TRSOporteWebhook2026";

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    // Verificación del Webhook de Meta
    if (req.method === "GET" && parsedUrl.pathname === "/webhook") {
        const mode = parsedUrl.query["hub.mode"];
        const token = parsedUrl.query["hub.verify_token"];
        const challenge = parsedUrl.query["hub.challenge"];

        if (mode === "subscribe" && token === VERIFY_TOKEN) {
            console.log("Webhook verificado correctamente.");
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(challenge);
        } else {
            console.log("Error de verificación del Webhook.");
            res.writeHead(403);
            res.end("Forbidden");
        }

        return;
    }

    // Recepción de eventos de WhatsApp
    if (req.method === "POST" && parsedUrl.pathname === "/webhook") {
        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();
        });

        req.on("end", () => {
            console.log("Evento recibido de WhatsApp:");
            console.log(body);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "received" }));
        });

        return;
    }

    // Página principal
    if (req.method === "GET" && parsedUrl.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("TR Soporte - WhatsApp Webhook funcionando.");
        return;
    }

    res.writeHead(404);
    res.end("Not Found");
});

server.listen(PORT, () => {
    console.log(`Servidor iniciado en el puerto ${PORT}`);
});
