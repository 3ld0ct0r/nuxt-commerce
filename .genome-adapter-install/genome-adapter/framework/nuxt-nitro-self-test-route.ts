import { runGenomeSelfTest } from "../../utils/genome-runtime"

export default defineEventHandler(async (event) => {
  const result = await runGenomeSelfTest()
  setResponseStatus(event, result.ok ? 200 : 502)
  setResponseHeader(event, "cache-control", "no-store")
  return result
})
