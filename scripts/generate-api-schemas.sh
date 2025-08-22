#!/bin/bash

# Generate JSON schemas for OpenTUI API documentation

SCHEMA_DIR="packages/core/docs/api/schemas"
mkdir -p "$SCHEMA_DIR"

echo "Generating JSON schemas for OpenTUI API..."

# Renderables
echo "Generating schemas for renderables..."
npx ts-json-schema-generator --path "packages/core/src/renderables/ASCIIFont.ts" --type "ASCIIFontOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/ASCIIFontOptions.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/renderables/Box.ts" --type "BoxOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/BoxOptions.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/renderables/Text.ts" --type "TextOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/TextOptions.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/renderables/Input.ts" --type "InputRenderableOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/InputRenderableOptions.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/renderables/Select.ts" --type "SelectRenderableOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/SelectRenderableOptions.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/renderables/TabSelect.ts" --type "TabSelectRenderableOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/TabSelectRenderableOptions.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/renderables/FrameBuffer.ts" --type "FrameBufferOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/FrameBufferOptions.json" 2>/dev/null

# Core types
echo "Generating schemas for core types..."
npx ts-json-schema-generator --path "packages/core/src/Renderable.ts" --type "RenderableOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/RenderableOptions.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/Renderable.ts" --type "LayoutOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/LayoutOptions.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/renderer.ts" --type "CliRendererConfig" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/CliRendererConfig.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/console.ts" --type "ConsoleOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/ConsoleOptions.json" 2>/dev/null

# 3D/Animation types
echo "Generating schemas for 3D/Animation types..."
npx ts-json-schema-generator --path "packages/core/src/3d/animation/ExplodingSpriteEffect.ts" --type "ExplosionEffectParameters" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/ExplosionEffectParameters.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/3d/WGPURenderer.ts" --type "ThreeCliRendererOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/ThreeCliRendererOptions.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/animation/Timeline.ts" --type "TimelineOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/TimelineOptions.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/animation/Timeline.ts" --type "AnimationOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/AnimationOptions.json" 2>/dev/null

# Library types  
echo "Generating schemas for library types..."
npx ts-json-schema-generator --path "packages/core/src/lib/border.ts" --type "BorderConfig" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/BorderConfig.json" 2>/dev/null
npx ts-json-schema-generator --path "packages/core/src/lib/border.ts" --type "BoxDrawOptions" --tsconfig "packages/core/tsconfig.json" -o "$SCHEMA_DIR/BoxDrawOptions.json" 2>/dev/null

echo "Schema generation complete! Check $SCHEMA_DIR for JSON schema files."