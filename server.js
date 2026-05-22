const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const dist = path.join(root, "dist");
const serveRoot = fs.existsSync(dist) ? dist : root;
const port = Number(process.env.PORT || 4173);

const stakeConfig = JSON.parse(
  fs.readFileSync(path.join(root, "config", "stake-config.json"), "utf8")
);

const stakedState = {
  base: 428244751,
  start: Date.parse("2026-05-22T22:50:00+08:00"),
  stepMs: 5 * 60 * 1000,
  rate: 0.0005
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, data) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function currentNetworkStaked() {
  const elapsed = Math.max(0, Date.now() - stakedState.start);
  const intervals = Math.floor(elapsed / stakedState.stepMs);
  return Math.floor(stakedState.base * Math.pow(1 + stakedState.rate, intervals));
}

function serveFile(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(serveRoot, requested));

  if (!filePath.startsWith(serveRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/stats") {
    sendJson(res, { networkStaked: currentNetworkStaked() });
    return;
  }
  if (pathname === "/api/stake-config") {
    sendJson(res, stakeConfig);
    return;
  }
  serveFile(req, res);
});

server.listen(port, () => {
  console.log(`NIUMA is running at http://localhost:${port}`);
});
