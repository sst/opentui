import { getKeyHandler } from "./KeyHandler"
import type { Renderable } from "../Renderable"
import { YGTreeWalker } from "./YGTreeWalker"
import type { ParsedKey } from "./parse.keypress"

export class FocusManager {
    private static instance: FocusManager | null = null

    private keyUnsubscribe: (() => void) | null = null
    private root: Renderable | null = null
    private current: Renderable | null = null
    private walker: YGTreeWalker | null = null;

    static install(root: Renderable): FocusManager {
        if (this.instance) return this.instance
        this.instance = new FocusManager(root)
        this.instance.attach()
        this.instance.findFirstFocusable()
        return this.instance
    }

    constructor(root: Renderable) {
        this.root = root
    }

    private createWalker(): YGTreeWalker | null {
        if (!this.root) return null
        return new YGTreeWalker(this.root, (n) => this.isFocusable(n))
    }

    private getWalker(): YGTreeWalker {
        if (!this.walker) this.walker = this.createWalker();
        if (this.current && this.walker) this.walker.currentNode = this.current;
        return this.walker!;
    }

    public detachWalker(): void {
        this.walker = null
    }

    static uninstall(): void {
        this.instance?.detach()
        this.instance = null
    }

    private attach(): void {
        const keyHandler = getKeyHandler()
        const keypress = (key: ParsedKey) => {
            if (key.name === "tab") {
                key.shift ? this.focusPrev() : this.focusNext()
            }
        }
        keyHandler.on("keypress", keypress)
        this.keyUnsubscribe = () => keyHandler.off("keypress", keypress)
    }

    private detach(): void {
        this.keyUnsubscribe?.()
        this.keyUnsubscribe = null
        this.current = null
        this.walker = null
    }

    private isFocusable(r: Renderable): boolean { return r["focusable"] === true && r.visible === true }

    private findFirstFocusable(): Renderable | null {
        const walker = this.getWalker()
        if (!walker) return null
        return walker.firstAccepted()
    }

    private findNextFocusable(): Renderable | null {
        const walker = this.getWalker()
        if (!walker) return null
        const next = walker.nextAccepted()
        return next ?? walker.firstAccepted()
    }

    private focusNext() {
        const next = this.findNextFocusable()
        if (!next) return

        if (this.current) this.current.blur()
        this.current = next
        this.current.focus()
    }

    private findPrevFocusable(): Renderable | null {
        const walker = this.getWalker()
        if (!walker) return null
        const prev = walker.prevAccepted()
        return prev ?? walker.lastAccepted()
    }

    private focusPrev() {
        const prev = this.findPrevFocusable()
        if (!prev) return

        if (this.current) this.current.blur()
        this.current = prev
        this.current.focus()
    }
}
