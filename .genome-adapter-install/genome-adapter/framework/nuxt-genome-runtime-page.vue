<script setup lang="ts">
const { data } = await useFetch("/api/genome/runtime", {
  headers: { accept: "application/json" },
})
const runtime = computed(() => data.value?.runtime ?? null)
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

    if (runtime.value?.servedVersion !== undefined && nextVersion !== runtime.value.servedVersion) {
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
  <GenomeRuntimeHome
    v-if="runtime"
    :runtime="runtime"
  />
  <main
    v-else
    data-genome-runtime-state="git_manifest"
  >
    <p>Genome runtime manifest is managed by the local storefront.</p>
  </main>
</template>
