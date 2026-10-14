#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const HOST = process.env.DOMSCOUT_HOST || "127.0.0.1";
const PORT = Number(process.env.DOMSCOUT_PORT || 49341);
const BODY_LIMIT_BYTES = 5 * 1024 * 1024;
const ROOT_DIR = __dirname;
const REPORTS_DIR = path.join(ROOT_DIR, "reports");
let lastSavedPaths = null;

function slugify(value, fallback) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug || fallback || "target";
}

function folderNameFromHeadline(headline) {
  const words = String(headline || "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word.toLowerCase());

  return words.join("-") || "target";
}

function ensureOutputDirectories() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return JSON.stringify(
      {
        error: "Unable to serialize report.",
        message: error && error.message ? error.message : String(error)
      },
      null,
      2
    );
  }
}

function buildHeadline(report) {
  const selection = report && report.selection ? report.selection : {};
  const attributes = selection.attributes || {};
  const classList = Array.isArray(selection.classList) ? selection.classList : [];
  const candidates = [
    selection.elementIdentity,
    selection.id,
    attributes["aria-label"],
    selection.title,
    selection.name,
    attributes["data-testid"],
    attributes["data-test"],
    attributes["data-qa"],
    attributes["data-cy"],
    classList.find((className) => className && className.length >= 3 && !/[0-9]{5,}/.test(className)),
    selection.textSummary
  ].filter(Boolean);

  return candidates.length ? String(candidates[0]) : "target";
}

function buildTimestampStamp(report) {
  const timestampSource =
    report && report.meta && typeof report.meta.timestamp === "string" && report.meta.timestamp
      ? report.meta.timestamp
      : new Date().toISOString();
  const date = new Date(timestampSource);
  const hours24 = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const hours12 = hours24 % 12 || 12;
  const meridiem = hours24 >= 12 ? "PM" : "AM";
  const timeStamp = `${hours12}-${minutes}${meridiem}`;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const dateStamp = `${year}-${month}-${day}`;

  return {
    dateStamp,
    timeStamp
  };
}

function ensureUniqueBaseName(directory, baseName) {
  let candidate = baseName;
  let counter = 2;

  while (
    fs.existsSync(path.join(directory, `${candidate}.md`)) ||
    fs.existsSync(path.join(directory, `${candidate}.json`))
  ) {
    candidate = `${baseName}-${counter}`;
    counter += 1;
  }

  return candidate;
}

function writeReportFiles(payload) {
  ensureOutputDirectories();

  const report = payload && typeof payload.report === "object" && payload.report ? payload.report : {};
  const markdown =
    payload && typeof payload.markdown === "string" && payload.markdown.trim()
      ? payload.markdown
      : "# DOMScout Report\n\nNo Markdown payload was supplied.\n";
  const jsonText =
    payload && typeof payload.json === "string" && payload.json.trim()
      ? payload.json
      : safeJsonStringify(report);
  const stamp = buildTimestampStamp(report);
  const headline = buildHeadline(report);
  const folderName = folderNameFromHeadline(headline);
  const folderDir = path.join(REPORTS_DIR, folderName);
  const slug = slugify(headline, "target");
  fs.mkdirSync(folderDir, { recursive: true });
  const baseName = ensureUniqueBaseName(folderDir, `${slug}-${stamp.timeStamp}-${stamp.dateStamp}`);
  const markdownPath = path.join(folderDir, `${baseName}.md`);
  const jsonPath = path.join(folderDir, `${baseName}.json`);

  fs.writeFileSync(markdownPath, markdown, "utf8");
  fs.writeFileSync(jsonPath, jsonText, "utf8");

  lastSavedPaths = {
    baseName,
    folderName,
    folderDir,
    jsonPath,
    markdownPath,
    reportsDir: REPORTS_DIR
  };

  return lastSavedPaths;
}

function writeJson(response, statusCode, payload) {
  const body = safeJsonStringify(payload);

  response.writeHead(statusCode, {
    "Access-Control-Allow-Headers": "Content-Type, X-DOMScout-Tool",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function handleOptions(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Headers": "Content-Type, X-DOMScout-Tool",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store"
  });
  response.end();
}

function collectRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > BODY_LIMIT_BYTES) {
        reject(new Error("Request body exceeded the 5 MB limit."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    request.on("error", reject);
  });
}

function parseJsonBody(body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    return null;
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${HOST}:${PORT}`);

  if (request.method === "OPTIONS") {
    handleOptions(response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/domscout/health") {
    writeJson(response, 200, {
      ok: true,
      paths: {
        reportsDir: REPORTS_DIR
      },
      lastSavedPaths,
      naming: "name-time-date.md/json",
      port: PORT,
      tool: "DOMScout receiver"
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/domscout/report") {
    try {
      const rawBody = await collectRequestBody(request);
      const payload = parseJsonBody(rawBody);

      if (!payload) {
        writeJson(response, 400, {
          error: "Invalid JSON payload."
        });
        return;
      }

      const paths = writeReportFiles(payload);
      writeJson(response, 200, {
        ok: true,
        paths,
        receivedAt: new Date().toISOString()
      });
      return;
    } catch (error) {
      writeJson(response, 500, {
        error: error && error.message ? error.message : String(error)
      });
      return;
    }
  }

  writeJson(response, 404, {
    error: "Not found.",
    routes: ["GET /domscout/health", "POST /domscout/report"]
  });
});

server.on("error", (error) => {
  console.error("[DOMScout receiver] Failed to start:", error && error.message ? error.message : error);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  ensureOutputDirectories();
  console.log("[DOMScout receiver] Listening on http://" + HOST + ":" + PORT);
  console.log("[DOMScout receiver] Health: http://" + HOST + ":" + PORT + "/domscout/health");
  console.log("[DOMScout receiver] Reports directory: " + REPORTS_DIR);
  console.log("[DOMScout receiver] Saved files land in reports/<up-to-three-word-identity>/name-6-36PM-2026-07-02.md/.json");
});
