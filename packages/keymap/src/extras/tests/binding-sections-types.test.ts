import { resolveBindingSections, type BindingSectionsConfig } from "../binding-sections.js"
import type { Binding } from "../../types.js"

const sectionNames = ["app", "prompt", "dialog_select"] as const
type SectionName = (typeof sectionNames)[number]
type KeymapSections = Record<SectionName, Binding[]>

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
    bindingDefaults({ section, command, binding }) {
      const value: string = `${section}.${command}.${String(binding.key)}`
      return { group: value }
    },
  },
)

const sectionsFromLiteral: KeymapSections = resolvedFromLiteral.sections
const customFromLiteral: Binding[] = resolvedFromLiteral.sections.custom
const pickedFromLiteral: Binding[] = resolvedFromLiteral.pick("app", ["save"])
const omittedFromLiteral: Binding[] = resolvedFromLiteral.omit("app", ["save"])

if (sectionsFromLiteral.prompt.length !== 0) {
  throw new Error("Expected prompt section to be empty")
}
if (customFromLiteral.length !== 1) {
  throw new Error("Expected custom section from literal config")
}
if (pickedFromLiteral.length !== 1) {
  throw new Error("Expected picked bindings from literal config")
}
if (omittedFromLiteral.length !== 0) {
  throw new Error("Expected omitted bindings from literal config")
}

const config: BindingSectionsConfig = {}
const resolvedFromSparseConfig = resolveBindingSections(config, {
  sections: sectionNames,
})

const sectionsFromSparseConfig: KeymapSections = resolvedFromSparseConfig.sections
const pickedFromSparseConfig: Binding[] = resolvedFromSparseConfig.pick("app", ["save"])
const omittedFromSparseConfig: Binding[] = resolvedFromSparseConfig.omit("app", ["save"])
// @ts-expect-error Unknown sections are not guaranteed by the literal sections option.
const missingFromSparseConfig: Binding[] = resolvedFromSparseConfig.sections.missing

if (sectionsFromSparseConfig.app.length !== 0) {
  throw new Error("Expected app section to be empty")
}
if (pickedFromSparseConfig.length !== 0) {
  throw new Error("Expected picked bindings from sparse config to be empty")
}
if (omittedFromSparseConfig.length !== 0) {
  throw new Error("Expected omitted bindings from sparse config to be empty")
}
if (missingFromSparseConfig !== undefined) {
  throw new Error("Expected missing section to be undefined")
}
