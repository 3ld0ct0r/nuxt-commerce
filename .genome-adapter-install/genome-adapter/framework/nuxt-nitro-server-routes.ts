import { fetchGenomeManifest, fetchGenomeRuntimeConfig, forwardGenomeTelemetry, hydrateGenomeManifestMedia, readGenomeResponseBody } from "../../utils/genome-runtime"

export default defineEventHandler(async (event) => {
  if (event.method === "POST") {
    const response = await forwardGenomeTelemetry(await readBody(event))
    setResponseStatus(event, response.status)
    return readGenomeResponseBody(response)
  }

  const config = await fetchGenomeRuntimeConfig()
  setResponseHeader(event, "cache-control", "no-store")

  if (config.manifestMode !== "runtime_pull") {
    return { config, runtime: null }
  }

  const runtime = await fetchGenomeManifest()
  return { config, runtime: await hydrateGenomeManifestMedia(runtime) }
})
