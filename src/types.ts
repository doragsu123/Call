export interface Device {
  id: string;
  name: string;
  lastSeen: number;
  isOnline: boolean;
}

export interface Call {
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
