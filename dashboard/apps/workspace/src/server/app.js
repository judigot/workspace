"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
var hono_1 = require("hono");
var cors_1 = require("hono/cors");
var node_fs_1 = require("node:fs");
var node_net_1 = require("node:net");
var WORKSPACE_ENV = process.env.WORKSPACE_ENV_PATH || "/home/ubuntu/workspace/.env";
function parseEnv() {
    var defaults = {
        domain: "judigot.com",
        opencodeDomain: "opencode.judigot.com",
        apps: [],
    };
    try {
        var content = (0, node_fs_1.readFileSync)(WORKSPACE_ENV, "utf-8");
        var vars = {};
        for (var _i = 0, _a = content.split("\n"); _i < _a.length; _i++) {
            var line = _a[_i];
            var trimmed = line.trim();
            if (trimmed === "" || trimmed.startsWith("#")) {
                continue;
            }
            var eqIdx = trimmed.indexOf("=");
            if (eqIdx === -1) {
                continue;
            }
            var key = trimmed.slice(0, eqIdx);
            var value = trimmed.slice(eqIdx + 1);
            /* Strip surrounding quotes */
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            vars[key] = value;
        }
        var domain = vars["DOMAIN"] || defaults.domain;
        var opencodeDomain = vars["OPENCODE_SUBDOMAIN"] || "opencode.".concat(domain);
        var appsEnv = vars["APPS"] || "";
        var viteApps = vars["VITE_APPS"] || "";
        var apps = void 0;
        if (appsEnv.trim()) {
            /* New format: slug:type:frontend_port[:backend_port[:options]] */
            apps = appsEnv
                .trim()
                .split(/\s+/)
                .filter(function (entry) { return entry.includes(":"); })
                .map(function (entry) {
                var parts = entry.split(":");
                var slug = parts[0];
                var type = (parts[1] || "frontend");
                var frontendPort = parts[2] ? Number(parts[2]) : null;
                var backendPort = parts[3] ? Number(parts[3]) : null;
                var options = parts[4] ? parts[4].split(",") : [];
                return { slug: slug, type: type, frontendPort: frontendPort, backendPort: backendPort, options: options };
            });
        }
        else if (viteApps.trim()) {
            /* Legacy format: slug:port */
            apps = viteApps
                .trim()
                .split(/\s+/)
                .filter(function (entry) { return entry.includes(":"); })
                .map(function (entry) {
                var _a = entry.split(":"), slug = _a[0], portStr = _a[1];
                return {
                    slug: slug,
                    type: "frontend",
                    frontendPort: Number(portStr),
                    backendPort: null,
                    options: [],
                };
            });
        }
        else {
            apps = [];
        }
        return { domain: domain, opencodeDomain: opencodeDomain, apps: apps };
    }
    catch (_b) {
        return defaults;
    }
}
function checkPort(port, host) {
    if (host === void 0) { host = "127.0.0.1"; }
    return new Promise(function (resolve) {
        var socket = (0, node_net_1.createConnection)({ port: port, host: host, timeout: 500 });
        socket.on("connect", function () {
            socket.destroy();
            resolve(true);
        });
        socket.on("error", function () {
            resolve(false);
        });
        socket.on("timeout", function () {
            socket.destroy();
            resolve(false);
        });
    });
}
exports.app = new hono_1.Hono();
exports.app.use("/*", (0, cors_1.cors)());
exports.app.get("/api/apps", function (c) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, domain, opencodeDomain, rawApps, apps, config;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = parseEnv(), domain = _a.domain, opencodeDomain = _a.opencodeDomain, rawApps = _a.apps;
                return [4 /*yield*/, Promise.all(rawApps.map(function (raw) { return __awaiter(void 0, void 0, void 0, function () {
                        var status, frontendUp, _a;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    status = "unknown";
                                    if (!(raw.type === "laravel")) return [3 /*break*/, 4];
                                    if (!raw.backendPort) return [3 /*break*/, 2];
                                    return [4 /*yield*/, checkPort(raw.backendPort)];
                                case 1:
                                    status = (_b.sent()) ? "up" : "down";
                                    return [3 /*break*/, 3];
                                case 2:
                                    status = "down";
                                    _b.label = 3;
                                case 3: return [3 /*break*/, 11];
                                case 4:
                                    if (!(raw.type === "fullstack")) return [3 /*break*/, 8];
                                    if (!raw.frontendPort) return [3 /*break*/, 6];
                                    return [4 /*yield*/, checkPort(raw.frontendPort)];
                                case 5:
                                    _a = _b.sent();
                                    return [3 /*break*/, 7];
                                case 6:
                                    _a = false;
                                    _b.label = 7;
                                case 7:
                                    frontendUp = _a;
                                    status = frontendUp ? "up" : "down";
                                    return [3 /*break*/, 11];
                                case 8:
                                    if (!raw.frontendPort) return [3 /*break*/, 10];
                                    return [4 /*yield*/, checkPort(raw.frontendPort)];
                                case 9:
                                    status = (_b.sent()) ? "up" : "down";
                                    return [3 /*break*/, 11];
                                case 10:
                                    status = "down";
                                    _b.label = 11;
                                case 11: return [2 /*return*/, {
                                        slug: raw.slug,
                                        type: raw.type,
                                        frontendPort: raw.frontendPort,
                                        backendPort: raw.backendPort,
                                        options: raw.options,
                                        url: "https://".concat(domain, "/").concat(raw.slug, "/"),
                                        status: status,
                                    }];
                            }
                        });
                    }); }))];
            case 1:
                apps = _b.sent();
                config = { domain: domain, opencodeDomain: opencodeDomain, apps: apps };
                return [2 /*return*/, c.json(config)];
        }
    });
}); });
exports.app.get("/api/health", function (c) {
    return c.json({ status: "ok" });
});
