export type GenomeManifestResponse = {
  manifest: Record<string, unknown>
  servedVersion: number
  projectId: string
  workspaceId: string
}

type GenomeRuntimeMediaResponse = {
  projectId: string
  key: string
  storageProvider: string
  url: string
  expiresAt: string
}

export type GenomeRuntimeConfigResponse = {
  projectId: string
  manifestMode: string
  manifestPath: string
  runtimeEndpoint?: string
  supportedFeatures: {
    runtimePull: boolean
    telemetry: boolean
    externalPreview: boolean
  }
  sameOriginProxyPaths: {
    manifest: string
    runtimeConfig: string
    media: string
    telemetry: string
  }
  proxyPaths: {
    activeManifest: string
    runtimeConfig: string
    runtimeMedia: string
    telemetryBatch: string
  }
  telemetry: {
    mode: string
    browserEvents: string[]
    serverEvents: string[]
    lastObservedEventAt?: string
  }
}

type GenomeSelfTestCheck = {
  name:
    | "runtime_config"
    | "runtime_manifest"
    | "telemetry_key"
    | "runtime_media"
    | "heatmap_simulation"
  status: "passed" | "failed" | "skipped"
  detail?: string
}

type GenomeSelfTestResponse = {
  ok: boolean
  projectId: string
  adapterVersion: string
  manifestMode: string
  servedVersion?: number
  checks: GenomeSelfTestCheck[]
}

type GenomeHeatmapSimulationMode = "dry_run" | "commit"

const defaultApiBaseUrl = "https://project-39cmw.vercel.app"
const defaultProjectId = "prj_31c7daaa51c612f76d35fc41"

function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback

  if (!value) {
    throw new Error(`Missing Genome runtime environment: ${name}`)
  }

  return value
}

