export const inheritedWaylandOnly =
  process.platform === "linux" &&
  Boolean(process.env.WAYLAND_SOCKET) &&
  !process.env.WAYLAND_DISPLAY &&
  !process.env.DISPLAY

let hostServiceCreated = false

export function canCreateInheritedWaylandHostService(): boolean {
  return !inheritedWaylandOnly || !hostServiceCreated
}

export function markInheritedWaylandHostServiceCreated(): void {
  if (inheritedWaylandOnly) hostServiceCreated = true
}
