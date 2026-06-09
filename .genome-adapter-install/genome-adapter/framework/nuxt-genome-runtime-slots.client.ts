import targetMap from "../genome-target-map.json"
import { buildGenomeStorefrontRenderModel } from "../utils/genome-render-model"

type GenomeTargetSlot = {
  slot?: string
  selector?: string
  confidence?: string
  operatorConfirmed?: boolean
}

type GenomeRuntimeResponse = {
  runtime?: {
    manifest?: Record<string, unknown>
    servedVersion?: number
    projectId?: string
    workspaceId?: string
  } | null
}

function confirmedSlot(name: string): GenomeTargetSlot | undefined {
  const slots = Array.isArray(targetMap.slots) ? targetMap.slots : []
  return slots.find((slot) => slot.slot === name)
}

function queryGenomeSlotTarget(slot: GenomeTargetSlot): Element | null {
  if (!slot.selector) {
    return null
  }

  try {
    return document.querySelector(slot.selector)
  } catch (error) {
    console.warn("Genome target-map selector skipped", {
      slot: slot.slot,
      selector: slot.selector,
      error,
    })
    return null
  }
}

function canMountSlot(slot: GenomeTargetSlot | undefined): slot is GenomeTargetSlot & { selector: string } {
  return Boolean(
    slot?.selector &&
      slot.operatorConfirmed === true,
  )
}

const originalSlotHtml = new WeakMap<Element, string>()

function rememberOriginalSlot(target: Element) {
  if (!originalSlotHtml.has(target)) {
    originalSlotHtml.set(target, target.innerHTML)
  }
}

function restoreOriginalSlot(target: Element) {
  const originalHtml = originalSlotHtml.get(target)

  if (originalHtml !== undefined) {
    target.innerHTML = originalHtml
  }

  target.removeAttribute("data-genome-slot-mounted")
  target.removeAttribute("data-genome-slot-mounted-version")
}

function element(tagName: string, attributes: Record<string, string> = {}, text?: string) {
  const node = document.createElement(tagName)

  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value)
  }

  if (text) {
    node.textContent = text
  }

  return node
}

function image(src: string | undefined, alt: string) {
  if (!src) {
    return null
  }

  const img = document.createElement("img")
  img.src = src
  img.alt = alt
  img.loading = "lazy"
  return img
}

function heroSlot(model: ReturnType<typeof buildGenomeStorefrontRenderModel>) {
  const section = element("section", {
    "data-genome-runtime-slot": "hero",
    "data-genome-id": "runtime.hero.primary",
    "data-genome-role": "hero_surface",
    "data-genome-step": "home",
  })
  const heroImage = image(model.hero.imageUrl, model.hero.headline)

  if (heroImage) {
    section.append(heroImage)
  }

  if (model.hero.eyebrow) {
    section.append(element("p", {}, model.hero.eyebrow))
  }

  section.append(element("h1", {}, model.hero.headline))

  if (model.hero.copy) {
    section.append(element("p", {}, model.hero.copy))
  }

  return section
}

function mediaSlot(
  slotName: "campaign_media" | "product_grid",
  model: ReturnType<typeof buildGenomeStorefrontRenderModel>,
) {
  const slots =
    slotName === "product_grid"
      ? [
          model.mediaSlots.product_featured,
          model.mediaSlots.catalog_surface,
          model.mediaSlots.category_highlight,
        ].filter(Boolean)
      : [
          model.mediaSlots.catalog_surface,
          model.mediaSlots.product_featured,
          model.mediaSlots.category_highlight,
          model.mediaSlots.mutation_candidate,
        ].filter(Boolean)

  if (!slots.length) {
    return null
  }

  const section = element("section", {
    "data-genome-runtime-slot": slotName,
    "data-genome-id": slotName === "product_grid" ? "runtime.media.product_grid" : "runtime.media.campaign",
    "data-genome-role": slotName === "product_grid" ? "catalog_surface" : "campaign_asset",
    "data-genome-step": "catalog",
  })

  for (const slot of slots) {
    const figure = element("figure", {
      "data-genome-id": "runtime.media." + slot.slot,
      "data-genome-role": slot.slot === "product_featured" ? "product_tile" : "campaign_asset",
      "data-genome-step": slot.slot === "product_featured" ? "product" : slot.slot === "mutation_candidate" ? "preview" : "catalog",
    })
    const mediaImage = image(slot.deliveryUrl, slot.slot.replace(/_/g, " "))

    if (mediaImage) {
      figure.append(mediaImage)
    }

    section.append(figure)
  }

  return section
}

