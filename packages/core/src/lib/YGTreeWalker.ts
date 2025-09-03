import type { Renderable } from "../Renderable"

export type YGAcceptFn = (node: Renderable) => boolean

export class YGTreeWalker {
    public readonly root: Renderable
    private _current: Renderable
    private readonly accept?: YGAcceptFn

    constructor(root: Renderable, accept?: YGAcceptFn) {
        this.root = root
        this._current = root
        this.accept = accept
    }

    public get currentNode(): Renderable {
        return this._current
    }

    public set currentNode(node: Renderable) {
        this._current = node
    }

    private getParent(node: Renderable): Renderable | null {
        return node.parent || null
    }

    private getFirstChild(node: Renderable): Renderable | null {
        const children = node.getChildren()
        return children.length > 0 ? children[0] : null
    }

    private getLastChild(node: Renderable): Renderable | null {
        const children = node.getChildren()
        return children.length > 0 ? children[children.length - 1] : null
    }

    private getNextSibling(node: Renderable): Renderable | null {
        const parent = this.getParent(node)
        if (!parent) return null
        const siblings = parent.getChildren()
        const idx = siblings.indexOf(node)
        if (idx === -1) return null
        return idx + 1 < siblings.length ? siblings[idx + 1] : null
    }

    private getPrevSibling(node: Renderable): Renderable | null {
        const parent = this.getParent(node)
        if (!parent) return null
        const siblings = parent.getChildren()
        const idx = siblings.indexOf(node)
        if (idx <= 0) return null
        return siblings[idx - 1]
    }

    private nextRaw(from: Renderable): Renderable | null {
        const child = this.getFirstChild(from)
        if (child) return child
        let node: Renderable | null = from
        while (node) {
            const sibling = this.getNextSibling(node)
            if (sibling) return sibling
            node = this.getParent(node)
        }
        return null
    }

    private prevRaw(from: Renderable): Renderable | null {
        const prevSibling = this.getPrevSibling(from)
        if (prevSibling) {
            let deepest: Renderable = prevSibling
            for (; ;) {
                const child = this.getLastChild(deepest)
                if (!child) break
                deepest = child
            }
            return deepest
        }
        const parent = this.getParent(from)
        return parent
    }

    public firstAccepted(): Renderable | null {
        const stack: Renderable[] = [this.root]
        while (stack.length > 0) {
            const node = stack.shift() as Renderable
            if (!this.accept || this.accept(node)) return node
            const children = node.getChildren()
            for (let i = 0; i < children.length; i++) {
                stack.splice(i, 0, children[i])
            }
        }
        return null
    }

    public lastAccepted(): Renderable | null {
        let node: Renderable | null = this.root
        // descend to the deepest last
        while (true) {
            const lastChild: Renderable | null = node ? this.getLastChild(node) : null
            if (!lastChild) break
            node = lastChild
        }
        // climb backwards until accepted
        while (node) {
            if (!this.accept || this.accept(node)) return node
            node = this.prevRaw(node)
        }
        return null
    }

    public nextAccepted(): Renderable | null {
        let node: Renderable | null = this._current
        while (true) {
            node = node ? this.nextRaw(node) : null
            if (!node) return null
            if (!this.accept || this.accept(node)) return node
        }
    }

    public prevAccepted(): Renderable | null {
        let node: Renderable | null = this._current
        while (true) {
            node = node ? this.prevRaw(node) : null
            if (!node) return null
            if (!this.accept || this.accept(node)) return node
        }
    }
}

