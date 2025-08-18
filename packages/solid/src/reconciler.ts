/* @refresh skip */
import {
  InputRenderable,
  InputRenderableEvents,
  Renderable,
  SelectRenderable,
  SelectRenderableEvents,
  StyledText,
  TextRenderable,
  type TextChunk,
} from "@opentui/core";
import { createRenderer } from "solid-js/universal";
import { elements, type Element } from "./elements";
import { getNextId } from "./utils/id-counter";

class TextNode {
  id: string;
  chunk: TextChunk;
  parent?: Renderable;

  constructor(chunk: TextChunk) {
    this.id = getNextId("text-node");
    this.chunk = chunk;
  }
}
const ChunkToTextNodeMap = new WeakMap<TextChunk, TextNode>();

type DomNode = Renderable | TextNode;

const log = (...args: any[]) => {
  console.log("[Reconciler]", ...args);
};

function _insertNode(parent: DomNode, node: DomNode, anchor?: DomNode | null): void {
  log("Inserting node:", node.id, "into parent:", parent.id, "with anchor:", anchor?.id);

  if (node instanceof TextNode) {
    // Text nodes
    if (!(parent instanceof TextRenderable)) {
      throw new Error(`Cannot insert text:"${node.chunk.plainText}" unless wrapped with a <text> element.`);
    }
    const styledText = parent.content;

    if (anchor && anchor instanceof TextNode) {
      const anchorIndex = styledText.chunks.indexOf(anchor.chunk);
      if (anchorIndex == -1) {
        console.log("anchor not found");
        return;
      }
      styledText.insert(node.chunk, anchorIndex);
    } else {
      const firstChunk = parent.content.chunks[0];
      // Handles the default unlinked chunk
      if (firstChunk && !ChunkToTextNodeMap.has(firstChunk)) {
        styledText.replace(node.chunk, firstChunk);
      } else {
        styledText.insert(node.chunk);
      }
    }
    parent.content = styledText;
    node.parent = parent;
    return;
  }

  // Renderable nodes
  if (!(parent instanceof Renderable)) {
    return;
  }

  if (anchor) {
    const anchorIndex = parent.getChildren().findIndex((el) => el.id === anchor.id);
    parent.add(node, anchorIndex);
  } else {
    parent.add(node);
  }
}

function _removeNode(parent: DomNode, node: DomNode): void {
  log("Removing node:", node.id, "from parent:", parent.id);
  if (parent instanceof TextRenderable && node instanceof TextNode) {
    ChunkToTextNodeMap.delete(node.chunk);
    const styledText = parent.content;
    styledText.remove(node.chunk);
    parent.content = styledText;
  } else if (parent instanceof Renderable && node instanceof Renderable) {
    node.destroyRecursively();
    parent.remove(node.id);
  }
}

