import { runSoak } from "./soakHarness";

/**
 * Tiny node-friendly entry point for the edge soak harness.
 *
 * Runs a deterministic 72h-compressed soak with a scripted partition window and
 * prints the SoakResult as JSON. Intended to be run via a TypeScript runner
 * (e.g. `npx tsx src/edge/soakCli.ts`). When no such runner is installed, the
 * `npm run soak` script instead exercises the same harness through the edge
 * test suite (`vitest run src/edge/`), so the soak path stays covered with zero
 * added dependencies.
 */
async function main(): Promise<void> {
  const result = await runSoak({
    totalTicks: 48,
    windowMs: 72 * 60 * 60 * 1000,
    startIso: "2026-06-18T10:00:00.000Z",
    seed: 0x5eed,
    linkLossWindows: [{ startTick: 10, endTick: 20, state: "partitioned" }],
    minEventsPerTick: 1,
    maxEventsPerTick: 4
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

void main();
