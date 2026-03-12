type ExternalStatusCardProps = {
  host: string
  label: string
  version: string
}

export function ExternalStatusCard(props: ExternalStatusCardProps) {
  return (
    <box border borderStyle="single" borderColor="#16a34a" marginLeft={1} paddingLeft={1} paddingRight={1} height={3}>
      <text fg="#bbf7d0">{`${props.host} -> ${props.label} (${props.version})`}</text>
    </box>
  )
}

type ExternalSidebarPanelProps = {
  section: string
  capabilities: string[]
}

export function ExternalSidebarPanel(props: ExternalSidebarPanelProps) {
  return (
    <box border borderStyle="single" borderColor="#06b6d4" flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg="#67e8f9">{`External plugin section: ${props.section}`}</text>
      {props.capabilities.map((capability) => (
        <text key={capability} fg="#bae6fd">{`- ${capability}`}</text>
      ))}
    </box>
  )
}
