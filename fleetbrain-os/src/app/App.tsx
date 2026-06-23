import { Console } from "../console/Console";

/**
 * App entry — renders the FleetBrain Console (the three-surface decision product:
 * Queue · Site Truth · Proof, plus a hidden Dev surface). The previous panel-pile
 * dashboard is preserved as LegacyDashboard and reachable only from Dev.
 */
export function App() {
  return <Console />;
}
