"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var node_server_1 = require("@hono/node-server");
var app_js_1 = require("./app.js");
var PORT = Number(process.env.DASHBOARD_API_PORT) || 3100;
(0, node_server_1.serve)({ fetch: app_js_1.app.fetch, port: PORT }, function (info) {
    console.error("Dashboard API running on http://localhost:".concat(String(info.port)));
});
