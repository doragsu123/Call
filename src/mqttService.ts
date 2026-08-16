import Paho from "paho-mqtt";
import { Device, Call } from "./types";

// Setup public secure MQTT broker
const MQTT_HOST = "broker.hivemq.com";
const MQTT_PORT = 8884;

export class MqttService {
  private client: Paho.Client | null = null;
  private familyGroupCode: string = "";
  private deviceId: string = "";
  private deviceName: string = "";
  private isConnected: boolean = false;

  // Local synchronized state caches
  private devicesMap: Map<string, Device> = new Map();
  private activeCallsMap: Map<string, Call> = new Map();

  // Callbacks for React state synchronization
  private onDevicesUpdated: (devices: Device[]) => void = () => {};
  private onCallsUpdated: (calls: Call[]) => void = () => {};
  private onCallStopped: (info: { stoppedByDeviceName: string; stoppedByDeviceId: string; callerDeviceId: string }) => void = () => {};
  private onConnectionStatusChanged: (isOnline: boolean) => void = () => {};

  private heartbeatTimer: any = null;
  private cleanOfflineTimer: any = null;

  constructor(
    deviceId: string,
    deviceName: string,
    familyGroupCode: string,
    callbacks: {
      onDevicesUpdated: (devices: Device[]) => void;
      onCallsUpdated: (calls: Call[]) => void;
      onCallStopped: (info: { stoppedByDeviceName: string; stoppedByDeviceId: string; callerDeviceId: string }) => void;
      onConnectionStatusChanged: (isOnline: boolean) => void;
    }
  ) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.familyGroupCode = familyGroupCode;
    this.onDevicesUpdated = callbacks.onDevicesUpdated;
    this.onCallsUpdated = callbacks.onCallsUpdated;
    this.onCallStopped = callbacks.onCallStopped;
    this.onConnectionStatusChanged = callbacks.onConnectionStatusChanged;
  }

  public updateCredentials(deviceName: string, familyGroupCode: string) {
    const codeChanged = this.familyGroupCode !== familyGroupCode;
    this.deviceName = deviceName;
    this.familyGroupCode = familyGroupCode;

    if (codeChanged && this.isConnected) {
      // Reconnect with new group subscriptions
      this.disconnect();
      this.connect();
    } else {
      // Just publish name update
      this.publishPresence();
    }
  }

  public connect() {
    if (this.client) {
      this.disconnect();
    }

    const uniqueClientId = `fambell_${this.deviceId}_${Math.random().toString(36).substring(2, 6)}`;
    
    // Create Paho Client
    this.client = new Paho.Client(MQTT_HOST, MQTT_PORT, uniqueClientId);

    // Event listeners
    this.client.onConnectionLost = (responseObject) => {
      console.warn("MQTT connection lost:", responseObject.errorMessage);
      this.isConnected = false;
      this.onConnectionStatusChanged(false);
      this.stopHeartbeats();
      
      // Attempt reconnection in 4 seconds
      setTimeout(() => {
        if (!this.isConnected && this.client) {
          this.connect();
        }
      }, 4000);
    };

    this.client.onMessageArrived = (message) => {
      this.handleIncomingMessage(message.destinationName, message.payloadString);
    };

    // Connect options
    this.client.connect({
      useSSL: true,
      keepAliveInterval: 30,
      onSuccess: () => {
        console.log("Connected to secure MQTT broker successfully.");
        this.isConnected = true;
        this.onConnectionStatusChanged(true);

        // Subscribe to presence of all family devices and calls
        const presenceTopic = `family_bell/${this.familyGroupCode}/presence/+`;
        const callsTopic = `family_bell/${this.familyGroupCode}/calls`;

        this.client?.subscribe(presenceTopic);
        this.client?.subscribe(callsTopic);

        // Immediately broadcast our presence
        this.publishPresence();
        this.startHeartbeats();
      },
      onFailure: (err) => {
        console.error("MQTT connection failed:", err.errorMessage);
        this.isConnected = false;
        this.onConnectionStatusChanged(false);
        
        // Retry connection in 5 seconds
        setTimeout(() => {
          if (!this.isConnected) this.connect();
        }, 5000);
      }
    });

    // Start local timer to clean up offline peers (no heartbeat received for > 15 seconds)
    this.startOfflineCleaner();
  }

  public disconnect() {
    this.stopHeartbeats();
    this.stopOfflineCleaner();
    if (this.client && this.isConnected) {
      try {
        // Send a final offline message before disconnecting
        const offlinePayload = JSON.stringify({
          id: this.deviceId,
          name: this.deviceName,
          lastSeen: 0,
          isOnline: false
        });
        const msg = new Paho.Message(offlinePayload);
        msg.destinationName = `family_bell/${this.familyGroupCode}/presence/${this.deviceId}`;
        this.client.send(msg);

        this.client.disconnect();
      } catch (err) {
        console.error("Error during graceful disconnect", err);
      }
    }
    this.client = null;
    this.isConnected = false;
    this.onConnectionStatusChanged(false);
  }

  // Publish presence heartbeat
  private publishPresence() {
    if (!this.client || !this.isConnected || !this.deviceName) return;

    try {
      const presencePayload = JSON.stringify({
        id: this.deviceId,
        name: this.deviceName,
        lastSeen: Date.now(),
        isOnline: true
      });

      const message = new Paho.Message(presencePayload);
      message.destinationName = `family_bell/${this.familyGroupCode}/presence/${this.deviceId}`;
      // QOS 0 is perfect for rapid heartbeat updates
      message.qos = 0;
      this.client.send(message);
    } catch (err) {
      console.error("Failed to publish presence heartbeat:", err);
    }
  }

  // Start periodic 5-second heartbeats
  private startHeartbeats() {
    this.stopHeartbeats();
    this.heartbeatTimer = setInterval(() => {
      this.publishPresence();
    }, 5000);
  }

  private stopHeartbeats() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Periodically sweep devices map to remove expired devices (heartbeat missing for > 15s)
  private startOfflineCleaner() {
    this.stopOfflineCleaner();
    this.cleanOfflineTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;

      this.devicesMap.forEach((device, key) => {
        // If device has lastSeen = 0 (gracefully left) or lastSeen is older than 15 seconds, mark offline
        if (!device.isOnline || (device.lastSeen > 0 && now - device.lastSeen > 15000)) {
          if (device.isOnline) {
            device.isOnline = false;
            changed = true;
          }
        }
      });

      if (changed) {
        this.triggerDevicesUpdated();
      }
    }, 5000);
  }

  private stopOfflineCleaner() {
    if (this.cleanOfflineTimer) {
      clearInterval(this.cleanOfflineTimer);
      this.cleanOfflineTimer = null;
    }
  }

  // Send a call payload to the peer devices
  public makeCall(toDeviceId: string, toDeviceName: string, requirement: string) {
    if (!this.client || !this.isConnected) return;

    try {
      const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const callPayload = JSON.stringify({
        type: "start_call",
        id: callId,
        fromDeviceId: this.deviceId,
        fromDeviceName: this.deviceName,
        toDeviceId,
        toDeviceName,
        requirement,
        timestamp: Date.now(),
        status: "active"
      });

      const message = new Paho.Message(callPayload);
      message.destinationName = `family_bell/${this.familyGroupCode}/calls`;
      message.qos = 1; // Make sure call signaling is received reliably (QOS 1)
      this.client.send(message);
    } catch (err) {
      console.error("Failed to publish call:", err);
    }
  }

  // Send a stop call payload to clear the ring state
  public stopCall(callId: string) {
    if (!this.client || !this.isConnected) return;

    try {
      const stopPayload = JSON.stringify({
        type: "stop_call",
        id: callId,
        stoppedByDeviceName: this.deviceName,
        stoppedByDeviceId: this.deviceId,
        fromDeviceId: this.deviceId // Helper to verify caller
      });

      const message = new Paho.Message(stopPayload);
      message.destinationName = `family_bell/${this.familyGroupCode}/calls`;
      message.qos = 1;
      this.client.send(message);
    } catch (err) {
      console.error("Failed to publish stop call:", err);
    }
  }

  // Handle incoming payloads from the broker
  private handleIncomingMessage(topic: string, payload: string) {
    try {
      const data = JSON.parse(payload);

      // 1. Presence Topic
      if (topic.includes("/presence/")) {
        const peerDeviceId = topic.substring(topic.lastIndexOf("/") + 1);
        
        // Skip updating ourselves from our own broker echoed messages
        if (peerDeviceId === this.deviceId) return;

        if (data.isOnline === false || data.lastSeen === 0) {
          // Peer gracefully left
          this.devicesMap.delete(peerDeviceId);
        } else {
          // Update or insert peer
          this.devicesMap.set(peerDeviceId, {
            id: data.id,
            name: data.name,
            lastSeen: data.lastSeen,
            isOnline: true
          });
        }
        this.triggerDevicesUpdated();
      }

      // 2. Call Signaling Topic
      else if (topic.endsWith("/calls")) {
        if (data.type === "start_call") {
          const newCall: Call = {
            id: data.id,
            fromDeviceId: data.fromDeviceId,
            fromDeviceName: data.fromDeviceName,
            toDeviceId: data.toDeviceId,
            toDeviceName: data.toDeviceName,
            requirement: data.requirement,
            timestamp: data.timestamp,
            status: "active"
          };
          this.activeCallsMap.set(data.id, newCall);
          this.triggerCallsUpdated();
        } 
        
        else if (data.type === "stop_call") {
          const existingCall = this.activeCallsMap.get(data.id);
          if (existingCall) {
            this.activeCallsMap.delete(data.id);
            this.triggerCallsUpdated();

            // Trigger visual notification toast if we were the caller
            if (existingCall.fromDeviceId === this.deviceId) {
              this.onCallStopped({
                stoppedByDeviceName: data.stoppedByDeviceName || "受信者",
                stoppedByDeviceId: data.stoppedByDeviceId || "",
                callerDeviceId: existingCall.fromDeviceId
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("Error parsing MQTT payload", err, topic, payload);
    }
  }

  private triggerDevicesUpdated() {
    const list = Array.from(this.devicesMap.values());
    this.onDevicesUpdated(list);
  }

  private triggerCallsUpdated() {
    const list = Array.from(this.activeCallsMap.values());
    this.onCallsUpdated(list);
  }
}
