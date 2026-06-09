import { parseGenomeHeatmapSimulationScenario, readGenomeResponseBody, runGenomeHeatmapSimulation, type GenomeHeatmapSimulationScenario } from "../../utils/genome-runtime"

function scenarioFromValue(value: unknown): GenomeHeatmapSimulationScenario {
  return parseGenomeHeatmapSimulationScenario(value) ?? "balanced_engagement"
}

function heatmapSimulationMode(event: Parameters<typeof getHeader>[0]) {
  const configuredToken = process.env.GENOME_HEATMAP_SIMULATION_TOKEN
  const suppliedToken = getHeader(event, "x-genome-heatmap-simulation-token")
  return configuredToken && suppliedToken === configuredToken ? "commit" : "dry_run"
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const body = event.method === "POST" ? await readBody(event).catch(() => ({})) : {}
  const scenario = scenarioFromValue(
    typeof body === "object" && body && "scenario" in body ? body.scenario : query.scenario,
  )
  const response = await runGenomeHeatmapSimulation(scenario, { mode: heatmapSimulationMode(event) })
  setResponseStatus(event, response.status)
  return readGenomeResponseBody(response)
})