export const {
  render: _render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert: solidUniversalInsert,
  spread,
  setProp,
  mergeProps,
  use,
} = createRenderer<DomNode>({
  createElement(tagName: string): DomNode {
    log("Creating element:", tagName);
    const id = getNextId(tagName);
    const element = new elements[tagName as Element](id, {});
    log("Element created with id:", id);
    return element;
  },

  createTextNode(value: string | number | boolean | TextChunk): DomNode {
    log("Creating text node:", value);
    const chunk: TextChunk =
      typeof value === "object" && "__isChunk" in value
        ? value
        : {
            __isChunk: true,
            text: new TextEncoder().encode(`${value}`),
            plainText: `${value}`,
          };
    const textNode = new TextNode(chunk);
    ChunkToTextNodeMap.set(chunk, textNode);
    return textNode;
  },

  replaceText(textNode: DomNode, value: string): void {
    log("Replacing text:", value, "in node:", textNode.id);
    if (textNode instanceof Renderable) return;
    const newChunk: TextChunk = {
      __isChunk: true,
      text: new TextEncoder().encode(value),
      plainText: value,
    };

    const parent = textNode.parent;
    if (!parent) {
      log("No parent found for text node:", textNode.id);
      return;
    }
    if (parent instanceof TextRenderable) {
      const styledText = parent.content;
      styledText.replace(newChunk, textNode.chunk);
      parent.content = styledText;

      textNode.chunk = newChunk;
      ChunkToTextNodeMap.set(newChunk, textNode);
    }
  },

  setProperty(node: DomNode, name: string, value: any, prev: any): void {
    // log("Setting property:", name, "on node:", node.id);
    if (node instanceof TextNode) {
      // TODO: implement <b> and <i> tags property setters here
      console.warn("Cannot set property on text node:", node.id);
      return;
    }

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
          // @ts-expect-error todo validate if prop is actually settable
          node[prop] = propVal;
        }
        break;
      case "text":
      case "content":
        // @ts-expect-error todo validate if prop is actually settable
        node[name] = typeof value === "string" ? value : Array.isArray(value) ? value.join("") : `${value}`;
        break;
      default:
        // @ts-expect-error todo validate if prop is actually settable
        node[name] = value;
    }
  },

  isTextNode(node: DomNode): boolean {
    return node instanceof TextNode;
  },

  insertNode: _insertNode,

  removeNode: _removeNode,

  getParentNode(node: DomNode): DomNode | undefined {
    log("Getting parent of node:", node.id);
    const parent = node.parent;

    if (!parent) {
      log("No parent found for node:", node.id);
      return undefined;
    }

    log("Parent found:", parent.id, "for node:", node.id);
    return parent;
  },

  getFirstChild(node: DomNode): DomNode | undefined {
    log("Getting first child of node:", node.id);
    if (node instanceof TextRenderable) {
      const chunk = node.content.chunks[0];
      if (chunk) {
        return ChunkToTextNodeMap.get(chunk);
      } else {
        return undefined;
      }
    }
    if (node instanceof TextNode) {
      return undefined;
    }
    const firstChild = node.getChildren()[0];

    if (!firstChild) {
      log("No first child found for node:", node.id);
      return undefined;
    }

    log("First child found:", firstChild.id, "for node:", node.id);
    return firstChild;
  },

  getNextSibling(node: DomNode): DomNode | undefined {
    log("Getting next sibling of node:", node.id);
    const parent = node.parent;
    if (!parent) {
      log("No parent found for node:", node.id);
      return undefined;
    }

    if (node instanceof TextNode) {
      if (parent instanceof TextRenderable) {
        const siblings = parent.content.chunks;
        const index = siblings.indexOf(node.chunk);

        if (index === -1 || index === siblings.length - 1) {
          log("No next sibling found for node:", node.id);
          return undefined;
        }

        const nextSibling = siblings[index + 1];

        if (!nextSibling) {
          log("Next sibling is null for node:", node.id);
          return undefined;
        }

        return ChunkToTextNodeMap.get(nextSibling);
      }
      console.warn("Text parent is not a text node:", node.id);
      return undefined;
    }

    const siblings = parent.getChildren();
    const index = siblings.indexOf(node);

    if (index === -1 || index === siblings.length - 1) {
      log("No next sibling found for node:", node.id);
      return undefined;
    }

    const nextSibling = siblings[index + 1];

    if (!nextSibling) {
      log("Next sibling is null for node:", node.id);
      return undefined;
    }

    log("Next sibling found:", nextSibling.id, "for node:", node.id);
    return nextSibling;
  },
});

const insertStyledText = (parent: any, value: any, current: any, marker: any) => {
  while (typeof current === "function") current = current();
  if (value === current) return current;

  if (current) {
    if (typeof current === "object" && "__isChunk" in current) {
      // log("[Reconciler] Removing current:", current);
      const node = ChunkToTextNodeMap.get(current);
      if (node) {
        // log("[Reconciler] Removing chunk:", current.text);
        _removeNode(parent, node);
      }
    } else if (current instanceof StyledText) {
      // log("[Reconciler] Removing current:", current);
      for (const chunk of current.chunks) {
        const chunkNode = ChunkToTextNodeMap.get(chunk);
        if (!chunkNode) continue;
        // log("[Reconciler] Removing styled text:", chunk.text);
        _removeNode(parent, chunkNode);
      }
    }
  }

  if (value instanceof StyledText) {
    log("Inserting styled text:", value.toString());
    for (const chunk of value.chunks) {
      // @ts-expect-error: Sending chunk to createTextNode which is not typed but supported
      insertNode(parent, createTextNode(chunk), marker);
    }
    return value;
  } else if (value && typeof value === "object" && "__isChunk" in value) {
    insertNode(parent, createTextNode(value), marker);
    return value;
  }
  return solidUniversalInsert(parent, value, marker, current);
};

export const insert: typeof solidUniversalInsert = (parent, accessor, marker, initial) => {
  if (marker !== undefined && !initial) initial = [];
  if (typeof accessor !== "function") return insertStyledText(parent, accessor, initial, marker);
  // @ts-expect-error: Copied from js implementation, not typed
  effect((current) => insertStyledText(parent, accessor(), current, marker), initial);
};
