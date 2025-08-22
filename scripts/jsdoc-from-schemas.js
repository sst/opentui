#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const jsdoc = require('/home/linuxbrew/.linuxbrew/lib/node_modules/json-schema-to-jsdoc');

const schemasDir = path.join(__dirname, '../packages/core/docs/api/schemas');
const outputDir = path.join(__dirname, '../packages/core/docs/api/jsdoc');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Process all schema files
const schemaFiles = fs.readdirSync(schemasDir).filter(file => file.endsWith('.json'));

console.log(`Converting ${schemaFiles.length} JSON schemas to JSDoc...`);
console.log();

let allJSDocs = [];

schemaFiles.forEach(file => {
  try {
    const schemaPath = path.join(schemasDir, file);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    
    let jsdocContent = '';
    
    // If schema has $ref, extract the main definition
    if (schema.$ref && schema.definitions) {
      const typeName = schema.$ref.split('/').pop();
      const mainSchema = schema.definitions[typeName];
      
      if (mainSchema) {
        // Add title if not present
        if (!mainSchema.title) {
          mainSchema.title = typeName;
        }
        
        // Generate JSDoc for main type
        try {
          const mainJSDoc = jsdoc(mainSchema, {
            autoDescribe: true,
            hyphenatedDescriptions: true,
            capitalizeTitle: true,
            indent: 2
          });
          jsdocContent += mainJSDoc + '\n\n';
        } catch (e) {
          console.log(`  Note: Could not generate JSDoc for ${typeName}: ${e.message}`);
        }
      }
      
      // Generate JSDoc for other definitions
      Object.entries(schema.definitions).forEach(([name, def]) => {
        if (name !== typeName) {
          if (!def.title) {
            def.title = name;
          }
          try {
            const defJSDoc = jsdoc(def, {
              autoDescribe: true,
              hyphenatedDescriptions: true,
              capitalizeTitle: true,
              indent: 2
            });
            jsdocContent += defJSDoc + '\n\n';
          } catch (e) {
            // Skip definitions that can't be converted
          }
        }
      });
    } else {
      // Direct schema without $ref
      jsdocContent = jsdoc(schema, {
        autoDescribe: true,
        hyphenatedDescriptions: true,
        capitalizeTitle: true,
        indent: 2
      });
    }
    
    if (jsdocContent.trim()) {
      // Add header
      const fullContent = `/**
 * Generated from: ${file}
 * Date: ${new Date().toISOString()}
 */

${jsdocContent}`;
      
      // Write individual file
      const outputFile = file.replace('.json', '.js');
      const outputPath = path.join(outputDir, outputFile);
      
      fs.writeFileSync(outputPath, fullContent, 'utf8');
      console.log(`✓ ${file} -> ${outputFile}`);
      
      // Collect for combined file
      allJSDocs.push(fullContent);
    } else {
      console.log(`⚠ ${file} - no JSDoc generated`);
    }
  } catch (error) {
    console.error(`✗ Error processing ${file}:`, error.message);
  }
});

// Create combined file
if (allJSDocs.length > 0) {
  const combinedPath = path.join(outputDir, 'all-types.js');
  const combinedContent = `/**
 * OpenTUI Complete Type Definitions
 * Generated from JSON Schemas
 * Date: ${new Date().toISOString()}
 */

${allJSDocs.join('\n\n')}`;

  fs.writeFileSync(combinedPath, combinedContent, 'utf8');
  console.log();
  console.log(`Combined typedef file created: all-types.js`);
}

console.log();
console.log(`JSDoc files generated in ${outputDir}`);