import { createCliRenderer, type CliRendererConfig } from "@opentui/core";
import type { JSX } from "solid-js";
import { createComponent, _render } from "./src/reconciler";
import { RendererContext } from "./src/elements";

export * from "./src/elements";

export const render = async (node: JSX.Element, renderConfig: CliRendererConfig = {}) => {
  const renderer = await createCliRenderer(renderConfig);

  _render(
    () => createComponent(RendererContext.Provider, { value: renderer, children: node }),
    renderer.root,
  );
};
