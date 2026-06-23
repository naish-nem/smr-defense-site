import type { DeviceActivityRecord, DeviceStreamState, DeviceTrailPoint } from "../domain/types";

export const deviceStreams: DeviceStreamState[] = [
  {
    machineId: "M-UAV-01",
    availability: "live_ready",
    protocol: "hls",
    label: "DJI Cloud live-stream bridge",
    sessionRef: "dji-cloud://SITE-FPR-01/M-UAV-01/camera-0/zoom-0",
    qualityLabel: "browser proxy from vendor stream",
    latencyMs: 650,
    uplinkKbps: 1500,
    retentionClass: "incident_record",
    source: "authored",
    note: "DJI exposes live stream paths through its cloud/dock stack; FleetBrain should store stream metadata and proxy to browser-compatible playback without claiming direct WHIP support."
  },
  {
    machineId: "M-UGV-01",
    availability: "standby",
    protocol: "hls",
    label: "Unitree edge media bridge",
    sessionRef: "edge-media://SITE-FPR-01/M-UGV-01/front",
    qualityLabel: "edge-converted robot view",
    latencyMs: 320,
    uplinkKbps: 900,
    retentionClass: "shift_record",
    source: "authored",
    note: "Unitree robot video should originate from the LAN/SDK/ROS side; a site gateway can convert it to WebRTC or HLS for the browser when a real stream is connected."
  },
  {
    machineId: "M-FIXED-01",
    availability: "recorded_only",
    protocol: "rtsp-bridge",
    label: "Thermal/fixed camera bridge",
    sessionRef: "rtsp-bridge://SITE-FPR-01/M-FIXED-01/thermal-north",
    qualityLabel: "event clips and still frames",
    latencyMs: 1200,
    uplinkKbps: 512,
    retentionClass: "incident_record",
    source: "authored",
    note: "Fixed sensor data is represented as event clips/stills in the evidence store, not a continuously retained dump."
  },
  {
    machineId: "M-SCADA-01",
    availability: "unavailable",
    protocol: "none",
    label: "SCADA telemetry only",
    retentionClass: "shift_record",
    source: "telemetry",
    note: "No video stream. Store sampled telemetry, alarm states, and signed activity records."
  }
];

export const deviceTrail: DeviceTrailPoint[] = [
  point("M-UAV-01", "2026-06-18T08:05:00-07:00", 98, 38, "Z-BESS", "observed", "artifact"),
  point("M-UAV-01", "2026-06-18T08:20:00-07:00", 96, 66, "Z-SWITCHGEAR", "observed", "artifact"),
  point("M-UAV-01", "2026-06-18T08:28:00-07:00", 45, 72, "Z-SOLAR", "observed", "artifact"),
  point("M-UAV-01", "2026-06-18T22:18:00-07:00", 20, 24, "Z-PERIMETER", "observed", "artifact"),
  point("M-UGV-01", "2026-06-18T08:36:00-07:00", 20, 52, "Z-LOAD-DOCK", "observed", "artifact"),
  point("M-UGV-01", "2026-06-18T10:17:00-07:00", 35, 55, "Z-LOAD-DOCK", "blocked", "telemetry"),
  point("M-UGV-01", "2026-06-18T11:28:00-07:00", 26, 58, "Z-LOAD-DOCK", "observed", "artifact"),
  point("M-UGV-01", "2026-06-19T06:00:00.000Z", 20, 24, "Z-PERIMETER", "simulated", "simulated"),
  point("M-FIXED-01", "2026-06-18T08:12:00-07:00", 88, 38, "Z-BESS", "observed", "telemetry"),
  point("M-FIXED-01", "2026-06-18T22:13:00-07:00", 18, 22, "Z-PERIMETER", "observed", "telemetry"),
  point("M-SCADA-01", "2026-06-18T08:41:00-07:00", 100, 72, "Z-SWITCHGEAR", "observed", "telemetry")
];

