/* @refresh skip */
import { createRenderer } from "solid-js/universal";
import { getNextId } from "./utils/id-counter";
import {
  InputRenderable,
  InputRenderableEvents,
  Renderable,
  SelectRenderable,
  SelectRenderableEvents,
} from "@opentui/core";
import { elements, type Element } from "./elements";

type DomNode = Renderable;

const log = (...args: any[]) => {
  console.log("[Reconciler]", ...args);
};

export const {
  render: _render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
} = createRenderer<DomNode>({
  createElement(tagName: string): DomNode {
    log("[Reconciler] Creating element:", tagName);
    const id = getNextId(tagName);
    const element = new elements[tagName as Element](id, {});
    log("[Reconciler] Element created with id:", id, element.id);
    return element;
  },

  createTextNode(value: string): DomNode {
    throw new Error("Not implemented");
  },

  replaceText(textNode: DomNode, value: string): void {},

  setProperty(node: DomNode, name: string, value: any, prev: any): void {
    log("[Reconciler] Setting property:", name, "on node:", node.id, "value:", value);

    if (name.startsWith("on:")) {
      const eventName = name.slice(3);
      if (value) {
        node.on(eventName, value);
      }
      if (prev) {
        node.off(eventName, prev);
      }

      return;
    }

    switch (name) {
      case "focused":
        if (value) {
          node.focus();
        } else {
          node.blur();
        }
        break;
      case "onChange":
        if (node instanceof SelectRenderable) {
          node.on(SelectRenderableEvents.SELECTION_CHANGED, value);

          if (prev) {
            node.off(SelectRenderableEvents.SELECTION_CHANGED, prev);
          }
        } else if (node instanceof InputRenderable) {
          node.on(InputRenderableEvents.CHANGE, value);

          if (prev) {
            node.off(InputRenderableEvents.CHANGE, prev);
          }
        }
        break;
      case "onInput":
        if (node instanceof InputRenderable) {
          node.on(InputRenderableEvents.INPUT, value);

          if (prev) {
            node.off(InputRenderableEvents.INPUT, prev);
          }
        }

        break;
      case "onSubmit":
        if (node instanceof InputRenderable) {
          node.on(InputRenderableEvents.ENTER, value);

          if (prev) {
            node.off(InputRenderableEvents.ENTER, prev);
          }
        }
        break;
      case "onSelect":
        if (node instanceof SelectRenderable) {
          node.on(SelectRenderableEvents.ITEM_SELECTED, value);

          if (prev) {
            node.off(SelectRenderableEvents.ITEM_SELECTED, prev);
          }
        }
        break;
      case "style":
        for (const prop in value) {
          const propVal = value[prop];
          if (prev !== undefined && propVal === prev[prop]) continue;
          node[prop] = propVal;
        }
        break;
      case "text":
      case "content":
        node[name] = typeof value === "string" ? value : Array.isArray(value) ? value.join("") : `${value}`;
        break;
      default:
        node[name] = value;
    }
  },

  insertNode(parent: DomNode, node: DomNode, anchor?: DomNode | null): void {
    log("[Reconciler] Inserting node:", node.id, "into parent:", parent.id, "with anchor:", anchor?.id);
    if (anchor) {
      const anchorIndex = parent.getChildren().findIndex((el) => el.id === anchor.id);
      parent.add(node, anchorIndex);
    } else {
      parent.add(node);
    }
  },

  isTextNode(node: DomNode): boolean {
    return false;
  },

  removeNode(parent: DomNode, node: DomNode): void {
    log("[Reconciler] Removing node:", node.id, "from parent:", parent.id);
    parent.remove(node.id);
  },

  getParentNode(node: DomNode): DomNode | undefined {
    log("[Reconciler] Getting parent of node:", node.id);
    const parent = node.parent;

    if (!parent) {
      log("[Reconciler] No parent found for node:", node.id);
      return undefined;
    }

    log("[Reconciler] Parent found:", parent.id, "for node:", node.id);
    return parent;
  },

  getFirstChild(node: DomNode): DomNode | undefined {
    log("[Reconciler] Getting first child of node:", node.id);
    const firstChild = node.getChildren()[0];

    if (!firstChild) {
      log("[Reconciler] No first child found for node:", node.id);
      return undefined;
    }

    log("[Reconciler] First child found:", firstChild.id, "for node:", node.id);
    return firstChild;
  },

  getNextSibling(node: DomNode): DomNode | undefined {
    log("[Reconciler] Getting next sibling of node:", node.id);
    const getParent = node.parent;
    if (!getParent) {
      log("[Reconciler] No parent found for node:", node.id);
      return undefined;
    }

    const siblings = getParent.getChildren();
    const index = siblings.findIndex((el) => el.id === node.id);

    if (index === -1 || index === siblings.length - 1) {
      log("[Reconciler] No next sibling found for node:", node.id);
      return undefined;
    }

    const nextSibling = siblings[index + 1];

    if (!nextSibling) {
      log("[Reconciler] Next sibling is null for node:", node.id);
      return undefined;
    }

    log("[Reconciler] Next sibling found:", nextSibling.id, "for node:", node.id);
    return nextSibling;
  },
});
