export type GenomeManifestResponse = {
  manifest: Record<string, unknown>
  servedVersion: number
  projectId: string
  workspaceId: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
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
