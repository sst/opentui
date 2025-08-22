#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const schemasDir = path.join(__dirname, '../packages/core/docs/api/schemas');
const outputDir = path.join(__dirname, '../packages/core/docs/api/jsdoc');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Helper to convert JSON schema types to JSDoc types
function getJSDocType(prop) {
  if (prop.type) {
    if (Array.isArray(prop.type)) {
      return prop.type.map(t => t === 'integer' ? 'number' : t).join('|');
    }
    return prop.type === 'integer' ? 'number' : prop.type;
  }
  
  if (prop.$ref) {
    return prop.$ref.split('/').pop();
  }
  
  if (prop.anyOf) {
    return prop.anyOf.map(t => {
      if (t.type) return t.type === 'integer' ? 'number' : t.type;
      if (t.$ref) return t.$ref.split('/').pop();
      if (t.const) return JSON.stringify(t.const);
      if (t.enum) return t.enum.map(v => JSON.stringify(v)).join('|');
      return 'any';
    }).join('|');
  }
  
  if (prop.enum) {
    return prop.enum.map(v => JSON.stringify(v)).join('|');
  }
  
  if (prop.items) {
    const itemType = getJSDocType(prop.items);
    return `Array<${itemType}>`;
  }
  
  return 'any';
}

// Convert schema to JSDoc
function schemaToJSDoc(schema, fileName) {
  const typeName = fileName.replace('.json', '');
  let jsdoc = [];
  
  // Add file header
  jsdoc.push('/**');
  jsdoc.push(` * JSDoc type definitions generated from JSON Schema`);
  jsdoc.push(` * Source: ${fileName}`);
  jsdoc.push(` * Generated: ${new Date().toISOString()}`);
  jsdoc.push(' */');
  jsdoc.push('');
  
  // Process main type if referenced
  if (schema.$ref) {
    const mainType = schema.$ref.split('/').pop();
    const mainDef = schema.definitions[mainType];
    
    if (mainDef) {
      jsdoc.push('/**');
      jsdoc.push(` * ${mainDef.description || mainType}`);
      jsdoc.push(` * @typedef {Object} ${mainType}`);
      
      if (mainDef.properties) {
        Object.entries(mainDef.properties).forEach(([propName, prop]) => {
          const type = getJSDocType(prop);
          const required = mainDef.required && mainDef.required.includes(propName);
          const optionalMark = required ? '' : '[';
          const optionalEnd = required ? '' : ']';
          
          let description = prop.description || '';
          if (!description && prop.$comment) {
            description = prop.$comment;
          }
          
          jsdoc.push(` * @property {${type}} ${optionalMark}${propName}${optionalEnd} ${description ? '- ' + description : ''}`);
        });
      }
      
      jsdoc.push(' */');
      jsdoc.push('');
    }
  }
  
  // Process other definitions
  if (schema.definitions) {
    Object.entries(schema.definitions).forEach(([name, def]) => {
      // Skip if already processed as main type
      if (schema.$ref && schema.$ref.endsWith(name)) {
        return;
      }
      
      jsdoc.push('/**');
      jsdoc.push(` * ${def.description || name}`);
      jsdoc.push(` * @typedef {Object} ${name}`);
      
      if (def.properties) {
        Object.entries(def.properties).forEach(([propName, prop]) => {
          const type = getJSDocType(prop);
          const required = def.required && def.required.includes(propName);
          const optionalMark = required ? '' : '[';
          const optionalEnd = required ? '' : ']';
          
          let description = prop.description || '';
          if (!description && prop.$comment) {
            description = prop.$comment;
          }
          
          jsdoc.push(` * @property {${type}} ${optionalMark}${propName}${optionalEnd} ${description ? '- ' + description : ''}`);
        });
      }
      
      // Handle enums as separate typedef
      if (def.enum) {
        const enumType = def.enum.map(v => JSON.stringify(v)).join('|');
        jsdoc.push(` * @typedef {${enumType}} ${name}`);
      }
      
      jsdoc.push(' */');
      jsdoc.push('');
    });
  }
  
  return jsdoc.join('\n');
}

// Process all schema files
const schemaFiles = fs.readdirSync(schemasDir).filter(file => file.endsWith('.json'));

console.log(`Converting ${schemaFiles.length} JSON schemas to JSDoc...`);
console.log();

schemaFiles.forEach(file => {
  try {
    const schemaPath = path.join(schemasDir, file);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    
    const jsdocContent = schemaToJSDoc(schema, file);
    
    const outputFile = file.replace('.json', '.js');
    const outputPath = path.join(outputDir, outputFile);
    
    fs.writeFileSync(outputPath, jsdocContent, 'utf8');
    console.log(`✓ ${file} -> ${outputFile}`);
  } catch (error) {
    console.error(`✗ Error converting ${file}:`, error.message);
  }
});

console.log();
console.log(`JSDoc files generated in ${outputDir}`);