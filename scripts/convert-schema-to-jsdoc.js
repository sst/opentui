#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// First, let's test with a single schema file
const schemaPath = path.join(__dirname, '../packages/core/docs/api/schemas/ASCIIFontOptions.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

// Since json-schema-to-jsdoc is a library, let's create a simple converter
function schemaToJSDoc(schema, depth = 0) {
  const indent = ' '.repeat(depth * 2);
  let jsdoc = [];
  
  if (depth === 0) {
    jsdoc.push('/**');
    if (schema.description) {
      jsdoc.push(` * ${schema.description}`);
    }
    if (schema.$ref) {
      const typeName = schema.$ref.split('/').pop();
      jsdoc.push(` * @typedef {Object} ${typeName}`);
    }
  }
  
  if (schema.definitions) {
    Object.entries(schema.definitions).forEach(([name, def]) => {
      jsdoc.push('/**');
      if (def.description) {
        jsdoc.push(` * ${def.description}`);
      }
      jsdoc.push(` * @typedef {Object} ${name}`);
      
      if (def.properties) {
        Object.entries(def.properties).forEach(([propName, prop]) => {
          let type = 'any';
          if (prop.type) {
            type = prop.type === 'integer' ? 'number' : prop.type;
          } else if (prop.$ref) {
            type = prop.$ref.split('/').pop();
          } else if (prop.anyOf) {
            type = prop.anyOf.map(t => {
              if (t.type) return t.type;
              if (t.$ref) return t.$ref.split('/').pop();
              if (t.const) return `"${t.const}"`;
              return 'any';
            }).join('|');
          } else if (prop.enum) {
            type = prop.enum.map(v => `"${v}"`).join('|');
          }
          
          const required = def.required && def.required.includes(propName);
          const optionalMark = required ? '' : '?';
          
          let description = '';
          if (prop.description) {
            description = ` - ${prop.description}`;
          } else if (prop.$comment) {
            description = ` - ${prop.$comment}`;
          }
          
          jsdoc.push(` * @property {${type}} ${optionalMark}${propName}${description}`);
        });
      }
      
      jsdoc.push(' */');
      jsdoc.push('');
    });
  }
  
  return jsdoc.join('\n');
}

const jsdocOutput = schemaToJSDoc(schema);

// Write to file
const outputPath = path.join(__dirname, '../packages/core/docs/api/jsdoc/ASCIIFontOptions.js');
const outputDir = path.dirname(outputPath);

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputPath, jsdocOutput, 'utf8');
console.log('Generated JSDoc for ASCIIFontOptions');
console.log('\nSample output:');
console.log(jsdocOutput.split('\n').slice(0, 50).join('\n'));