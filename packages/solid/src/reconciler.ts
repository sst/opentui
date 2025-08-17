/* @refresh skip */
import { createRenderer } from "solid-js/universal";
import { getNextId } from "./utils/id-counter";
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
import { elements, type Element } from "./elements";
import { onCleanup } from "solid-js";

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
  log("[Reconciler] Inserting node:", node.id, "into parent:", parent.id, "with anchor:", anchor?.id);
  if (parent instanceof TextRenderable && node instanceof TextNode) {
    let chunks = [...parent.content.chunks];
    let plainText = parent.content.toString();
    if (anchor && anchor instanceof TextNode) {
      const anchorIndex = chunks.indexOf(anchor.chunk);
      const textSplitIndex = chunks.slice(0, anchorIndex).reduce((acc, chunk) => acc + chunk.plainText.length, 0);

      plainText = [plainText.slice(0, textSplitIndex), node.chunk.plainText, plainText.slice(textSplitIndex)].join("");
      chunks.splice(anchorIndex, 0, node.chunk);
    } else {
      chunks.push(node.chunk);
      plainText += node.chunk.plainText;
    }
    parent.content = new StyledText(chunks, parent.content.length + node.chunk.plainText.length, plainText);
    node.parent = parent;
  } else if (parent instanceof Renderable && node instanceof Renderable) {
    if (anchor) {
      const anchorIndex = parent.getChildren().findIndex((el) => el.id === anchor.id);
      parent.add(node, anchorIndex);
    } else {
      parent.add(node);
    }
  } else {
    throw new Error("Invalid parent or child node");
  }
}

function _removeNode(parent: DomNode, node: DomNode): void {
  log("[Reconciler] Removing node:", node.id, "from parent:", parent.id);
  if (parent instanceof TextRenderable && node instanceof TextNode) {
    ChunkToTextNodeMap.delete(node.chunk);
    const chunks = parent.content.chunks;
    const index = chunks.indexOf(node.chunk);
    const plainTextIndex = chunks.slice(0, index).reduce((acc, chunk) => acc + chunk.plainText.length, 0);
    chunks.splice(index, 1);
    parent.content = new StyledText(
      chunks.toSpliced(index, 1),
      parent.content.length - node.chunk.plainText.length,
      parent.content.toString().substring(0, plainTextIndex) +
        parent.content.toString().substring(plainTextIndex + node.chunk.plainText.length),
    );
  } else if (parent instanceof Renderable && node instanceof Renderable) {
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
    log("[Reconciler] Creating element:", tagName);
    const id = getNextId(tagName);
    const element = new elements[tagName as Element](id, {});
    log("[Reconciler] Element created with id:", id, element.id);
    onCleanup(() => {
      element.destroy();
    });
    return element;
  },

  createTextNode(value: string | number | boolean | TextChunk): DomNode {
    log("[Reconciler] Creating text node:", value);
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
    log("[Reconciler] Replacing text:", value, "in node:", textNode.id);
    if (textNode instanceof Renderable) return;
    const newChunk: TextChunk = {
      __isChunk: true,
      text: new TextEncoder().encode(value),
      plainText: value,
    };

    const parent = textNode.parent;
    if (!parent) {
      log("[Reconciler] No parent found for text node:", textNode.id);
      return;
    }
    if (parent instanceof TextRenderable) {
      const childIndex = parent.content.chunks.indexOf(textNode.chunk);
      if (childIndex === -1) {
        log("[Reconciler] Text node not found in parent:", parent.id);
        return;
      }

      _removeNode(parent, textNode);

      textNode.chunk = newChunk;
      ChunkToTextNodeMap.set(newChunk, textNode);

      if (parent.content.chunks.length === 0) {
        _insertNode(parent, textNode);
      } else {
        const prev = parent.content.chunks.at(childIndex);
        const prevNode = prev ? ChunkToTextNodeMap.get(prev) : undefined;
        _insertNode(parent, textNode, prevNode);
      }
    }
  },

  setProperty(node: DomNode, name: string, value: any, prev: any): void {
    log("[Reconciler] Setting property:", name, "on node:", node.id, "value:", value);
    if (node instanceof TextNode) {
      console.warn("[Reconciler] Cannot set property on text node:", node.id);
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

  isTextNode(node: DomNode): boolean {
    return node instanceof TextNode;
  },

  insertNode: _insertNode,

  removeNode: _removeNode,

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
      log("[Reconciler] No first child found for node:", node.id);
      return undefined;
    }

    log("[Reconciler] First child found:", firstChild.id, "for node:", node.id);
    return firstChild;
  },

  getNextSibling(node: DomNode): DomNode | undefined {
    log("[Reconciler] Getting next sibling of node:", node.id);
    const parent = node.parent;
    if (!parent) {
      log("[Reconciler] No parent found for node:", node.id);
      return undefined;
    }

    if (node instanceof TextNode) {
      if (parent instanceof TextRenderable) {
        const siblings = parent.content.chunks;
        const index = siblings.indexOf(node.chunk);

        if (index === -1 || index === siblings.length - 1) {
          log("[Reconciler] No next sibling found for node:", node.id);
          return undefined;
        }

        const nextSibling = siblings[index + 1];

        if (!nextSibling) {
          log("[Reconciler] Next sibling is null for node:", node.id);
          return undefined;
        }

        return ChunkToTextNodeMap.get(nextSibling);
      }
      console.warn("[Reconciler] Text parent is not a text node:", node.id);
      return undefined;
    }

    const siblings = parent.getChildren();
    const index = siblings.indexOf(node);

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

// TODO: Support chunk arrays
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
    console.log("[Reconciler] Inserting styled text:", value.toString());
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
