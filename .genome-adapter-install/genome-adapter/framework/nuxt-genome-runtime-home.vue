<script setup lang="ts">
import { buildGenomeStorefrontRenderModel } from "../utils/genome-render-model"

const props = defineProps<{ runtime: { manifest: Record<string, unknown>, servedVersion: number, projectId: string, workspaceId: string } }>()
const model = computed(() => buildGenomeStorefrontRenderModel(props.runtime))
const media = computed(() => [
  model.value.mediaSlots.catalog_surface,
  model.value.mediaSlots.product_featured,
  model.value.mediaSlots.category_highlight,
  model.value.mediaSlots.mutation_candidate,
].filter(Boolean))
let refreshTimer: ReturnType<typeof window.setInterval> | undefined

onMounted(() => {
  refreshTimer = window.setInterval(async () => {
    const response = await fetch("/api/genome/runtime", {
      cache: "no-store",
      headers: { accept: "application/json" },
    })

    if (!response.ok) {
      return
    }

    const body = await response.json()
    const nextVersion = body?.runtime?.servedVersion

    if (nextVersion !== undefined && nextVersion !== props.runtime.servedVersion) {
      window.location.reload()
    }
  }, 8000)
})

onBeforeUnmount(() => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer)
  }
})
</script>

<template>
  <main
    v-if="model.runtimePassthrough"
    data-genome-runtime-state="runtime_passthrough"
    :data-genome-project-id="model.projectId"
    :data-genome-workspace-id="model.workspaceId"
    :data-genome-version="model.servedVersion"
  >
    <p>Genome verified the runtime connection. Native storefront content is preserved until a mutation is approved.</p>
  </main>
  <main
    v-else
    data-genome-runtime-root
    :data-genome-project-id="model.projectId"
    :data-genome-workspace-id="model.workspaceId"
    :data-genome-version="model.servedVersion"
  >
    <section
      data-genome-id="runtime.hero.primary"
      data-genome-role="hero_surface"
      data-genome-step="home"
    >
      <img
        v-if="model.hero.imageUrl"
        :src="model.hero.imageUrl"
        :alt="model.hero.headline"
      >
      <p>{{ model.hero.eyebrow }}</p>
      <h1>{{ model.hero.headline }}</h1>
      <p>{{ model.hero.copy }}</p>
    </section>
    <section
      data-genome-id="runtime.media.catalog_grid"
      data-genome-role="catalog_surface"
      data-genome-step="catalog"
    >
      <figure
        v-for="slot in media"
        :key="slot.slot"
        :data-genome-id="'runtime.media.' + slot.slot"
        :data-genome-role="slot.slot === 'product_featured' ? 'product_tile' : 'campaign_asset'"
        :data-genome-step="slot.slot === 'product_featured' ? 'product' : slot.slot === 'mutation_candidate' ? 'preview' : 'catalog'"
      >
        <img
          v-if="slot.deliveryUrl"
          :src="slot.deliveryUrl"
          :alt="slot.slot.replace(/_/g, ' ')"
        >
      </figure>
    </section>
  </main>
</template>
