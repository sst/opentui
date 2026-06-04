import { describe, expect, it } from "bun:test"
import { renderLatexToString } from "./latex.js"

describe("@opentui/latex renderer", () => {
  it("renders display-style limits for large operators", () => {
    expect(renderLatexToString(String.raw`\sum_{i=1}^{n} x_i`)).toMatchInlineSnapshot(`
      " 𝑛
       ∑  𝑥ᵢ
      𝑖=1"
    `)
  })

  it("keeps large operators compact in inline layout", () => {
    expect(renderLatexToString(String.raw`\sum_{i=1}^{n} x_i`, { layout: "inline" })).toBe("∑ᵢ₌₁ⁿ 𝑥ᵢ")
  })

  it("renders compact inline limits and simple fractions", () => {
    expect(
      renderLatexToString(String.raw`\frac{dy}{dx} = \lim_{h \to 0}\frac{f(x+h)-f(x)}{h}`, { layout: "inline" }),
    ).toBe("𝑑𝑦/𝑑𝑥 = lim ℎ → 0 (𝑓(𝑥+ℎ) - 𝑓(𝑥))/ℎ")
  })

  it("renders display-style limits", () => {
    expect(renderLatexToString(String.raw`\lim_{h \to 0} \frac{f(x+h)-f(x)}{h}`)).toMatchInlineSnapshot(`
      "      𝑓(𝑥+ℎ) - 𝑓(𝑥)
       lim  ─────────────
      ℎ → 0       ℎ"
    `)
  })

  it("renders display-style integral bounds", () => {
    expect(renderLatexToString(String.raw`\int_{0}^{\infty} e^{-x^2}\,dx`)).toMatchInlineSnapshot(`
      "∞
      ⌠
      ⎮ 𝑒^(-x²) 𝑑𝑥
      ⌡
      0"
    `)
  })

  it("renders multiline square roots as an enclosure", () => {
    expect(renderLatexToString(String.raw`\sqrt{1 + \frac{x^2}{1 - x^2}}`)).toMatchInlineSnapshot(`
      "  ┌───────────
        │       𝑥²
      √ │ 1 + ──────
        │     1 - 𝑥²"
    `)
  })

  it("renders indexed roots with dedicated glyphs when available", () => {
    expect(renderLatexToString(String.raw`\sqrt[3]{x} + \sqrt[4]{y}`)).toBe("∛𝑥 + ∜𝑦")
  })

  it("renders multiline cube roots with a cube-root marker", () => {
    expect(renderLatexToString(String.raw`\sqrt[3]{1 + \frac{x^2}{1 - x^2}}`)).toMatchInlineSnapshot(`
      "  ┌───────────
        │       𝑥²
      ∛ │ 1 + ──────
        │     1 - 𝑥²"
    `)
  })

  it("renders arbitrary indexed roots with an upper-left index", () => {
    expect(renderLatexToString(String.raw`\sqrt[5]{1 + \frac{x^2}{1 - x^2}}`)).toMatchInlineSnapshot(`
      "⁵ ┌───────────
        │       𝑥²
      √ │ 1 + ──────
        │     1 - 𝑥²"
    `)
  })

  it("renders Cauchy integral formula with math-style text layout", () => {
    expect(renderLatexToString(String.raw`f(a) = \frac{1}{2\pi i}\oint_{\gamma}\frac{f(z)}{z-a}\,dz`))
      .toMatchInlineSnapshot(`
      "        1     𝑓(𝑧)
      𝑓(𝑎) = ──── ∮ ───── 𝑑𝑧
             2π 𝑖 γ 𝑧 - 𝑎"
    `)
  })
})
