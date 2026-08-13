# OpenTUI Web Design Constraints

This document defines the design language for the OpenTUI website. Use it when
you add, change, or refactor a page.

The website responds to an excess of generated information. It communicates with
less text, fewer visual devices, and clear human choices.

## Core Rule

Show the smallest complete version of the information.

Remove an element when spacing, order, plain text, or a standard HTML element
can do the same work.

## Visual Language

- Use black text on a white background (or dark mode equivalent).
- Use the standard browser link color (but not the visited color) for links.
- Use Berkeley Mono as the primary typeface.
- Use the OpenTUI wordmark as the main brand element.
- Use one centered content column with a clear left edge for content.
  Documentation may use a wider bounded composition (`64rem`) for navigation
  plus content.
- Keep normal content at a narrow reading measure. Use `36rem` as the default maximum width.
- Use GrayText for structural hairlines (code borders, table rows) and the
  text color for rules that carry content weight (table header, callout edge).
- Use monochrome syntax highlighting: plain identifiers, bold keywords, gray
  literals, fainter gray italic comments. Do not introduce hues for code.
- A sticky navigation header uses a translucent page background with backdrop
  blur so passing content stays faintly visible. Keep it opaque where
  `backdrop-filter` is unsupported.
- Let an interactive composition expand only when its content needs more space.
- Keep expanded compositions bounded. They must have visible space on both sides.
- Use whitespace to separate ideas.
- Use native bullets, links, paragraphs, headings, code, images, and video.
- Do not add cards, panels, badges, labels, decorative rules, gradients,
  shadows, rounded containers, or ornamental backgrounds.
- Do not add a visual element only to fill empty space.

## Content

- State what OpenTUI is in one sentence.
- Use short factual statements for its important properties.
- Put one idea in each paragraph or list item.
- Prefer a list to a set of feature sections.
- Use direct words such as “is,” “uses,” “writes,” and “builds.”
- Do not add a subtitle, eyebrow, kicker, caption, or section label when the content works without it.
- Do not repeat a claim in the introduction, list, and footer.
- Keep evidence close to the claim that it supports.
- Keep navigation small and explicit.
- Do not write promotional filler.

## Layout

- Keep one primary left edge for the logo, text, list, links, and footer.
- Center the closed composition in the viewport.
- Do not center each section on a different axis.
- Do not let an expanded element move the page spine.
- Keep the reading width useful at every viewport size.
- Never reduce text to a narrow strip to make room for media.
- Never let media touch a viewport edge on a desktop layout.
- Do not use absolute viewport coordinates for page structure.
- Do not combine a full available width with an added horizontal offset.

## Responsive Behavior

- Use the narrow column for the closed state at every viewport size.
- Use side-by-side media only when both panes keep a useful width and the composition keeps outer gutters.
- Show side-by-side navigation only while the content column keeps at least
  the reading measure. Below that, replace it with a native disclosure above
  the content.
- Stack media above its related text when the side-by-side layout cannot meet those conditions.
- Keep the stacked media width equal to the content width.
- Keep the text width unchanged after the media opens in a stacked layout.
- Do not treat tablet widths as compressed desktop widths.
- Do not allow horizontal page overflow.
- Test closed and open states at `390px`, `768px`, `1025px`, and `1440px` or equivalent boundary sizes.
- Test immediately below and above each layout breakpoint.

## Motion

- Use motion only to explain a change in layout or state.
- Keep motion fast, linear, and mechanical.
- Use movement and hard clipping. Do not use fades, scale effects, bounce, blur, or easing that feels decorative.
- Give each transition one clear direction.
- A right-side reveal moves from left to right.
- Do not reveal media from its center.
- Do not let media and text overlap at any transition frame.
- Reverse the same geometry when the interaction closes.
- Respect `prefers-reduced-motion` and remove nonessential transitions.

## Interaction

- Hide optional media until a person asks for it.
- Make the related text the control when that relationship is clear.
- Support pointer and keyboard input.
- Keep visible keyboard focus.
- Let `Escape` close temporary media.
- Keep native browser behavior unless custom behavior supplies clear value.
- Do not add controls, icons, or instructions that the interaction does not need.

## Implementation

- Build shared page primitives from these rules. Do not copy landing-page CSS
  into each route.
- Keep shared article-content styles (headings, code, tables, callouts) in one
  stylesheet used by documentation and devlog.
- Wrap markdown output (code fences, tables) with shared components at build
  time. Do not rewrite the rendered DOM with scripts.
- Use design tokens only for repeated values such as width, spacing, type,
  color, and motion duration.
- Keep the token set small. A token must represent a design decision, not one
  isolated value.
- Use semantic HTML before a custom component.
- Keep layout ownership in CSS. Do not duplicate breakpoint policy in scripts.
- Use content data only when pages share real structure.
- Remove old styles when a new shared rule replaces them.
- Do not keep compatibility styles without a current consumer.
- Preserve accessible names, focus order, contrast, and reduced-motion behavior
  during visual refactors.

## Documentation Pages

Documentation can be dense because its purpose differs from the landing page.
Density does not permit decoration.

- Keep navigation, search, code, tables, callouts, and hierarchy when they help a person complete a task.
- Apply the same color, typography, spacing, border, and motion restraint.
- Prefer one clear content flow to dashboard layouts.
- Use borders only when they define structure or state.
- Use callouts only for information that needs special attention.
- Do not force reference material into the landing page’s short-list format.
- Keep prose at the `36rem` measure inside the wider docs column. Let code
  blocks and tables grow only when their content needs the width, up to the
  content column.
- Scroll wide code and tables inside their own container, never the page.
- Mark the current page in navigation with the text color, not the link color.
- End each page with previous and next links.
- Make the code copy control text-only. Reveal it on hover or focus; keep it
  visible on touch.
- Prefer monospace box-drawing diagrams in code blocks to image files. They
  inherit the typeface and both themes.

## Exceptions

Accessibility, comprehension, and task completion take priority over visual
minimalism.

Add an element when removing it makes the content unclear, hides state, harms
navigation, or blocks access. The element must solve that specific problem and
use the least visual treatment that works.

## Review Questions

Before a change is complete, ask:

1. Is every word necessary?
2. Is every element necessary?
3. Does the page have one clear alignment?
4. Does the closed state use the narrow reading measure?
5. Does media remain subordinate to the information?
6. Do all open states keep useful text width and outer gutters?
7. Does each transition have one direction and no overlap?
8. Does the page work with a keyboard and reduced motion?
9. Does the page have zero horizontal overflow at all tested sizes?
10. Does the page still look intentional with all optional media closed?
