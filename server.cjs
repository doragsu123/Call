var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var app = (0, import_express.default)();
var PORT = 3e3;
app.use(import_express.default.json());
var devices = /* @__PURE__ */ new Map();
var activeCalls = /* @__PURE__ */ new Map();
var sseClients = [];
function broadcast(event, data) {
  const payload = `event: ${event}
data: ${JSON.stringify(data)}

`;
  sseClients.forEach((client) => {
    try {
      client.res.write(payload);
    } catch (err) {
      console.error("Failed to write to client", client.deviceId, err);
    }
  });
}
setInterval(() => {
  const now = Date.now();
  let changed = false;
  devices.forEach((device) => {
    const isSseConnected = sseClients.some((c) => c.deviceId === device.id);
    const shouldBeOnline = isSseConnected || now - device.lastSeen < 15e3;
    if (device.isOnline !== shouldBeOnline) {
      device.isOnline = shouldBeOnline;
      changed = true;
    }
  });
  if (changed) {
    broadcast("devices", Array.from(devices.values()));
  }
}, 5e3);
app.get("/api/state", (req, res) => {
  res.json({
    devices: Array.from(devices.values()),
    activeCalls: Array.from(activeCalls.values())
  });
});
app.post("/api/devices/register", (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) {
    res.status(400).json({ error: "Missing id or name" });
    return;
  }
  const existing = devices.get(id);
  const updatedDevice = {
    id,
    name,
    lastSeen: Date.now(),
    isOnline: true
  };
  devices.set(id, updatedDevice);
  activeCalls.forEach((call) => {
    if (call.fromDeviceId === id) {
      call.fromDeviceName = name;
    }
    if (call.toDeviceId === id) {
      call.toDeviceName = name;
    }
  });
  broadcast("devices", Array.from(devices.values()));
  broadcast("activeCalls", Array.from(activeCalls.values()));
  res.json({ success: true, device: updatedDevice });
});
app.post("/api/calls", (req, res) => {
  const { fromDeviceId, toDeviceId, requirement } = req.body;
  if (!fromDeviceId || !toDeviceId || !requirement) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const fromDevice = devices.get(fromDeviceId);
  const toDevice = devices.get(toDeviceId);
  if (!fromDevice || !toDevice) {
    res.status(404).json({ error: "Device not found" });
    return;
  }
  const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const newCall = {
    id: callId,
    fromDeviceId,
    fromDeviceName: fromDevice.name,
    toDeviceId,
    toDeviceName: toDevice.name,
    requirement,
    timestamp: Date.now(),
    status: "active"
  };
  activeCalls.set(callId, newCall);
  broadcast("call-created", newCall);
  broadcast("activeCalls", Array.from(activeCalls.values()));
  res.json({ success: true, call: newCall });
});
app.post("/api/calls/stop", (req, res) => {
  const { callId, stoppedByDeviceId } = req.body;
  if (!callId || !stoppedByDeviceId) {
    res.status(400).json({ error: "Missing callId or stoppedByDeviceId" });
    return;
  }
  const call = activeCalls.get(callId);
  if (!call) {
    res.status(404).json({ error: "Call not found or already stopped" });
    return;
  }
  const stoppedByDevice = devices.get(stoppedByDeviceId);
  const stopperName = stoppedByDevice ? stoppedByDevice.name : "\u8AB0\u304B";
  call.status = "stopped";
  call.stoppedByDeviceName = stopperName;
  activeCalls.delete(callId);
  broadcast("call-stopped", {
    callId,
    stoppedByDeviceId,
    stoppedByDeviceName: stopperName,
    callerDeviceId: call.fromDeviceId,
    recipientDeviceName: call.toDeviceName
  });
  broadcast("activeCalls", Array.from(activeCalls.values()));
  res.json({ success: true });
});
app.post("/api/devices/heartbeat", (req, res) => {
  const { id } = req.body;
  if (id) {
    const dev = devices.get(id);
    if (dev) {
      dev.lastSeen = Date.now();
      dev.isOnline = true;
    }
  }
  res.json({ success: true });
});
app.post("/api/devices/offline", (req, res) => {
  const { id } = req.body;
  if (id) {
    const dev = devices.get(id);
    if (dev) {
      dev.isOnline = false;
    }
    sseClients = sseClients.filter((c) => c.deviceId !== id);
    broadcast("devices", Array.from(devices.values()));
  }
  res.json({ success: true });
});
app.get("/api/stream", (req, res) => {
  const deviceId = req.query.deviceId;
  if (!deviceId) {
    res.status(400).send("deviceId query parameter is required");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });
  const client = { deviceId, res };
  sseClients.push(client);
  const dev = devices.get(deviceId);
  if (dev) {
    dev.lastSeen = Date.now();
    dev.isOnline = true;
    broadcast("devices", Array.from(devices.values()));
  }
  res.write(`data: ${JSON.stringify({ type: "connected" })}

`);
  res.write(`event: devices
data: ${JSON.stringify(Array.from(devices.values()))}

`);
  res.write(`event: activeCalls
data: ${JSON.stringify(Array.from(activeCalls.values()))}

`);
  const keepAliveInterval = setInterval(() => {
    res.write(":\n\n");
  }, 1e4);
  req.on("close", () => {
    clearInterval(keepAliveInterval);
    sseClients = sseClients.filter((c) => c !== client);
    setTimeout(() => {
      const isStillConnected = sseClients.some((c) => c.deviceId === deviceId);
      if (!isStillConnected) {
        const d = devices.get(deviceId);
        if (d) {
          d.isOnline = false;
          broadcast("devices", Array.from(devices.values()));
        }
      }
    }, 1e3);
  });
});
async function startServer() {
  const isProduction = process.env.NODE_ENV === "production" || process.argv[1] && (process.argv[1].includes("dist") || process.argv[1].endsWith("server.cjs"));
  if (!isProduction) {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
