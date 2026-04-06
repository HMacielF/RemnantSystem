const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const [major, minor] = process.versions.node.split(".").map(Number);
const unsupported =
  !Number.isFinite(major) ||
  !Number.isFinite(minor) ||
  major < 20 ||
  (major === 20 && minor < 9) ||
  major >= 25;

if (unsupported) {
  console.error(
    `Unsupported Node.js version ${process.versions.node}. Use Node 20.9+ and stay below Node 25. ` +
      "Node 22 LTS is recommended for this repo.",
  );
  process.exit(1);
}

const nextBin = require.resolve("next/dist/bin/next");
const nextArgs = process.argv.slice(2);

function readCliPort() {
  const index = nextArgs.findIndex((arg) => arg === "--port" || arg === "-p");
  if (index === -1) return null;
  const value = Number(nextArgs[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function ensurePortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use. Stop the existing dev server before starting another one.`));
        return;
      }
      reject(error);
    });
    server.listen(port, "0.0.0.0", () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });
}

async function main() {
  const command = nextArgs[0] || "dev";
  const port = readCliPort() || Number(process.env.PORT || 3001);

  if (command === "dev") {
    fs.rmSync(path.join(__dirname, ".next", "dev"), { recursive: true, force: true });
    await ensurePortAvailable(port);
  } else if (command === "start") {
    await ensurePortAvailable(port);
  }

  const child = spawn(process.execPath, [nextBin, ...nextArgs], {
    cwd: __dirname,
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
