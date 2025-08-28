# Renderables vs Constructs

Lets look at two ways of composing Renderables, imperative and declarative.
Assume we want to create a simple "login" form with a username and password input.

## Imperative

Creates concrete `Renderable` instances with a `RenderContext` and composes via `add()`. State/behavior are mutated directly on instances (setters/methods), with mouse/key events bubbling upward through `processMouseEvent` for example.

```typescript
import { BoxRenderable, TextRenderable, InputRenderable, createCliRenderer, type RenderContext } from "@opentui/core"

const renderer = await createCliRenderer()

const loginForm = new BoxRenderable(renderer, {
  id: "login-form",
  width: 20,
  height: 10,
  padding: 1,
})

// Compose renderables to a single renderable.
// Needs a RendererContext at creation time.
function createLabeledInput(renderer: RenderContext, props: { label: string; placeholder: string; id: string }) {
  const labeledInput = new BoxRenderable(renderer, {
    id: `${props.id}-labeled-input`,
    flexDirection: "row",
    backgroundColor: "gray",
  })

  labeledInput.add(
    new TextRenderable(renderer, {
      id: `${props.id}-label`,
      content: props.label + " ",
    }),
  )
  labeledInput.add(
    new InputRenderable(renderer, {
      id: `${props.id}-input`,
      placeholder: props.placeholder,
      backgroundColor: "white",
      textColor: "black",
      cursorColor: "blue",
      focusedBackgroundColor: "orange",
      width: 20,
    }),
  )

  return labeledInput
}

const labeledUsername = createLabeledInput(renderer, {
  id: "username",
  label: "Username:",
  placeholder: "Enter your username...",
})
loginForm.add(labeledUsername)

// Now it becomse difficult to focus. because it is in a container.
// This does not work:
labeledUsername.focus()

// Needs to be:
labeledUsername.getRenderable("username-input")?.focus()

const labeledPassword = createLabeledInput(renderer, {
  id: "password",
  label: "Password:",
  placeholder: "Enter your password...",
})
loginForm.add(labeledPassword)

// Compose a button component
function createButton(props: { content: string; onClick: () => void; id: string }) {
  const box = new BoxRenderable(renderer, {
    id: `${props.id}-button`,
    border: true,
    backgroundColor: "gray",
    onMouseDown: props.onClick,
  })
  const text = new TextRenderable(renderer, {
    id: `${props.id}-button-text`,
    content: props.content,
    selectable: false,
  })
  box.add(text)
  return box
}

const buttons = new BoxRenderable(renderer, {
  id: "buttons",
  flexDirection: "row",
  padding: 1,
  width: 20,
})
buttons.add(createButton({ id: "register", content: "Register", onClick: () => {} }))
buttons.add(createButton({ id: "login", content: "Login", onClick: () => {} }))
loginForm.add(buttons)

renderer.root.add(loginForm)
```

## Declarative

Builds an allegedly lightweight VNode graph using functional constructs that return VNodes; no instances exist until `instantiate(ctx, vnode)` is called. During instantiation, children are flattened, renderables are created and added, and any chained method/property calls made on VNodes are replayed on the created instance. `delegate(mapping, vnode)` can annotate the VNode so selected APIs (e.g., `focus`, `add`) are later routed to a specific descendant when the instance is created.

```typescript
import { Text, Input, Box, createCliRenderer, delegate, instantiate } from "@opentui/core"

const renderer = await createCliRenderer()

function LabeledInput(props: { id: string; label: string; placeholder: string }) {
  return delegate(
    {
      focus: `${props.id}-input`,
    },
    Box(
      { flexDirection: "row" },
      Text({ content: props.label + " " }),
      Input({
        id: `${props.id}-input`,
        placeholder: props.placeholder,
        width: 20,
        backgroundColor: "white",
        textColor: "black",
        cursorColor: "blue",
        focusedBackgroundColor: "orange",
      }),
    ),
  )
}

function Button(props: { id: string; content: string; onClick: () => void }) {
  return Box(
    {
      border: true,
      backgroundColor: "gray",
      onMouseDown: props.onClick,
    },
    Text({ content: props.content, selectable: false }),
  )
}

const usernameInput = LabeledInput({ id: "username", label: "Username:", placeholder: "Enter your username..." })
usernameInput.focus()

const loginForm = Box(
  { width: 20, height: 10, padding: 1 },
  usernameInput,
  LabeledInput({ id: "password", label: "Password:", placeholder: "Enter your password..." }),
  Box(
    { flexDirection: "row", padding: 1, width: 20 },
    Button({ id: "login", content: "Login", onClick: () => {} }),
    Button({ id: "register", content: "Register", onClick: () => {} }),
  ),
)

renderer.root.add(loginForm)
```
