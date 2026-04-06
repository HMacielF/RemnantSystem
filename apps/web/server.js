const path = require("path");
const http = require("http");
const next = require("next");

function loadLocalEnv() {
    try {
        require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });
    } catch (error) {
        if (error?.code !== "MODULE_NOT_FOUND") throw error;
    }
}

loadLocalEnv();

function readCliPort() {
    const index = process.argv.findIndex((arg) => arg === "--port" || arg === "-p");
    if (index === -1) return null;
    const value = Number(process.argv[index + 1]);
    return Number.isFinite(value) && value > 0 ? value : null;
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = readCliPort() || Number(process.env.PORT || 3001);
// Turbopack dev cache has been unstable in this workspace, so webpack is the
// default dev bundler unless explicitly overridden.
const useWebpack = dev && process.env.NEXT_DEV_BUNDLER !== "turbopack";
const app = next({ dev, dir: __dirname, hostname, port, webpack: useWebpack });
const handle = app.getRequestHandler();

async function start() {
    await app.prepare();
    const handleUpgrade = app.getUpgradeHandler();

    const httpServer = http.createServer((req, res) => {
        return handle(req, res);
    });

    httpServer.on("upgrade", (req, socket, head) => {
        handleUpgrade(req, socket, head);
    });

    httpServer.listen(port, () => {
        const bundler = dev ? (useWebpack ? "webpack" : "turbopack") : "production";
        console.log(`▲ Remnant System running at http://${hostname}:${port} (${bundler})`);
    });
}

start().catch((error) => {
    console.error("Failed to start Next server", error);
    process.exit(1);
});
