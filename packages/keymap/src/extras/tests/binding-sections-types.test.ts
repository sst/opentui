import { resolveBindingSections, type BindingSectionsConfig } from "../binding-sections.js"
import type { BindingInput } from "../../types.js"

const sectionNames = ["app", "prompt", "dialog_select"] as const
type SectionName = (typeof sectionNames)[number]
type KeymapSections = Record<SectionName, BindingInput[]>

const resolvedFromLiteral = resolveBindingSections(
  {
    app: {
      save: "s",
    },
    custom: {
      run: "r",
    },
  },
  {
    sections: sectionNames,
  },
)

const sectionsFromLiteral: KeymapSections = resolvedFromLiteral.sections
const customFromLiteral: BindingInput[] = resolvedFromLiteral.sections.custom

if (sectionsFromLiteral.prompt.length !== 0) {
  throw new Error("Expected prompt section to be empty")
}
if (customFromLiteral.length !== 1) {
  throw new Error("Expected custom section from literal config")
}

const config: BindingSectionsConfig = {}
const resolvedFromSparseConfig = resolveBindingSections(config, {
  sections: sectionNames,
})

const sectionsFromSparseConfig: KeymapSections = resolvedFromSparseConfig.sections
// @ts-expect-error Unknown sections are not guaranteed by the literal sections option.
const missingFromSparseConfig: BindingInput[] = resolvedFromSparseConfig.sections.missing

if (sectionsFromSparseConfig.app.length !== 0) {
  throw new Error("Expected app section to be empty")
}
if (missingFromSparseConfig !== undefined) {
  throw new Error("Expected missing section to be undefined")
}