function mountSlot(
  slotName: "hero" | "campaign_media" | "product_grid",
  model: ReturnType<typeof buildGenomeStorefrontRenderModel>,
): boolean {
  const slot = confirmedSlot(slotName)

  if (!canMountSlot(slot)) {
    return false
  }

  const target = queryGenomeSlotTarget(slot)

  if (!target) {
    return false
  }

  if (model.runtimePassthrough) {
    restoreOriginalSlot(target)
    return false
  }

  const mountedVersion = target.getAttribute("data-genome-slot-mounted-version")
  const mountedRuntimeSlot = target.querySelector('[data-genome-runtime-slot="' + slotName + '"]')

  if (mountedVersion === String(model.servedVersion) && mountedRuntimeSlot) {
    return false
  }

  const replacement = slotName === "hero" ? heroSlot(model) : mediaSlot(slotName, model)

  if (!replacement) {
    return false
  }

  rememberOriginalSlot(target)
  target.setAttribute("data-genome-slot-mounted", "true")
  target.setAttribute("data-genome-slot-mounted-version", String(model.servedVersion))
  target.replaceChildren(replacement)
  return true
}

async function loadGenomeRuntime() {
  const response = await fetch("/api/genome/runtime", {
    cache: "no-store",
    headers: { accept: "application/json" },
  })

  if (!response.ok) {
    return null
  }

  const body = (await response.json()) as GenomeRuntimeResponse

  return body.runtime?.manifest ? body.runtime : null
}

const maxMountAttempts = 12
const runtimeRefreshMs = 8000

export default defineNuxtPlugin((nuxtApp) => {
  let runtimePromise: Promise<GenomeRuntimeResponse["runtime"] | null> | undefined
  let mountAttempts = 0
  let retryTimer: ReturnType<typeof window.setTimeout> | undefined
  let refreshTimer: ReturnType<typeof window.setInterval> | undefined

  function scheduleMount(delayMs = 0) {
    if (retryTimer) {
      window.clearTimeout(retryTimer)
    }

    retryTimer = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        void mountGenomeRuntimeSlots()
      })
    }, delayMs)
  }

  async function runtimeForMount() {
    runtimePromise ??= loadGenomeRuntime()
    const runtime = await runtimePromise
    runtimePromise = undefined

    return runtime
  }

  function scheduleRetry() {
    mountAttempts += 1

    if (mountAttempts < maxMountAttempts) {
      scheduleMount(Math.min(1000, 80 * mountAttempts))
    }
  }

  async function mountGenomeRuntimeSlots() {
    try {
      const runtime = await runtimeForMount()

      if (!runtime?.manifest) {
        scheduleRetry()
        return
      }

      const model = buildGenomeStorefrontRenderModel({
        manifest: runtime.manifest,
        servedVersion: runtime.servedVersion ?? 0,
        projectId: runtime.projectId ?? "",
        workspaceId: runtime.workspaceId ?? "",
      })

      if (model.runtimePassthrough) {
        mountSlot("hero", model)
        mountSlot("product_grid", model)
        mountSlot("campaign_media", model)
        mountAttempts = 0
        return
      }

      const mountedCount = [
        mountSlot("hero", model),
        mountSlot("product_grid", model),
        mountSlot("campaign_media", model),
      ].filter(Boolean).length

      if (mountedCount > 0) {
        mountAttempts = 0
        window.dispatchEvent(new CustomEvent("genome-runtime-mounted", { detail: { mountedCount } }))
        return
      }

      scheduleRetry()
    } catch {
      runtimePromise = undefined
      // Keep the native Nuxt storefront as the runtime fallback.
      scheduleRetry()
    }

  }

  scheduleMount()
  refreshTimer = window.setInterval(() => scheduleMount(), runtimeRefreshMs)
  nuxtApp.hook("app:mounted", () => scheduleMount())
  nuxtApp.hook("page:finish", () => scheduleMount())
  window.addEventListener("beforeunload", () => {
    if (refreshTimer) {
      window.clearInterval(refreshTimer)
    }
  })
})
