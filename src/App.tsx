import React, { useState, useEffect, useRef } from "react";
import { Device, Call } from "./types";
// @ts-ignore
import bellIcon from "./assets/images/family_bell_icon_1786708286221.jpg";
import { 
  Bell, 
  BellRing, 
  X, 
  Volume2, 
  VolumeX, 
  Home, 
  Plus, 
  Check, 
  Copy, 
  RotateCcw, 
  History, 
  User, 
  Smartphone, 
  Utensils, 
  Bath, 
  Sparkles, 
  Shirt, 
  MessageSquare, 
  AlertCircle, 
  ExternalLink,
  RefreshCw,
  BellOff
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Web Audio API Ding-Dong Chime (E5 -> C5)
function playDualChime() {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // First tone (E5, 659.25Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 1.2);

    // Second tone (C5, 523.25Hz) delayed by 0.4 seconds
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(523.25, now + 0.4);
    gain2.gain.setValueAtTime(0.001, now + 0.4);
    gain2.gain.linearRampToValueAtTime(0.2, now + 0.45);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.4);
    osc2.stop(now + 1.6);
  } catch (err) {
    console.error("Failed to play dual chime:", err);
  }
}

// Web Audio API Beep-Beep (A5, 880Hz)
function playNotificationBeep() {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(0.15, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.2);
    gain2.gain.setValueAtTime(0.001, now + 0.2);
    gain2.gain.linearRampToValueAtTime(0.15, now + 0.22);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.2);
    osc2.stop(now + 0.35);
  } catch (err) {
    console.error("Failed to play notification beep:", err);
  }
}



