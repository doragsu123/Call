import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

app.use(express.json());

// In-memory data structures
interface Device {
  id: string;
  name: string;
  lastSeen: number;
  isOnline: boolean;
  isDemo?: boolean;
}

interface Call {
  id: string;
  fromDeviceId: string;
  fromDeviceName: string;
  toDeviceId: string;
  toDeviceName: string;
  requirement: string;
  timestamp: number;
  status: "active" | "stopped";
  stoppedByDeviceName?: string;
}

const devices: Map<string, Device> = new Map();
const activeCalls: Map<string, Call> = new Map();

// SSE Clients
interface SSEClient {
  deviceId: string;
  res: express.Response;
}
let sseClients: SSEClient[] = [];

// Helper to broadcast to all SSE clients
function broadcast(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.res.write(payload);
    } catch (err) {
      console.error("Failed to write to client", client.deviceId, err);
    }
  });
}

// Clean up stale SSE connections and update online status
setInterval(() => {
  const now = Date.now();
  let changed = false;
  devices.forEach((device) => {
    // If device hasn't registered/sent heartbeat in 45 seconds, mark offline
    const isSseConnected = sseClients.some((c) => c.deviceId === device.id);
    const shouldBeOnline = isSseConnected || (now - device.lastSeen < 15000);
    if (device.isOnline !== shouldBeOnline) {
      device.isOnline = shouldBeOnline;
      changed = true;
    }
  });

  if (changed) {
    broadcast("devices", Array.from(devices.values()));
  }
}, 5000);

// API Endpoints

// Get current state
app.get("/api/state", (req, res) => {
  res.json({
    devices: Array.from(devices.values()),
    activeCalls: Array.from(activeCalls.values()),
  });
});

// Register or update device
app.post("/api/devices/register", (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) {
    res.status(400).json({ error: "Missing id or name" });
    return;
  }

  const existing = devices.get(id);
  const updatedDevice: Device = {
    id,
    name,
    lastSeen: Date.now(),
    isOnline: true,
  };
  
  devices.set(id, updatedDevice);
  
  // If device name changed, update names in active calls
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

// Create a new call
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

  // Generate unique call ID
  const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const newCall: Call = {
    id: callId,
    fromDeviceId,
    fromDeviceName: fromDevice.name,
    toDeviceId,
    toDeviceName: toDevice.name,
    requirement,
    timestamp: Date.now(),
    status: "active",
  };

  activeCalls.set(callId, newCall);

  // Broadcast update
  broadcast("call-created", newCall);
  broadcast("activeCalls", Array.from(activeCalls.values()));



  res.json({ success: true, call: newCall });
});

// Stop a call (bell stopped)
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
  const stopperName = stoppedByDevice ? stoppedByDevice.name : "誰か";

  call.status = "stopped";
  call.stoppedByDeviceName = stopperName;

  // Remove from active calls
  activeCalls.delete(callId);

  // Broadcast stop event
  broadcast("call-stopped", {
    callId,
    stoppedByDeviceId,
    stoppedByDeviceName: stopperName,
    callerDeviceId: call.fromDeviceId,
    recipientDeviceName: call.toDeviceName,
  });

  broadcast("activeCalls", Array.from(activeCalls.values()));

  res.json({ success: true });
});

// Heartbeat endpoint
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

// Explicit offline endpoint when tab/app is closed
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

// Real-time SSE Stream
app.get("/api/stream", (req, res) => {
  const deviceId = req.query.deviceId as string;
  if (!deviceId) {
    res.status(400).send("deviceId query parameter is required");
    return;
  }

  // Set headers for SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  // Register client
  const client: SSEClient = { deviceId, res };
  sseClients.push(client);

  // Mark device as online immediately
  const dev = devices.get(deviceId);
  if (dev) {
    dev.lastSeen = Date.now();
    dev.isOnline = true;
    broadcast("devices", Array.from(devices.values()));
  }

  // Send initial ping and data
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  res.write(`event: devices\ndata: ${JSON.stringify(Array.from(devices.values()))}\n\n`);
  res.write(`event: activeCalls\ndata: ${JSON.stringify(Array.from(activeCalls.values()))}\n\n`);

  // Keep-alive heartbeat to prevent timeouts
  const keepAliveInterval = setInterval(() => {
    res.write(":\n\n");
  }, 10000);

  // Connection close
  req.on("close", () => {
    clearInterval(keepAliveInterval);
    sseClients = sseClients.filter((c) => c !== client);
    
    // Set device offline after short delay unless they reconnect
    setTimeout(() => {
      const isStillConnected = sseClients.some((c) => c.deviceId === deviceId);
      if (!isStillConnected) {
        const d = devices.get(deviceId);
        if (d) {
          d.isOnline = false;
          broadcast("devices", Array.from(devices.values()));
        }
      }
    }, 1000);
  });
});

// Integrate Vite Dev Server or Production Build
async function startServer() {
  const isProduction = process.env.NODE_ENV === "production" || 
    (process.argv[1] && (process.argv[1].includes("dist") || process.argv[1].endsWith("server.cjs")));

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
