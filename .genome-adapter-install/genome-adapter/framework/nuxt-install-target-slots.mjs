import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const targetMapPath = existsSync(resolve("app/genome-target-map.json"))
  ? resolve("app/genome-target-map.json")
  : resolve("genome-target-map.json")
const targetMap = JSON.parse(readFileSync(targetMapPath, "utf8"))

function targetPathFor(slot) {
  return slot.componentPath || slot.filePath
}

function addAttributeToFirstTemplateElement(content, slotName) {
  const attribute = `data-genome-slot="${slotName}"`

  if (content.includes(attribute)) {
    return content
  }

  return content.replace(
    /(<template>\s*)<([A-Za-z][\w:-]*)([^>]*)>/,
    (_match, prefix, tag, attrs) => `${prefix}<${tag} ${attribute}${attrs}>`,
  )
}

function addAttributeToProductGrid(content) {
  const attribute = 'data-genome-slot="product_grid"'

  if (content.includes(attribute)) {
    return content
  }

  const targeted = content.replace(
    /<(div|section)([^>]*class=["'][^"']*(?:grid|overflow-x-scroll|products?)[^"']*["'][^>]*)>/i,
    (_match, tag, attrs) => `<${tag} ${attribute}${attrs}>`,
  )

  return targeted === content ? addAttributeToFirstTemplateElement(content, "product_grid") : targeted
}

function patchSlot(slot) {
  if (slot.operatorConfirmed !== true) {
    return
  }

  const path = targetPathFor(slot)

  if (!path || !path.endsWith(".vue")) {
    return
  }

  const absolutePath = resolve(path)
  let content

  try {
    content = readFileSync(absolutePath, "utf8")
  } catch {
    return
  }

  const nextContent =
    slot.slot === "product_grid"
      ? addAttributeToProductGrid(content)
      : addAttributeToFirstTemplateElement(content, slot.slot)

  if (nextContent !== content) {
    writeFileSync(absolutePath, nextContent)
    console.log(`Genome target slot installed: ${slot.slot} -> ${path}`)
  }
}

for (const slot of targetMap.slots || []) {
  patchSlot(slot)
}