export const deviceActivity: DeviceActivityRecord[] = [
  activity(
    "act-uav-001",
    "M-UAV-01",
    "2026-06-18T08:05:00-07:00",
    "capture",
    "BESS row image retained",
    "RGB inspection frame kept as accepted coverage.",
    "Z-BESS",
    "/assets/drone-inspection.png",
    "a6b21e74",
    "artifact"
  ),
  activity(
    "act-uav-002",
    "M-UAV-01",
    "2026-06-18T08:28:00-07:00",
    "capture",
    "Solar soiling candidate",
    "Panel row image retained for review, not auto-closed.",
    "Z-SOLAR",
    "/assets/drone-inspection.png",
    "bb09d113",
    "artifact"
  ),
  activity(
    "act-uav-003",
    "M-UAV-01",
    "2026-06-18T22:18:00-07:00",
    "stream",
    "Perimeter re-pass clip",
    "Live-capable DJI stream path associated with retained south-gate frame.",
    "Z-PERIMETER",
    "/assets/drone-inspection.png",
    "f02e9a31",
    "authored"
  ),
  activity(
    "act-ugv-001",
    "M-UGV-01",
    "2026-06-18T08:36:00-07:00",
    "capture",
    "Dock seal walkdown",
    "Quadruped image retained for load-dock seal review.",
    "Z-LOAD-DOCK",
    "/assets/quadruped-inspection.png",
    "6cd34a21",
    "artifact"
  ),
  activity(
    "act-ugv-002",
    "M-UGV-01",
    "2026-06-18T10:17:00-07:00",
    "mission",
    "Switchgear path blocked",
    "Robot did not complete the planned switchgear access pass.",
    "Z-LOAD-DOCK",
    undefined,
    "2aa4cf90",
    "telemetry"
  ),
  activity(
    "act-ugv-003",
    "M-UGV-01",
    "2026-06-19T06:00:00.000Z",
    "stream",
    "Verification stream bridge",
    "Opening the device should request a gateway-brokered browser stream while mission telemetry is sampled.",
    "Z-PERIMETER",
    undefined,
    "d90577ac",
    "simulated"
  ),
  activity(
    "act-fixed-001",
    "M-FIXED-01",
    "2026-06-18T08:12:00-07:00",
    "telemetry",
    "Thermal threshold crossed",
    "Thermal reading became needs-review evidence for the BESS zone.",
    "Z-BESS",
    "/assets/thermal-anomaly.png",
    "58f74d0d",
    "telemetry"
  ),
  activity(
    "act-fixed-002",
    "M-FIXED-01",
    "2026-06-18T22:13:00-07:00",
    "telemetry",
    "South gate motion trigger",
    "Fixed camera trigger opened the perimeter review sequence.",
    "Z-PERIMETER",
    undefined,
    "cc7492b0",
    "telemetry"
  ),
  activity(
    "act-scada-001",
    "M-SCADA-01",
    "2026-06-18T08:41:00-07:00",
    "telemetry",
    "BESS string delta elevated",
    "RTU sample retained in the shift record with freshness metadata.",
    undefined,
    undefined,
    "99db3ef1",
    "telemetry"
  )
];

export function streamForMachine(machineId: string): DeviceStreamState | undefined {
  return deviceStreams.find((stream) => stream.machineId === machineId);
}

export function trailForMachine(machineId: string): DeviceTrailPoint[] {
  return deviceTrail
    .filter((point) => point.machineId === machineId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function activityForMachine(machineId: string): DeviceActivityRecord[] {
  return deviceActivity
    .filter((record) => record.machineId === machineId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

function point(
  machineId: string,
  at: string,
  x: number,
  y: number,
  zoneId: string | undefined,
  state: DeviceTrailPoint["state"],
  source: DeviceTrailPoint["source"]
): DeviceTrailPoint {
  return { machineId, at, point: { x, y }, zoneId, state, source };
}

function activity(
  id: string,
  machineId: string,
  at: string,
  kind: DeviceActivityRecord["kind"],
  title: string,
  summary: string,
  zoneId: string | undefined,
  artifactRef: string | undefined,
  hash: string,
  source: DeviceActivityRecord["source"]
): DeviceActivityRecord {
  return { id, machineId, at, kind, title, summary, zoneId, artifactRef, hash, source };
}
