type GenomeTelemetryElement = HTMLElement & {
  dataset: {
    genomeId?: string
    genomeRole?: string
    genomeStep?: string
    genomeLabel?: string
  }
}

type GenomeTelemetrySignal =
  | "click"
  | "hover_hesitation"
  | "rage_click"
  | "payment_method_selected"

function normalizedPointer(event: PointerEvent | MouseEvent, element: Element) {
  const rect = element.getBoundingClientRect()
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  return {
    pointerX: Math.min(1, Math.max(0, event.clientX / Math.max(1, window.innerWidth))),
    pointerY: Math.min(1, Math.max(0, event.clientY / Math.max(1, window.innerHeight))),
    elementRect: {
      x: Math.min(1, Math.max(0, rect.left / Math.max(1, window.innerWidth))),
      y: Math.min(1, Math.max(0, rect.top / Math.max(1, window.innerHeight))),
      width: Math.min(1, width / Math.max(1, window.innerWidth)),
      height: Math.min(1, height / Math.max(1, window.innerHeight)),
    },
  }
}

function randomGenomeBrowserId(prefix: string): string {
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)

  return prefix + "_" + randomId
}

function randomGenomeEventId(): string {
  return randomGenomeBrowserId("evt")
}

function safeBrowserStorage(kind: "local" | "session"): Storage | undefined {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage
  } catch {
    return undefined
  }
}

function stableBrowserId(
  kind: "local" | "session",
  key: string,
  prefix: string,
): string {
  const storage = safeBrowserStorage(kind)

  try {
    const stored = storage?.getItem(key)

    if (stored) {
      return stored
    }
  } catch {
    // Browser privacy modes may expose Storage but reject reads.
  }

  const nextId = randomGenomeBrowserId(prefix)

  try {
    storage?.setItem(key, nextId)
  } catch {
    // Telemetry remains best-effort when browser storage is unavailable.
  }

  return nextId
}

function createGenomeTelemetryBatch(input: {
  event: PointerEvent | MouseEvent
  eventType: GenomeTelemetrySignal
  target: GenomeTelemetryElement
  workspaceId: string
  projectId: string
  siteVersion: number
  sessionId: string
  anonymousUserId: string
}) {
  return {
    events: [
      {
        eventId: randomGenomeEventId(),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        siteVersion: input.siteVersion,
        sessionId: input.sessionId,
        anonymousUserId: input.anonymousUserId,
        eventType: input.eventType,
        source: "browser_client" as const,
        page: location.pathname,
        step: input.target.dataset.genomeStep ?? "unknown",
        elementId: input.target.dataset.genomeId ?? "unknown",
        elementRole: input.target.dataset.genomeRole ?? "unknown",
        ...(input.target.dataset.genomeLabel
          ? { elementLabel: input.target.dataset.genomeLabel }
          : {}),
        interaction: normalizedPointer(input.event, input.target),
        context: {
          source: "generated_storefront_adapter",
        },
        occurredAt: new Date().toISOString(),
      },
    ],
  }
}

export function bindGenomeTelemetry(endpoint = "/api/genome/runtime") {
  const root = document.querySelector<HTMLElement>("[data-genome-runtime-root]")

  if (!root) {
    return () => undefined
  }

  const projectId = root.dataset.genomeProjectId
  const workspaceId = root.dataset.genomeWorkspaceId
  const siteVersion = Number(root.dataset.genomeVersion ?? "1")

  if (!projectId || !workspaceId || !Number.isFinite(siteVersion)) {
    return () => undefined
  }

  const sessionId = stableBrowserId("session", "genome_session_id", "ses")
  const anonymousUserId = stableBrowserId("local", "genome_anon_id", "anon")

  const telemetryTarget = (event: Event) =>
    (event.target as Element | null)?.closest<GenomeTelemetryElement>("[data-genome-id]")

  const send = (
    event: PointerEvent | MouseEvent,
    eventType: GenomeTelemetrySignal,
    target = telemetryTarget(event),
  ) => {
    if (!target) return

    const batch = createGenomeTelemetryBatch({
      event,
      eventType,
      target,
      workspaceId,
      projectId,
      siteVersion,
      sessionId,
      anonymousUserId,
    })

    void fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
    })
  }

  const rageWindowMs = 1500
  const rageClickThreshold = 3
  const clickHistory = new Map<string, number[]>()

  const onClick = (event: MouseEvent) => {
    const target = telemetryTarget(event)
    if (!target) return

    const role = target.dataset.genomeRole ?? "unknown"
    const step = target.dataset.genomeStep ?? "unknown"
    const semanticEvent =
      role === "payment_method" || step === "payment" ? "payment_method_selected" : "click"

    send(event, semanticEvent, target)

    const elementId = target.dataset.genomeId ?? "unknown"
    const now = Date.now()
    const history = (clickHistory.get(elementId) ?? []).filter((time) => now - time <= rageWindowMs)
    history.push(now)
    clickHistory.set(elementId, history)

    if (history.length >= rageClickThreshold) {
      send(event, "rage_click", target)
      clickHistory.set(elementId, [])
    }
  }
  const hoverDwellMs = 900
  const hoverThrottleMs = 10_000
  const hoverLastSentAt = new Map<string, number>()
  let hoverTimer: number | undefined
  let hoverTarget: GenomeTelemetryElement | undefined

  const cancelHover = () => {
    if (hoverTimer) {
      window.clearTimeout(hoverTimer)
    }
    hoverTimer = undefined
    hoverTarget = undefined
  }

  const onPointerOver = (event: PointerEvent) => {
    const target = telemetryTarget(event)
    if (!target || target === hoverTarget) return

    cancelHover()
    hoverTarget = target
    hoverTimer = window.setTimeout(() => {
      const elementId = target.dataset.genomeId ?? "unknown"
      const now = Date.now()
      const lastSentAt = hoverLastSentAt.get(elementId) ?? 0
      if (now - lastSentAt < hoverThrottleMs) return

      hoverLastSentAt.set(elementId, now)
      send(event, "hover_hesitation", target)
    }, hoverDwellMs)
  }

  const onPointerOut = (event: PointerEvent) => {
    const target = telemetryTarget(event)
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null
    if (target && target === hoverTarget && !target.contains(relatedTarget)) cancelHover()
  }
  document.addEventListener("click", onClick)
  document.addEventListener("pointerover", onPointerOver)
  document.addEventListener("pointerout", onPointerOut)
  document.addEventListener("pointercancel", cancelHover)

  return () => {
    cancelHover()
    document.removeEventListener("click", onClick)
    document.removeEventListener("pointerover", onPointerOver)
    document.removeEventListener("pointerout", onPointerOut)
    document.removeEventListener("pointercancel", cancelHover)
  }
}