export default function App() {
  // Device registration state
  const [deviceId, setDeviceId] = useState<string>("");
  const [deviceName, setDeviceName] = useState<string>("");
  const [inputName, setInputName] = useState<string>("");
  const [isRegistered, setIsRegistered] = useState<boolean>(false);
  const [isRegistering, setIsRegistering] = useState<boolean>(false);

  // Sync state from server
  const [devices, setDevices] = useState<Device[]>([]);
  const [activeCalls, setActiveCalls] = useState<Call[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(true);

  // UI state
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedRequirement, setSelectedRequirement] = useState<string | null>(null);
  const [customRequirement, setCustomRequirement] = useState<string>("");
  const [isCalling, setIsCalling] = useState<boolean>(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState<boolean>(true);
  
  // Notification banner state
  const [stoppedNotification, setStoppedNotification] = useState<{
    message: string;
    id: number;
  } | null>(null);

  const [copied, setCopied] = useState<boolean>(false);

  // Auto-reconnect SSE ref
  const sseRef = useRef<EventSource | null>(null);

  // 1. Initialize Device ID & Device Name
  useEffect(() => {
    let currentId = localStorage.getItem("family_bell_device_id");
    if (!currentId) {
      currentId = `dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem("family_bell_device_id", currentId);
    }
    setDeviceId(currentId);

    const currentName = localStorage.getItem("family_bell_device_name");
    if (currentName) {
      setDeviceName(currentName);
      setInputName(currentName);
      setIsRegistered(true);
      // Register device automatically on the server
      registerDeviceOnServer(currentId, currentName);
    }
  }, []);

  // 2. Fetch initial state and configure Real-Time Connection (SSE)
  useEffect(() => {
    if (!deviceId || !deviceName || !isRegistered) return;

    // Load initial state
    fetch("/api/state")
      .then((res) => res.json())
      .then((data) => {
        setDevices(data.devices || []);
        setActiveCalls(data.activeCalls || []);
      })
      .catch((err) => console.error("Error fetching state:", err));

    // Connect Server-Sent Events (SSE)
    function connectSSE() {
      if (sseRef.current) {
        sseRef.current.close();
      }

      const es = new EventSource(`/api/stream?deviceId=${deviceId}`);
      sseRef.current = es;

      es.onopen = () => {
        setIsOnline(true);
      };

      es.onerror = () => {
        setIsOnline(false);
        // Try reconnecting in 5 seconds
        setTimeout(() => {
          if (isRegistered) connectSSE();
        }, 5000);
      };

      es.addEventListener("devices", (e: any) => {
        const data = JSON.parse(e.data);
        setDevices(data);
      });

      es.addEventListener("activeCalls", (e: any) => {
        const data = JSON.parse(e.data);
        setActiveCalls(data);
      });

      es.addEventListener("call-stopped", (e: any) => {
        const data = JSON.parse(e.data);
        // If this device was the one who sent the call, and the call was stopped by the recipient (not ourselves)
        if (data.callerDeviceId === deviceId && data.stoppedByDeviceId !== deviceId) {
          setStoppedNotification({
            message: `🔔 「${data.stoppedByDeviceName}」がベルを止めました！`,
            id: Date.now(),
          });
          if (isAudioEnabled) {
            playNotificationBeep();
          }
        }
      });
    }

    connectSSE();

    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      fetch("/api/devices/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deviceId }),
      }).catch((e) => console.warn("Heartbeat error", e));
    }, 10000);

    // Notify server immediately on close / unload
    const handleUnload = () => {
      if (deviceId) {
        fetch("/api/devices/offline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: deviceId }),
          keepalive: true,
        }).catch(() => {});
      }
    };

    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
      if (sseRef.current) {
        sseRef.current.close();
      }
    };
  }, [deviceId, deviceName, isRegistered]);

  // 3. Audio looping effect for active incoming call
  const myIncomingCall = activeCalls.find((call) => call.toDeviceId === deviceId && call.status === "active");

  useEffect(() => {
    let intervalId: any;
    if (myIncomingCall && isAudioEnabled) {
      // Play dual chime instantly
      playDualChime();
      // Repeat every 2.5 seconds
      intervalId = setInterval(() => {
        playDualChime();
      }, 2500);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [myIncomingCall, isAudioEnabled]);

  // 4. Register Device on Server Helper
  async function registerDeviceOnServer(id: string, name: string) {
    try {
      const res = await fetch("/api/devices/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      });
      if (!res.ok) throw new Error("Registration failed");
      const data = await res.json();
      return data;
    } catch (err) {
      console.error("Server registration failed:", err);
    }
  }

  // Handle register submission
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    const finalName = inputName.trim();
    if (!finalName) return;

    setIsRegistering(true);
    try {
      await registerDeviceOnServer(deviceId, finalName);
      localStorage.setItem("family_bell_device_name", finalName);
      setDeviceName(finalName);
      setIsRegistered(true);
    } catch (err) {
      console.error(err);
    } finally {
      setIsRegistering(false);
    }
  }



  // Handle call creation
  async function handleCall() {
    if (!selectedTargetId || !selectedRequirement) return;
    
    const reqText = selectedRequirement === "その他" ? customRequirement.trim() : selectedRequirement;
    if (!reqText) return;

    setIsCalling(true);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromDeviceId: deviceId,
          toDeviceId: selectedTargetId,
          requirement: reqText,
        }),
      });
      if (res.ok) {
        // Clear selection states upon success
        setSelectedRequirement(null);
        setCustomRequirement("");
        // Show short "Calling" visual feedback
        setTimeout(() => setIsCalling(false), 500);
      } else {
        setIsCalling(false);
      }
    } catch (err) {
      console.error(err);
      setIsCalling(false);
    }
  }

  // Handle call stopping (receiver side)
  async function handleStopCall(callId: string) {
    try {
      await fetch("/api/calls/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId,
          stoppedByDeviceId: deviceId,
        }),
      });
    } catch (err) {
      console.error(err);
    }
  }

  // Reset or change device name
  function handleResetDevice() {
    if (confirm("端末の名前を再設定しますか？")) {
      localStorage.removeItem("family_bell_device_name");
      setInputName(deviceName);
      setDeviceName("");
      setIsRegistered(false);
    }
  }

  // Copy app URL to clipboard for multi-device testing
  function handleCopyUrl() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Dismiss notification toast
  function handleDismissNotification() {
    setStoppedNotification(null);
  }

  // Filter out current device and offline devices from display targets
  const otherDevices = devices.filter((d) => d.id !== deviceId && d.isOnline);

  // Filter active calls made BY this device
  const myOutgoingCall = activeCalls.find((call) => call.fromDeviceId === deviceId && call.status === "active");

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-neutral-800 font-sans selection:bg-[#F2DFD3] selection:text-neutral-900 pb-12 transition-all duration-300">
      
      {/* 1. REGISTRATION STATE (Not registered) */}
      {!isRegistered ? (
        <div id="registration-view" className="flex items-center justify-center min-h-screen px-4 py-8">
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-neutral-100 p-8 md:p-10 text-center"
          >
            <div className="inline-flex mb-6 overflow-hidden rounded-full border-4 border-[#FDF5E6] shadow-md bg-white">
              <motion.img 
                src={bellIcon} 
                alt="Family Bell" 
                referrerPolicy="no-referrer"
                className="w-24 h-24 object-cover"
                animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut", repeatDelay: 1.5 }}
              />
            </div>

            <h1 className="text-3xl font-extrabold tracking-tight mb-2 text-[#3E2723]">
              家族呼び出しベル
            </h1>
            <p className="text-sm text-neutral-500 mb-8 max-w-sm mx-auto leading-relaxed">
              まずは、このスマートフォンやタブレットにあなたの名前を登録しましょう。
            </p>

            {/* Large text input */}
            <form onSubmit={handleRegister} className="space-y-6">
              <div className="text-left">
                <label htmlFor="device-name" className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
                  端末の名前を入力してください
                </label>
                <input
                  id="device-name"
                  type="text"
                  required
                  placeholder="例: お父さん、お母さん、太郎"
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  className="w-full text-center px-4 py-4 text-2xl font-bold bg-neutral-50 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-[#E67E22] transition-all placeholder:text-neutral-300 placeholder:font-normal"
                />
              </div>

              <button
                id="submit-name-btn"
                type="submit"
                disabled={!inputName.trim() || isRegistering}
                className="w-full py-4 bg-[#E67E22] hover:bg-[#D35400] text-white font-bold text-lg rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isRegistering ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    この名前で登録する
                  </>
                )}
              </button>
            </form>
          </motion.div>
        </div>
      ) : (
        
        /* 2. MAIN COZY DASHBOARD (Registered) */
        <div id="main-dashboard" className="max-w-4xl mx-auto px-4 pt-3 pb-3">
          
          {/* Header Bar */}
          <header className="flex items-center justify-between bg-white/70 backdrop-blur-md border border-neutral-100 rounded-2xl px-4 py-2.5 mb-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-1.5 bg-[#FDF5E6] rounded-xl text-[#E67E22]">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-extrabold text-base tracking-tight text-neutral-800">
                  家族呼び出しベル
                </h1>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-500 animate-pulse" : "bg-neutral-300"}`} />
                  <span className="text-[9px] font-medium text-neutral-400">
                    {isOnline ? "オンライン" : "オフライン（接続中）"}
                  </span>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              <button
                id="audio-toggle"
                onClick={() => setIsAudioEnabled(!isAudioEnabled)}
                className={`p-1.5 rounded-lg transition-all border ${
                  isAudioEnabled 
                    ? "bg-[#FDF5E6] text-[#E67E22] border-[#FBE3CC]" 
                    : "bg-neutral-50 text-neutral-400 border-neutral-100"
                }`}
                title={isAudioEnabled ? "通知音をミュート" : "通知音を有効化"}
              >
                {isAudioEnabled ? <Volume2 className="w-4.5 h-4.5" /> : <VolumeX className="w-4.5 h-4.5" />}
              </button>

              <button
                id="current-device-badge"
                onClick={handleResetDevice}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-lg text-xs font-bold text-neutral-700 transition-all cursor-pointer"
                title="名前を変更する"
              >
                <User className="w-3 h-3 text-neutral-400" />
                <span className="max-w-[80px] truncate">{deviceName}</span>
              </button>
            </div>
          </header>

          {/* Alert Toasts (Someone stopped our bell) */}
          <AnimatePresence>
            {stoppedNotification && (
              <motion.div
                key={stoppedNotification.id}
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                id="call-stopped-banner"
                className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6 shadow-md flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 text-emerald-800">
                  <span className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg animate-bounce">
                    <Check className="w-5 h-5" />
                  </span>
                  <p className="font-bold text-sm md:text-base leading-snug">
                    {stoppedNotification.message}
                  </p>
                </div>
                <button
                  id="dismiss-toast-btn"
                  onClick={handleDismissNotification}
                  className="p-1.5 hover:bg-emerald-100 rounded-lg text-emerald-600 transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Active Outgoing Call Overlay (Self-originated active call) */}
          <AnimatePresence>
            {myOutgoingCall && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                id="outgoing-call-indicator"
                className="bg-[#FFF8F0] border border-[#FBE3CC] rounded-2xl p-6 mb-6 shadow-md text-center relative overflow-hidden"
              >
                {/* Rippling radar animation behind */}
                <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                  <div className="w-24 h-24 bg-[#E67E22] rounded-full animate-ping" />
                </div>

                <div className="relative z-10 flex flex-col items-center">
                  <div className="p-3 bg-orange-100 text-[#E67E22] rounded-full mb-3 animate-pulse">
                    <BellRing className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-extrabold text-[#E67E22] mb-1">
                    「{myOutgoingCall.toDeviceName.replace(" (シミュレータ)", "")}」を呼び出し中
                  </h3>
                  <p className="text-sm font-semibold text-neutral-500 mb-4">
                    要件: {myOutgoingCall.requirement}
                  </p>
                  
                  <button
                    id="cancel-call-btn"
                    onClick={() => handleStopCall(myOutgoingCall.id)}
                    className="px-5 py-2.5 bg-neutral-200 hover:bg-neutral-300 text-neutral-700 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    呼び出しをキャンセル
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* MAIN COLUMN */}
          <main className="space-y-4">
            
            {/* 2A. Recipient Device Grid (端末の名前が確定したら呼び出し対象の名前が大きく並んでいて) */}
            <section id="recipient-selection">
              <h2 className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-3.5 flex items-center gap-2">
                <span>呼び出し相手を選択</span>
                <span className="h-[1px] flex-1 bg-neutral-100" />
              </h2>

              {otherDevices.length === 0 ? (
                /* No other devices view */
                <div className="bg-white border border-neutral-100 rounded-2xl p-6 text-center shadow-sm">
                  <AlertCircle className="w-8 h-8 text-[#E67E22] mx-auto mb-3" />
                  <p className="font-bold text-neutral-700 text-lg mb-1">
                    対象がいません
                  </p>
                  <p className="text-xs text-neutral-400 max-w-md mx-auto leading-relaxed mb-5">
                    別のスマートフォンやパソコンでこのアプリのURLを開き、お名前を登録するとここに呼び出し対象の名前が表示されます。
                  </p>

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-2 max-w-sm mx-auto">
                    <button
                      id="copy-app-url-btn"
                      onClick={handleCopyUrl}
                      className="w-full sm:w-auto px-4 py-2.5 bg-[#FAF9F6] hover:bg-[#F5F2EB] border border-neutral-200 text-xs font-bold text-neutral-700 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-neutral-400" />}
                      {copied ? "URLをコピーしました！" : "アプリのURLをコピー"}
                    </button>
                  </div>
                </div>
              ) : (
                /* Big button list of target devices */
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
                  {otherDevices.map((device) => {
                    const isSelected = selectedTargetId === device.id;
                    const isActiveTarget = activeCalls.some((c) => c.toDeviceId === device.id && c.status === "active");
                    return (
                      <button
                        key={device.id}
                        id={`target-device-${device.id}`}
                        onClick={() => {
                          setSelectedTargetId(isSelected ? null : device.id);
                          setSelectedRequirement(null); // reset requirement selection
                          setCustomRequirement("");
                        }}
                        className={`group relative text-center py-4 px-3 rounded-xl border transition-all duration-300 shadow-sm cursor-pointer flex flex-col items-center justify-center ${
                          isSelected 
                            ? "bg-[#FDF5E6] text-[#E67E22] border-[#E67E22] ring-2 ring-[#E67E22]/10" 
                            : "bg-white hover:bg-neutral-50/50 text-neutral-700 border-neutral-200 hover:border-neutral-300"
                        }`}
                      >
                        {/* Status indicators */}
                        <div className="absolute top-2 right-2 flex items-center gap-1.5">
                          {device.isOnline ? (
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" title="オンライン" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-neutral-300" title="オフライン" />
                          )}
                        </div>

                        {/* Icon */}
                        <div className={`p-2.5 rounded-full mb-2 transition-all duration-300 ${
                          isSelected 
                            ? "bg-white text-[#E67E22] shadow-sm" 
                            : "bg-neutral-50 text-neutral-400 group-hover:bg-neutral-100"
                        }`}>
                          {isActiveTarget ? (
                            <BellRing className="w-5 h-5 text-[#E67E22] animate-pulse" />
                          ) : (
                            <User className="w-5 h-5" />
                          )}
                        </div>

                        {/* Large name */}
                        <span className="font-extrabold text-sm md:text-base tracking-tight truncate max-w-full">
                          {device.name.replace(" (シミュレータ)", "")}
                        </span>

                        {device.isDemo && (
                          <span className="mt-1 px-1.5 py-0.5 bg-[#FAF2EB] text-[#E67E22] text-[9px] font-bold rounded">
                            シミュレータ
                          </span>
                        )}

                        {!device.isOnline && !device.isDemo && (
                          <span className="mt-1 text-[9px] text-neutral-400 font-semibold">
                            応答不能
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 2B. Requirements selector (そこをクリックしたら要件が出てきて) */}
            <AnimatePresence>
              {selectedTargetId && (
                <motion.section
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  id="requirement-selection"
                  className="overflow-hidden"
                >
                  <div className="bg-white border border-neutral-200 rounded-2xl p-5 md:p-6 shadow-sm mt-2">
                    
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-neutral-100">
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-neutral-800">
                          {devices.find((d) => d.id === selectedTargetId)?.name.replace(" (シミュレータ)", "")}
                        </span>
                        <span className="text-neutral-400 text-xs">さんへの要件を選択</span>
                      </div>
                      <button
                        id="deselect-device-btn"
                        onClick={() => {
                          setSelectedTargetId(null);
                          setSelectedRequirement(null);
                          setCustomRequirement("");
                        }}
                        className="p-1 hover:bg-neutral-50 rounded-lg text-neutral-400 hover:text-neutral-600 transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Requirement buttons list */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-5">
                      
                      {/* ご飯 */}
                      <button
                        id="req-gohan"
                        onClick={() => setSelectedRequirement("ご飯")}
                        className={`py-3.5 px-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-xs font-bold cursor-pointer ${
                          selectedRequirement === "ご飯"
                            ? "bg-[#FAF2EB] text-[#E67E22] border-[#E67E22] shadow-sm"
                            : "bg-neutral-50 text-neutral-600 border-neutral-100 hover:bg-neutral-100/50"
                        }`}
                      >
                        <Utensils className="w-5 h-5 text-amber-500" />
                        ご飯
                      </button>

                      {/* 風呂入って */}
                      <button
                        id="req-furo-hairu"
                        onClick={() => setSelectedRequirement("風呂入って")}
                        className={`py-3.5 px-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-xs font-bold cursor-pointer ${
                          selectedRequirement === "風呂入って"
                            ? "bg-[#FAF2EB] text-[#E67E22] border-[#E67E22] shadow-sm"
                            : "bg-neutral-50 text-neutral-600 border-neutral-100 hover:bg-neutral-100/50"
                        }`}
                      >
                        <Bath className="w-5 h-5 text-blue-500" />
                        風呂入って
                      </button>

                      {/* 風呂洗って */}
                      <button
                        id="req-furo-arau"
                        onClick={() => setSelectedRequirement("風呂洗って")}
                        className={`py-3.5 px-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-xs font-bold cursor-pointer ${
                          selectedRequirement === "風呂洗って"
                            ? "bg-[#FAF2EB] text-[#E67E22] border-[#E67E22] shadow-sm"
                            : "bg-neutral-50 text-neutral-600 border-neutral-100 hover:bg-neutral-100/50"
                        }`}
                      >
                        <Sparkles className="w-5 h-5 text-emerald-500" />
                        風呂洗って
                      </button>

                      {/* 洗濯手伝って */}
                      <button
                        id="req-sentaku"
                        onClick={() => setSelectedRequirement("洗濯手伝って")}
                        className={`py-3.5 px-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-xs font-bold cursor-pointer ${
                          selectedRequirement === "洗濯手伝って"
                            ? "bg-[#FAF2EB] text-[#E67E22] border-[#E67E22] shadow-sm"
                            : "bg-neutral-50 text-neutral-600 border-neutral-100 hover:bg-neutral-100/50"
                        }`}
                      >
                        <Shirt className="w-5 h-5 text-purple-500" />
                        洗濯手伝って
                      </button>

                      {/* その他 */}
                      <button
                        id="req-sonota"
                        onClick={() => setSelectedRequirement("その他")}
                        className={`py-3.5 px-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-xs font-bold col-span-2 md:col-span-1 cursor-pointer ${
                          selectedRequirement === "その他"
                            ? "bg-[#FAF2EB] text-[#E67E22] border-[#E67E22] shadow-sm"
                            : "bg-neutral-50 text-neutral-600 border-neutral-100 hover:bg-neutral-100/50"
                        }`}
                      >
                        <MessageSquare className="w-5 h-5 text-teal-500" />
                        その他
                      </button>

                    </div>

                    {/* Custom requirement text input (その他の場合入力して) */}
                    <AnimatePresence>
                      {selectedRequirement === "その他" && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mb-5 overflow-hidden"
                        >
                          <label htmlFor="custom-requirement-input" className="block text-xs font-bold text-neutral-400 mb-1.5">
                            具体的な要件を入力してください
                          </label>
                          <input
                            id="custom-requirement-input"
                            type="text"
                            required
                            placeholder="例: ゴミ出しして、買い物おねがい 等"
                            value={customRequirement}
                            onChange={(e) => setCustomRequirement(e.target.value)}
                            className="w-full px-3.5 py-3.5 bg-neutral-50 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-[#E67E22] focus:border-[#E67E22] text-sm font-semibold text-neutral-800 transition-all placeholder:text-neutral-300"
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Call triggering button (並んでいる要件の下の呼び出すボタンをクリックすることで呼び出しする感じ) */}
                    <button
                      id="trigger-call-btn"
                      onClick={handleCall}
                      disabled={
                        isCalling || 
                        !selectedRequirement || 
                        (selectedRequirement === "その他" && !customRequirement.trim())
                      }
                      className="w-full py-4 bg-[#E67E22] hover:bg-[#D35400] text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <BellRing className={`w-5 h-5 ${isCalling ? "animate-spin" : ""}`} />
                      <span>
                        {isCalling 
                          ? "呼び出しを送信中..." 
                          : `${devices.find((d) => d.id === selectedTargetId)?.name.replace(" (シミュレータ)", "")} を呼び出す`}
                      </span>
                    </button>

                  </div>
                </motion.section>
              )}
            </AnimatePresence>

          </main>
        </div>
      )}

      {/* 3. INCOMING CALL SCREEN (呼び出される側は呼び出し要件が大きく表示されて呼び出し停止ボタンを押したら停止される感じです) */}
      <AnimatePresence>
        {myIncomingCall && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            id="incoming-call-overlay"
            className="fixed inset-0 bg-[#D35400] z-50 flex items-center justify-center p-4 text-white overflow-y-auto"
          >
            {/* Visual background pulsation effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#E67E22] to-[#C0392B] opacity-90" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <motion.div 
                animate={{ scale: [1, 1.4, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="w-80 h-80 bg-white/5 rounded-full"
              />
              <motion.div 
                animate={{ scale: [1, 1.8, 1] }}
                transition={{ repeat: Infinity, duration: 2, delay: 0.5 }}
                className="w-[500px] h-[500px] bg-white/5 rounded-full"
              />
            </div>

            <div className="relative z-10 w-full max-w-xl text-center flex flex-col items-center">
              
              {/* Dynamic vibrating bell ring */}
              <motion.div
                animate={{ rotate: [-8, 8, -8] }}
                transition={{ repeat: Infinity, duration: 0.4 }}
                className="mb-8 p-6 bg-white/10 rounded-full border border-white/20 shadow-lg text-white"
              >
                <BellRing className="w-16 h-16" />
              </motion.div>

              {/* Sender info */}
              <div className="mb-4">
                <span className="inline-block px-4 py-1.5 bg-white/10 border border-white/20 rounded-full text-sm font-bold tracking-wider text-[#FFEBEE]">
                  {myIncomingCall.fromDeviceName.replace(" (シミュレータ)", "")} からの呼び出し
                </span>
              </div>

              {/* Requirement displayed in huge typography (呼び出し要件が大きく表示されて) */}
              <h2 className="text-5xl md:text-7xl font-black mb-10 tracking-tight leading-tight drop-shadow-md break-all px-4">
                {myIncomingCall.requirement}
              </h2>

              {/* Large tactile "Stop Call" button (呼び出し停止ボタンを押したら停止される感じです) */}
              <button
                id="stop-call-btn"
                onClick={() => handleStopCall(myIncomingCall.id)}
                className="w-full max-w-sm py-5 px-6 bg-white hover:bg-neutral-50 text-red-600 hover:text-red-700 font-extrabold text-xl md:text-2xl rounded-2xl shadow-2xl transition-all duration-200 transform hover:scale-[1.02] flex items-center justify-center gap-3 cursor-pointer"
              >
                <BellOff className="w-6 h-6 md:w-8 md:h-8" />
                <span>ベルを止める</span>
              </button>

              {/* Optional audio mute helper inside incoming overlay */}
              {!isAudioEnabled && (
                <p className="text-xs text-white/60 mt-6 flex items-center gap-1">
                  <VolumeX className="w-3.5 h-3.5" />
                  端末の音量がミュートになっています
                </p>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