export async function fetchGenomeManifest(): Promise<GenomeManifestResponse> {
  const apiBaseUrl = requiredEnv("GENOME_API_BASE_URL", defaultApiBaseUrl).replace(/\/$/, "")
  const projectId = requiredEnv("GENOME_PROJECT_ID", defaultProjectId)
  const token = requiredEnv("GENOME_RUNTIME_TOKEN")
  const response = await fetch(
    `${apiBaseUrl}/api/v1/runtime-manifest?projectId=${encodeURIComponent(projectId)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
  )

  if (!response.ok) {
    throw new Error(`Genome runtime manifest request failed with HTTP ${response.status}`)
  }

  return (await response.json()) as GenomeManifestResponse
}

export async function resolveGenomeMediaUrl(storageKey: string): Promise<GenomeRuntimeMediaResponse> {
  const apiBaseUrl = requiredEnv("GENOME_API_BASE_URL", defaultApiBaseUrl).replace(/\/$/, "")
  const projectId = requiredEnv("GENOME_PROJECT_ID", defaultProjectId)
  const token = requiredEnv("GENOME_RUNTIME_TOKEN")
  const response = await fetch(
    `${apiBaseUrl}/api/v1/runtime-media?projectId=${encodeURIComponent(projectId)}&key=${encodeURIComponent(storageKey)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
  )

  if (!response.ok) {
    throw new Error(`Genome runtime media request failed with HTTP ${response.status}`)
  }

  return (await response.json()) as GenomeRuntimeMediaResponse
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function deliveryErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : "Genome runtime media request failed"
}

async function hydrateImageArtifacts(value: unknown): Promise<unknown> {
  if (!Array.isArray(value)) {
    return value
  }

  return Promise.all(
    value.map(async (item) => {
      if (!isRecord(item)) {
        return item
      }

      const storageKey = typeof item.storageKey === "string" ? item.storageKey : undefined

      if (typeof storageKey !== "string" || item.status !== "stored") {
        return item
      }

      try {
        const media = await resolveGenomeMediaUrl(storageKey)
        return { ...item, deliveryUrl: media.url, deliveryUrlExpiresAt: media.expiresAt }
      } catch (error) {
        return { ...item, deliveryError: deliveryErrorMessage(error) }
      }
    }),
  )
}

export async function hydrateGenomeManifestMedia(
  runtime: GenomeManifestResponse,
): Promise<GenomeManifestResponse> {
  const manifest = runtime.manifest
  const media = isRecord(manifest.media) ? manifest.media : undefined
  const layout = isRecord(manifest.layout) ? manifest.layout : undefined
  const hero = layout && isRecord(layout.hero) ? layout.hero : undefined
  const heroStorageKey =
    hero && typeof hero.generatedImageStorageKey === "string"
      ? hero.generatedImageStorageKey
      : hero && typeof hero.generatedImageR2Key === "string"
        ? hero.generatedImageR2Key
        : undefined
  const hydratedCategoryImages = media
    ? await hydrateImageArtifacts(media.categoryImages)
    : undefined
  const hydratedMutationImages = media
    ? await hydrateImageArtifacts(media.mutationImages)
    : undefined
  let heroMedia: GenomeRuntimeMediaResponse | undefined
  let heroDeliveryError: string | undefined

  if (heroStorageKey && hero?.generatedImageStatus === "stored") {
    try {
      heroMedia = await resolveGenomeMediaUrl(heroStorageKey)
    } catch (error) {
      heroDeliveryError = deliveryErrorMessage(error)
    }
  }

  return {
    ...runtime,
    manifest: {
      ...manifest,
      ...(media
        ? {
            media: {
              ...media,
              categoryImages: hydratedCategoryImages,
              mutationImages: hydratedMutationImages,
            },
          }
        : {}),
      ...(layout
        ? {
            layout: {
              ...layout,
              ...(hero
                ? {
                    hero: {
                      ...hero,
                      ...(heroMedia
                        ? {
                            generatedImageUrl: heroMedia.url,
                            generatedImageUrlExpiresAt: heroMedia.expiresAt,
                          }
                        : {}),
                      ...(heroDeliveryError ? { generatedImageDeliveryError: heroDeliveryError } : {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
  }
}

export type GenomeMediaSlotName =
  | "hero"
  | "catalog_surface"
  | "product_featured"
  | "category_highlight"
  | "mutation_candidate"

export type GenomeRenderMediaSlot = {
  slot: GenomeMediaSlotName
  artifactId?: string
  category?: string
  purpose?: string
  storageKey?: string
  deliveryUrl?: string
  expiresAt?: string
  deliveryError?: string
  provenance?: Record<string, unknown>
}

export type GenomeStorefrontRenderModel = {
  projectId: string
  workspaceId: string
  servedVersion: number
  runtimePassthrough: boolean
  hero: {
    eyebrow?: string
    headline: string
    copy?: string
    imageUrl?: string
    artifactId?: string
    storageKey?: string
    deliveryError?: string
    provenance?: Record<string, unknown>
  }
  mediaSlots: Record<GenomeMediaSlotName, GenomeRenderMediaSlot | undefined>
}

export type GenomeHeatmapSimulationScenario =
  | "hero_high_interest"
  | "catalog_ignored"
  | "product_tile_rage_click"
  | "checkout_payment_hesitation"
  | "balanced_engagement"

const genomeHeatmapSimulationScenarios = new Set<GenomeHeatmapSimulationScenario>([
  "hero_high_interest",
  "catalog_ignored",
  "product_tile_rage_click",
  "checkout_payment_hesitation",
  "balanced_engagement",
])

export function parseGenomeHeatmapSimulationScenario(
  value: unknown,
): GenomeHeatmapSimulationScenario | undefined {
  return typeof value === "string" &&
    genomeHeatmapSimulationScenarios.has(value as GenomeHeatmapSimulationScenario)
    ? (value as GenomeHeatmapSimulationScenario)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function mutationScopedStorageKey(value: string | undefined): boolean {
  return Boolean(value?.includes("/mutations/"))
}

function mediaArtifacts(manifest: Record<string, unknown>): Record<string, unknown>[] {
  const media = isRecord(manifest.media) ? manifest.media : undefined
  return [
    ...(Array.isArray(media?.categoryImages) ? media.categoryImages : []),
    ...(Array.isArray(media?.mutationImages) ? media.mutationImages : []),
  ].filter(isRecord)
}

function mediaMatchesSlot(artifact: Record<string, unknown>, slot: GenomeMediaSlotName): boolean {
  if (artifact.slot === slot) {
    return true
  }

  if (slot === "mutation_candidate") {
    return artifact.purpose === "mutation_candidate"
  }

  return artifact.category === slot || artifact.purpose === slot
}

function mediaSlotFromArtifact(
  slot: GenomeMediaSlotName,
  artifact: Record<string, unknown> | undefined,
): GenomeRenderMediaSlot | undefined {
  if (!artifact) {
    return undefined
  }

  return {
    slot,
    artifactId: stringValue(artifact.id),
    category: stringValue(artifact.category),
    purpose: stringValue(artifact.purpose),
    storageKey: stringValue(artifact.storageKey),
    deliveryUrl: stringValue(artifact.deliveryUrl),
    expiresAt: stringValue(artifact.deliveryUrlExpiresAt),
    deliveryError: stringValue(artifact.deliveryError),
    provenance: isRecord(artifact.provenance) ? artifact.provenance : undefined,
  }
}

function mediaSlotFromHero(hero: Record<string, unknown> | undefined): GenomeRenderMediaSlot | undefined {
  const storageKey = stringValue(hero?.generatedImageStorageKey)
  const artifactId = stringValue(hero?.generatedImageArtifactId)

  if (!storageKey && !artifactId && !stringValue(hero?.generatedImageUrl)) {
    return undefined
  }

  return {
    slot: "hero",
    artifactId,
    purpose: "hero",
    storageKey,
    deliveryUrl: stringValue(hero?.generatedImageUrl),
    expiresAt: stringValue(hero?.generatedImageUrlExpiresAt),
    deliveryError: stringValue(hero?.generatedImageDeliveryError),
    provenance: isRecord(hero?.generatedImageProvenance) ? hero.generatedImageProvenance : undefined,
  }
}

function mediaSlotRank(artifact: Record<string, unknown>): number {
  const storageKey = stringValue(artifact.storageKey)
  const status = stringValue(artifact.status)
  const deliveryUrl = stringValue(artifact.deliveryUrl)
  const purpose = stringValue(artifact.purpose)
  let rank = 0

  if (status === "stored") {
    rank += 100
  }

  if (deliveryUrl) {
    rank += 40
  }

  if (mutationScopedStorageKey(storageKey)) {
    rank += 30
  }

  if (purpose !== "category_seed") {
    rank += 10
  }

  return rank
}

function firstMediaSlot(
  manifest: Record<string, unknown>,
  slot: GenomeMediaSlotName,
): GenomeRenderMediaSlot | undefined {
  const matches = mediaArtifacts(manifest).filter((artifact) => mediaMatchesSlot(artifact, slot))
  matches.sort((left, right) => mediaSlotRank(right) - mediaSlotRank(left))

  return mediaSlotFromArtifact(
    slot,
    matches[0],
  )
}

export function buildGenomeStorefrontRenderModel(
  runtime: GenomeManifestResponse,
): GenomeStorefrontRenderModel {
  const manifest = runtime.manifest
  const constraints = isRecord(manifest.constraints) ? manifest.constraints : undefined
  const runtimePassthrough = constraints?.genomeRuntimePassthrough === true
  const layout = isRecord(manifest.layout) ? manifest.layout : undefined
  const hero = layout && isRecord(layout.hero) ? layout.hero : undefined
  const heroSlot = runtimePassthrough ? undefined : firstMediaSlot(manifest, "hero") ?? mediaSlotFromHero(hero)

  return {
    projectId: runtime.projectId,
    workspaceId: runtime.workspaceId,
    servedVersion: runtime.servedVersion,
    runtimePassthrough,
    hero: {
      eyebrow: stringValue(hero?.eyebrow),
      headline: stringValue(hero?.headline) ?? stringValue(hero?.title) ?? "Commerce campaign",
      copy: stringValue(hero?.copy),
      imageUrl: runtimePassthrough ? undefined : heroSlot?.deliveryUrl ?? stringValue(hero?.generatedImageUrl) ?? stringValue(hero?.imageSrc),
      artifactId: runtimePassthrough ? undefined : stringValue(hero?.generatedImageArtifactId) ?? heroSlot?.artifactId,
      storageKey: runtimePassthrough ? undefined : stringValue(hero?.generatedImageStorageKey) ?? heroSlot?.storageKey,
      deliveryError: runtimePassthrough ? undefined : stringValue(hero?.generatedImageDeliveryError) ?? heroSlot?.deliveryError,
      provenance: runtimePassthrough ? undefined : isRecord(hero?.generatedImageProvenance) ? hero.generatedImageProvenance : heroSlot?.provenance,
    },
    mediaSlots: {
      hero: heroSlot,
      catalog_surface: runtimePassthrough ? undefined : firstMediaSlot(manifest, "catalog_surface"),
      product_featured: runtimePassthrough ? undefined : firstMediaSlot(manifest, "product_featured"),
      category_highlight: runtimePassthrough ? undefined : firstMediaSlot(manifest, "category_highlight"),
      mutation_candidate: runtimePassthrough ? undefined : firstMediaSlot(manifest, "mutation_candidate"),
    },
  }
}

function simulatedEvent(
  model: GenomeStorefrontRenderModel,
  scenario: GenomeHeatmapSimulationScenario,
  index: number,
  eventType: string,
  elementId: string,
  role: string,
  step: string,
  pointerX: number,
  pointerY: number,
  occurredAt: Date,
  artifactId?: string,
) {
  return {
    eventId: "evt_sim_" + scenario + "_" + index,
    workspaceId: model.workspaceId,
    projectId: model.projectId,
    siteVersion: Math.max(1, model.servedVersion),
    sessionId: "ses_sim_" + scenario,
    anonymousUserId: "anon_sim_" + scenario,
    eventType,
    source: "api_route",
    page: step === "payment" ? "/checkout" : "/",
    step,
    elementId,
    elementRole: role,
    interaction: {
      pointerX,
      pointerY,
      elementRect: {
        x: Math.max(0, pointerX - 0.1),
        y: Math.max(0, pointerY - 0.08),
        width: 0.2,
        height: 0.16,
      },
      dwellMs: eventType === "hover_hesitation" ? 1400 : 280,
      clickCount: eventType === "rage_click" ? 4 : 1,
    },
    context: {
      simulation: true,
      simulationKind: "heatmap_smoke_test",
      source: "generated_storefront_adapter_heatmap_simulation",
      scenario,
      ...(artifactId ? { artifactId } : {}),
    },
    occurredAt: occurredAt.toISOString(),
  }
}

export function createGenomeHeatmapSimulationEvents(
  model: GenomeStorefrontRenderModel,
  scenario: GenomeHeatmapSimulationScenario,
  now = new Date(),
) {
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs)

  if (scenario === "checkout_payment_hesitation") {
    return {
      events: [
        simulatedEvent(model, scenario, 0, "checkout_step_viewed", "checkout.payment.step", "checkout_step", "payment", 0.49, 0.54, at(0)),
        simulatedEvent(model, scenario, 1, "payment_method_selected", "checkout.payment.upi", "payment_method", "payment", 0.62, 0.66, at(1600)),
        simulatedEvent(model, scenario, 2, "hover_hesitation", "checkout.payment.upi", "payment_method", "payment", 0.63, 0.67, at(2500)),
      ],
    }
  }

  if (scenario === "product_tile_rage_click") {
    const slot = model.mediaSlots.product_featured
    return {
      events: [
        simulatedEvent(model, scenario, 0, "product_view", "runtime.media.product_featured", "product_tile", "product", 0.38, 0.77, at(0), slot?.artifactId),
        simulatedEvent(model, scenario, 1, "rage_click", "runtime.media.product_featured", "product_tile", "product", 0.39, 0.78, at(700), slot?.artifactId),
      ],
    }
  }

  if (scenario === "catalog_ignored") {
    return {
      events: [
        simulatedEvent(model, scenario, 0, "scroll_velocity", "runtime.media.catalog_surface", "campaign_asset", "catalog", 0.25, 0.68, at(0), model.mediaSlots.catalog_surface?.artifactId),
        simulatedEvent(model, scenario, 1, "hover_hesitation", "runtime.media.category_highlight", "campaign_asset", "catalog", 0.73, 0.72, at(1200), model.mediaSlots.category_highlight?.artifactId),
      ],
    }
  }

  if (scenario === "balanced_engagement") {
    return {
      events: [
        simulatedEvent(model, scenario, 0, "campaign_exposed", "runtime.hero.primary", "hero_surface", "home", 0.5, 0.32, at(0), model.hero.artifactId),
        simulatedEvent(model, scenario, 1, "product_view", "runtime.media.catalog_surface", "campaign_asset", "catalog", 0.3, 0.7, at(800), model.mediaSlots.catalog_surface?.artifactId),
        simulatedEvent(model, scenario, 2, "add_to_cart", "runtime.media.product_featured", "product_tile", "product", 0.42, 0.78, at(1700), model.mediaSlots.product_featured?.artifactId),
      ],
    }
  }

  return {
    events: [
      simulatedEvent(model, scenario, 0, "campaign_exposed", "runtime.hero.primary", "hero_surface", "home", 0.52, 0.28, at(0), model.hero.artifactId),
      simulatedEvent(model, scenario, 1, "click", "runtime.hero.primary_cta", "campaign_cta", "home", 0.44, 0.51, at(900), model.hero.artifactId),
    ],
  }
}

export async function fetchGenomeRuntimeConfig(): Promise<GenomeRuntimeConfigResponse> {
  const apiBaseUrl = requiredEnv("GENOME_API_BASE_URL", defaultApiBaseUrl).replace(/\/$/, "")
  const projectId = requiredEnv("GENOME_PROJECT_ID", defaultProjectId)
  const token = requiredEnv("GENOME_RUNTIME_CONFIG_TOKEN")
  const response = await fetch(
    `${apiBaseUrl}/api/v1/runtime-config?projectId=${encodeURIComponent(projectId)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
  )

  if (!response.ok) {
    throw new Error(`Genome runtime config request failed with HTTP ${response.status}`)
  }

  return (await response.json()) as GenomeRuntimeConfigResponse
}

export async function fetchGenomeRuntimeManifestIfEnabled(
  config?: GenomeRuntimeConfigResponse,
): Promise<GenomeManifestResponse | null> {
  const resolvedConfig = config ?? (await fetchGenomeRuntimeConfig())

  if (resolvedConfig.manifestMode !== "runtime_pull") {
    return null
  }

  return hydrateGenomeManifestMedia(await fetchGenomeManifest())
}

export async function forwardGenomeTelemetry(body: unknown): Promise<Response> {
  const apiBaseUrl = requiredEnv("GENOME_API_BASE_URL", defaultApiBaseUrl).replace(/\/$/, "")
  const token = requiredEnv("GENOME_TELEMETRY_INGEST_KEY")
  return fetch(`${apiBaseUrl}/api/v1/events/batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-genome-telemetry-ingest-key": token,
    },
    body: JSON.stringify(body),
  })
}

export async function runGenomeHeatmapSimulation(
  scenario: GenomeHeatmapSimulationScenario = "balanced_engagement",
  options: { mode?: GenomeHeatmapSimulationMode } = {},
): Promise<Response> {
  const safeScenario = parseGenomeHeatmapSimulationScenario(scenario) ?? "balanced_engagement"
  const config = await fetchGenomeRuntimeConfig()

  if (config.manifestMode !== "runtime_pull") {
    return Response.json(
      {
        ok: true,
        status: "skipped",
        reason:
          config.manifestMode === "git_manifest"
            ? "Git Manifest mode uses local storefront manifests; runtime pull simulation is skipped."
            : "Runtime manifest pull is not active for this storefront.",
        manifestMode: config.manifestMode,
        projectId: config.projectId,
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    )
  }

  const hydratedRuntime = await hydrateGenomeManifestMedia(await fetchGenomeManifest())
  const model = buildGenomeStorefrontRenderModel(hydratedRuntime)
  const batch = createGenomeHeatmapSimulationEvents(model, safeScenario)

  if (options.mode !== "commit") {
    return Response.json(
      {
        ok: true,
        status: "dry_run",
        committed: false,
        projectId: model.projectId,
        servedVersion: model.servedVersion,
        scenario: safeScenario,
        eventCount: batch.events.length,
        events: batch.events,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    )
  }

  return forwardGenomeTelemetry(batch)
}

export async function readGenomeResponseBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()

  if (!text) {
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    }
  }

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: text.slice(0, 1000),
    }
  }
}

function checkTelemetryKeyShape(): GenomeSelfTestCheck {
  const token = process.env.GENOME_TELEMETRY_INGEST_KEY

  if (!token) {
    return { name: "telemetry_key", status: "failed", detail: "GENOME_TELEMETRY_INGEST_KEY is missing." }
  }

  if (!token.startsWith("gmt_evt_")) {
    return { name: "telemetry_key", status: "failed", detail: "Telemetry ingest key must use the gmt_evt_ prefix." }
  }

  return { name: "telemetry_key", status: "passed", detail: "Telemetry ingest key shape is valid." }
}

function firstStoredMediaKey(manifest: Record<string, unknown>): string | undefined {
  const media = manifest.media && typeof manifest.media === "object" ? manifest.media as Record<string, unknown> : {}
  const layout = manifest.layout && typeof manifest.layout === "object" ? manifest.layout as Record<string, unknown> : {}
  const hero = layout.hero && typeof layout.hero === "object" ? layout.hero as Record<string, unknown> : {}
  const heroStorageKey =
    typeof hero.generatedImageStorageKey === "string"
      ? hero.generatedImageStorageKey
      : typeof hero.generatedImageR2Key === "string"
        ? hero.generatedImageR2Key
        : undefined

  if (hero.generatedImageStatus === "stored" && heroStorageKey) {
    return heroStorageKey
  }

  const candidates = [
    ...(Array.isArray(media.categoryImages) ? media.categoryImages : []),
    ...(Array.isArray(media.mutationImages) ? media.mutationImages : []),
  ]

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue
    }

    const record = candidate as Record<string, unknown>

    if (record.status === "stored" && typeof record.storageKey === "string") {
      return record.storageKey
    }
  }

  return undefined
}

export async function runGenomeSelfTest(): Promise<GenomeSelfTestResponse> {
  const projectId = requiredEnv("GENOME_PROJECT_ID", defaultProjectId)
  const checks: GenomeSelfTestCheck[] = []
  let config: GenomeRuntimeConfigResponse | undefined
  let runtime: GenomeManifestResponse | undefined

  try {
    config = await fetchGenomeRuntimeConfig()
    checks.push(
      config.projectId === projectId
        ? { name: "runtime_config", status: "passed", detail: "Runtime config token accepted." }
        : { name: "runtime_config", status: "failed", detail: "Runtime config project id does not match GENOME_PROJECT_ID." },
    )
  } catch (error) {
    checks.push({ name: "runtime_config", status: "failed", detail: error instanceof Error ? error.message : "Runtime config request failed." })
  }

  const manifestMode = config?.manifestMode ?? "unknown"

  if (manifestMode === "runtime_pull") {
    try {
      runtime = await fetchGenomeManifest()
      checks.push({ name: "runtime_manifest", status: "passed", detail: `Served manifest version ${runtime.servedVersion}.` })
    } catch (error) {
      checks.push({ name: "runtime_manifest", status: "failed", detail: error instanceof Error ? error.message : "Runtime manifest request failed." })
    }
  } else {
    checks.push({
      name: "runtime_manifest",
      status: "skipped",
      detail: manifestMode === "git_manifest" ? "Git Manifest mode does not require runtime manifest pull." : "Runtime manifest pull skipped until runtime config is verified.",
    })
  }

  checks.push(checkTelemetryKeyShape())

  const mediaKey = runtime ? firstStoredMediaKey(runtime.manifest) : undefined

  if (!mediaKey) {
    checks.push({ name: "runtime_media", status: "skipped", detail: "No stored manifest media key is available yet." })
  } else {
    try {
      const media = await resolveGenomeMediaUrl(mediaKey)
      const expiresAtMs = Date.parse(media.expiresAt)
      checks.push(
        media.projectId === projectId && media.key === mediaKey && media.url.startsWith("https://") && expiresAtMs > Date.now()
          ? { name: "runtime_media", status: "passed", detail: `Stored manifest media resolved through Genome runtime media using ${media.storageProvider}.` }
          : { name: "runtime_media", status: "failed", detail: "Runtime media response did not match the requested stored manifest key." },
      )
    } catch (error) {
      checks.push({ name: "runtime_media", status: "failed", detail: error instanceof Error ? error.message : "Runtime media request failed." })
    }
  }

  try {
    const heatmapResponse = await runGenomeHeatmapSimulation("balanced_engagement", { mode: "dry_run" })
    const heatmapBody = await readGenomeResponseBody(heatmapResponse)
    const heatmapStatus = typeof heatmapBody.status === "string" ? heatmapBody.status : undefined
    checks.push(
      heatmapResponse.ok
        ? {
            name: "heatmap_simulation",
            status: heatmapStatus === "skipped" ? "skipped" : "passed",
            detail:
              heatmapStatus === "skipped"
                ? "Heatmap simulation skipped because runtime pull is not active."
                : "Heatmap simulation generated dry-run api_route telemetry without writing events.",
          }
        : {
            name: "heatmap_simulation",
            status: "failed",
            detail: `Heatmap simulation failed with HTTP ${heatmapResponse.status}.`,
          },
    )
  } catch (error) {
    checks.push({ name: "heatmap_simulation", status: "failed", detail: error instanceof Error ? error.message : "Heatmap simulation request failed." })
  }

  return {
    ok: checks.every((check) => check.status !== "failed"),
    projectId,
    adapterVersion: "genome-adapter-drop-v1",
    manifestMode,
    ...(runtime ? { servedVersion: runtime.servedVersion } : {}),
    checks,
  }
}
