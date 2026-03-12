import { ThreeRenderable, THREE } from "@opentui/core/3d"
import { type SolidPlugin } from "@opentui/solid"
import { extend } from "@opentui/solid"
import { ExternalSidebarPanel, ExternalStatusCard } from "./slot-components.tsx"

export type ExternalPluginSlots = {
  statusbar: { label: string }
  sidebar: { section: string }
}

export type ExternalPluginContext = {
  appName: string
  version: string
}

const CAPABILITIES = ["statusbar extension", "sidebar extension", "external jsx components", "core 3d entrypoint"]

extend({ three_renderable: ThreeRenderable })

const cubeScene = new THREE.Scene()

const ambientLight = new THREE.AmbientLight(new THREE.Color(0.35, 0.35, 0.35), 1.0)
cubeScene.add(ambientLight)

const keyLight = new THREE.DirectionalLight(new THREE.Color(1.0, 0.95, 0.9), 1.2)
keyLight.position.set(2.5, 2.0, 3.0)
cubeScene.add(keyLight)

const cubeGeometry = new THREE.BoxGeometry(1.0, 1.0, 1.0)
const cubeMaterial = new THREE.MeshPhongMaterial({
  color: new THREE.Color(0.25, 0.8, 1.0),
  shininess: 80,
  specular: new THREE.Color(0.9, 0.9, 1.0),
})
const cubeMesh = new THREE.Mesh(cubeGeometry, cubeMaterial)
cubeMesh.rotation.set(0.5, 0.75, 0.25)
cubeScene.add(cubeMesh)

const cubeCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
cubeCamera.position.set(0, 0, 3)

export function loadExternalPlugin(): SolidPlugin<ExternalPluginSlots, ExternalPluginContext> {
  return {
    id: "external-jsx-plugin",
    order: 20,
    slots: {
      statusbar(ctx, props) {
        return <ExternalStatusCard host={ctx.appName} label={props.label} version={ctx.version} />
      },
      sidebar(_ctx, props) {
        return (
          <box flexDirection="column">
            <ExternalSidebarPanel section={props.section} capabilities={CAPABILITIES} />
            <box marginTop={1} border borderStyle="single" borderColor="#334155" flexDirection="column">
              <text fg="#93c5fd">3D cube from @opentui/core/3d</text>
              <three_renderable width={36} height={8} scene={cubeScene} camera={cubeCamera} />
            </box>
          </box>
        )
      },
    },
  }
}
