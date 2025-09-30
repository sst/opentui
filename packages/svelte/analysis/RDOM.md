# Restricted DOM (RDOM) API Specification

## Status: ✅ IMPLEMENTED

This document lists the 60 DOM APIs required by Svelte 5's runtime. These have been **fully implemented** in `../src/dom.ts` (489 lines).

**Implementation**: DOM-Only approach (Approach 5 from dom-cover.md)

- `TUINode` class (lines 71-197): Implements Node API
- `TUIElement` class (lines 200-406): Implements Element API
- `TUIDocument` class (lines 439-489): Implements Document API
- Property mapping system (lines 14-48): Maps DOM properties to Renderable properties

See `../src/dom.ts` for full implementation details.

## Global Objects

### document

- document.createElement(tagName, options?)
- document.createElementNS(namespace, tagName, options?)
- document.createTextNode(data)
- document.createComment(data)
- document.createDocumentFragment()
- document.importNode(node, deep)
- document.baseURI
- document.head
- document.body
- document.activeElement
- document.addEventListener(type, handler, options)
- document.removeEventListener(type, handler, options)
- document.dispatchEvent(event)

### window

- window.scrollX
- window.scrollY
- window.scrollTo(x, y)
- window.innerWidth
- window.innerHeight
- window.outerWidth
- window.outerHeight
- window.addEventListener(type, handler, options)
- window.removeEventListener(type, handler, options)
- window.\_\_svelte (for unique IDs)

### navigator

- navigator.onLine
- navigator.userAgent

## Node Interface

### Properties (Read)

- node.nodeType
- node.nodeName
- node.nodeValue
- node.firstChild
- node.lastChild
- node.nextSibling
- node.previousSibling
- node.parentNode
- node.childNodes
- node.textContent
- node.isConnected

### Properties (Write)

- node.nodeValue = value
- node.textContent = value

### Methods

- node.appendChild(child)
- node.removeChild(child)
- node.insertBefore(newNode, referenceNode)
- node.replaceChild(newNode, oldNode)
- node.cloneNode(deep)
- node.before(...nodes)
- node.after(...nodes)
- node.replaceWith(...nodes)
- node.remove()

## Element Interface

### Properties (Read)

- element.tagName
- element.id
- element.className
- element.classList
- element.attributes
- element.innerHTML
- element.outerHTML
- element.namespaceURI
- element.scrollWidth
- element.scrollHeight
- element.clientWidth
- element.clientHeight
- element.offsetWidth
- element.offsetHeight

### Properties (Write)

- element.id = value
- element.className = value
- element.innerHTML = value
- element.style (CSSStyleDeclaration)
- element[customProperty] = value

### Methods

- element.getAttribute(name)
- element.setAttribute(name, value)
- element.removeAttribute(name)
- element.hasAttribute(name)
- element.setAttributeNS(namespace, name, value)
- element.addEventListener(type, handler, options)
- element.removeEventListener(type, handler, options)
- element.dispatchEvent(event)
- element.focus()
- element.blur()
- element.click()
- element.querySelector(selector)
- element.querySelectorAll(selector)
- element.getBoundingClientRect()
- element.getComputedStyle()
- element.append(...nodes)
- element.prepend(...nodes)
- element.classList.add(...classes)
- element.classList.remove(...classes)
- element.classList.toggle(class, force?)
- element.classList.contains(class)

## HTMLElement Specific

### Input Elements

- input.value
- input.defaultValue
- input.checked
- input.defaultChecked
- input.type
- input.files
- input.selectionStart
- input.selectionEnd
- input.setSelectionRange(start, end)

### Select Elements

- select.value
- select.selectedIndex
- select.options
- select.multiple
- option.selected
- option.value
- option.text
- option.defaultSelected

### TextArea Elements

- textarea.value
- textarea.defaultValue
- textarea.selectionStart
- textarea.selectionEnd

### Media Elements

- media.play()
- media.pause()
- media.muted
- media.paused
- media.volume
- media.playbackRate
- media.currentTime
- media.duration
- media.buffered
- media.played
- media.seekable
- media.seeking
- media.ended
- media.readyState

### Form Elements

- form.elements
- form.reset()
- form.submit()

### Template Elements

- template.content
- template.innerHTML

## Style Manipulation

### CSSStyleDeclaration

- style.cssText
- style.getPropertyValue(property)
- style.setProperty(property, value, priority?)
- style.removeProperty(property)
- style[property] = value

## Event System

### Event Object

- event.type
- event.target
- event.currentTarget
- event.preventDefault()
- event.stopPropagation()
- event.stopImmediatePropagation()
- event.cancelBubble
- event.bubbles
- event.composed
- event.detail

### Event Types Required

- click, dblclick
- mousedown, mouseup, mousemove, mouseenter, mouseleave, mouseover, mouseout
- keydown, keyup, keypress
- focus, blur, focusin, focusout
- input, change
- submit, reset
- scroll
- resize
- load, error
- touchstart, touchend, touchmove, touchcancel
- pointerdown, pointerup, pointermove, pointerenter, pointerleave
- wheel
- animationstart, animationend, animationiteration
- transitionstart, transitionend

## Other APIs

### ResizeObserver

- new ResizeObserver(callback)
- observer.observe(element)
- observer.unobserve(element)
- observer.disconnect()

### DocumentFragment

- All Node interface methods and properties

### Comment

- All Node interface methods and properties

### Text

- All Node interface methods and properties
- text.splitText(offset)

### Constants

- Node.ELEMENT_NODE = 1
- Node.TEXT_NODE = 3
- Node.COMMENT_NODE = 8
- Node.DOCUMENT_FRAGMENT_NODE = 11

## Custom Properties for Svelte

- element.\_\_attributes
- element.\_\_className
- element.\_\_style
- element.\_\_t (text content cache)
- element.\_\_e (event cache)
- element.\_\_value
- element.\_\_on_r (reset handler)
- window.\_\_svelte (unique ID generation)
