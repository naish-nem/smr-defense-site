export type MachineKind = "uav" | "quadruped" | "fixed-sensor" | "dock" | "unknown";

export type EventType =
  | "patrol_pass"
  | "image_capture"
  | "thermal_reading"
  | "dock_status"
  | "fixed_camera_trigger"
  | "adapter_health"
  | "telemetry";

export type EvidenceResult = "covered" | "exception" | "stale" | "unreviewed";

export type ReviewState = "accepted" | "needs_review" | "raw_unreviewed";

export type ExceptionSeverity = "low" | "medium" | "high" | "critical";

export type ExceptionType =
  | "missing_coverage"
  | "thermal_anomaly"
  | "unauthorized_perimeter"
  | "machine_recall"
  | "stale_input"
  | "adapter_gap";

export interface GeoPoint {
  lat: number;
  lng: number;
  altMeters?: number;
}

export type FreshnessState = "fresh" | "aging" | "stale" | "unknown";

export interface TelemetryEnvelope {
  observedAt: string;
  receivedAt: string;
  adapterCheckedAt: string;
  sourceClockSkewMs: number;
  freshnessState: FreshnessState;
  ttlSeconds: number;
  sequenceId?: string;
  droppedSampleCount?: number;
}

export type CoordinateFrameId = "wgs84" | "site-local-enu" | "robot-base" | "camera-optical" | "dock" | "zone-polygon";

export interface Pose {
  frameId: CoordinateFrameId;
  position: GeoPoint | { x: number; y: number; z?: number };
  orientation?: { roll: number; pitch: number; yaw: number };
  covariance?: number[];
  fixType?: "none" | "gps" | "rtk_float" | "rtk_fixed" | "visual_odometry" | "site_map";
  accuracyMeters?: number;
}

export interface Artifact {
  id: string;
  type: "image" | "thermal" | "video" | "log" | "map_overlay";
  uri: string;
  thumbnailUri?: string;
  capturedAt: string;
  sensor: string;
  poseAtCapture?: Pose;
  hash?: string;
  retentionClass: "ephemeral" | "shift_record" | "incident_record";
  reviewState: ReviewState;
  chainOfCustody: string[];
}

export interface CoverageZone {
  id: string;
  name: string;
  purpose: string;
  requiredMachineKinds: MachineKind[];
  freshnessMinutes: number;
}

export interface SitePoint {
  x: number;
  y: number;
  z?: number;
}

export interface ZonePolygon {
  zoneId: string;
  frameId: "site-local-enu";
  vertices: SitePoint[];
}

export interface SiteGeometry {
  siteId: string;
  frameId: "site-local-enu";
  boundary: SitePoint[];
  zones: ZonePolygon[];
  noGoZones: ZonePolygon[];
  dockLocations: Array<{ machineId: string; point: SitePoint }>;
  inspectionWaypoints: Array<{ zoneId: string; point: SitePoint; label: string }>;
}

export interface Machine {
  id: string;
  label: string;
  kind: MachineKind;
  vendor: "DJI" | "Unitree" | "Fixed" | "Simulator" | "Unknown";
  model?: string;
  status: "online" | "available" | "docked" | "in_mission" | "recalled" | "offline" | "unknown";
  batteryPct?: number;
}

export type DeviceStreamAvailability = "live_ready" | "standby" | "recorded_only" | "unavailable";

export interface DeviceStreamState {
  machineId: string;
  availability: DeviceStreamAvailability;
  protocol: "webrtc-whep" | "hls" | "rtsp-bridge" | "edge-bridge" | "vendor-live" | "none";
  label: string;
  sessionRef?: string;
  qualityLabel?: string;
  latencyMs?: number;
  uplinkKbps?: number;
  retentionClass: Artifact["retentionClass"];
  source: "telemetry" | "artifact" | "simulated" | "authored";
  note: string;
}

export interface DeviceTrailPoint {
  machineId: string;
  at: string;
  point: SitePoint;
  zoneId?: string;
  state: "observed" | "planned" | "blocked" | "simulated";
  source: "telemetry" | "artifact" | "simulated" | "authored";
}

export interface DeviceActivityRecord {
  id: string;
  machineId: string;
  at: string;
  kind: "capture" | "telemetry" | "mission" | "stream" | "health";
  title: string;
  summary: string;
  zoneId?: string;
  artifactRef?: string;
  hash: string;
  source: "telemetry" | "artifact" | "simulated" | "authored";
}

export interface MachineEvent {
  id: string;
  sourceMachineId: string;
  siteId: string;
  timestamp: string;
  eventType: EventType;
  zoneId?: string;
  locationLabel: string;
  location?: GeoPoint;
  pose?: Pose;
  envelope?: TelemetryEnvelope;
  payloadRef?: string;
  artifact?: Artifact;
  rawStatus: string;
  confidence: number;
  raw?: Record<string, unknown>;
}

export interface CoverageEvidence {
  id: string;
  eventIds: string[];
  zoneId: string;
  sourceMachineId: string;
  checkedAt: string;
  result: EvidenceResult;
  artifactRefs: string[];
  confidence: number;
  reviewState: ReviewState;
  recommendedAction: string;
}

export interface FleetException {
  id: string;
  type: ExceptionType;
  severity: ExceptionSeverity;
  location: string;
  evidenceRefs: string[];
  status: "open" | "assigned" | "reviewed" | "closed";
  owner: string;
  nextAction: string;
}

export interface Site {
  id: string;
  name: string;
  location: string;
  mission: string;
}

export interface SiteRecord {
  site: Site;
  generatedAt: string;
  coverageZones: Array<CoverageZone & { state: EvidenceResult; lastCheckedAt?: string }>;
  machines: Machine[];
  latestEvidence: CoverageEvidence[];
  rawUnreviewedEvents: MachineEvent[];
  openExceptions: FleetException[];
  auditTrail: AuditEntry[];
  readiness: {
    coveragePct: number;
    openExceptionCount: number;
    adapterHealth: "healthy" | "degraded" | "offline";
    commandAuthority: "none" | "read_only" | "guarded" | "autonomous";
  };
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: "FleetBrainKernel" | "EventIngestionService" | "operator" | "adapter" | "system";
  action: string;
  subjectRef: string;
  detail: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface AdapterCapabilities {
  readMachineState: boolean;
  readRecentEvents: boolean;
  readMediaReferences: boolean;
  reportAdapterHealth: boolean;
  commandHardware: false;
}

export interface AdapterHealth {
  adapterId: string;
  status: "healthy" | "degraded" | "offline";
  message: string;
  checkedAt: string;
  missingInputs: string[];
}

export interface MachineAdapter {
  readonly adapterId: string;
  readonly capabilities: AdapterCapabilities;
  readMachineState(siteId: string): Promise<Machine[]>;
  readRecentEvents(siteId: string): Promise<MachineEvent[]>;
  readMediaReferences(siteId: string): Promise<string[]>;
  reportAdapterHealth(): Promise<AdapterHealth>;
}
