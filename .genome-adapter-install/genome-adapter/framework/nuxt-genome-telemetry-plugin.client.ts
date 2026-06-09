import { bindGenomeTelemetry } from "../utils/genome-telemetry"

let unbindGenomeTelemetry: (() => void) | undefined

function bindRuntimeTelemetry() {
  unbindGenomeTelemetry?.()
  unbindGenomeTelemetry = bindGenomeTelemetry()
}

export default defineNuxtPlugin(() => {
  bindRuntimeTelemetry()
  window.addEventListener("genome-runtime-mounted", bindRuntimeTelemetry)
})
