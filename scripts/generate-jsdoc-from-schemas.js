#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const generate = require('/home/linuxbrew/.linuxbrew/lib/node_modules/json-schema-to-jsdoc');

const schemasDir = path.join(__dirname, '../packages/core/docs/api/schemas');
const outputDir = path.join(__dirname, '../packages/core/docs/api/jsdoc');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// JSDoc generation options
const options = {
  autoDescribe: true,  // Adds auto-generated descriptions
  hyphenatedDescriptions: true,  // Adds hyphen before property descriptions
  capitalizeTitle: true,  // Capitalizes titles
  indent: 2,  // Indentation level
  maxLength: 100,  // Max line length for descriptions
  types: {
    object: 'Object',
    array: 'Array',
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    integer: 'number'
  },
  formats: {
    'date-time': 'Date',
    'uri': 'string',
    'email': 'string'
  }
};

// Process all schema files
const schemaFiles = fs.readdirSync(schemasDir).filter(file => file.endsWith('.json'));

console.log(`Converting ${schemaFiles.length} JSON schemas to JSDoc with json-schema-to-jsdoc...`);
console.log();

let allJSDocs = [];

schemaFiles.forEach(file => {
  try {
    const schemaPath = path.join(schemasDir, file);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    
    // Generate JSDoc for each schema
    const jsdocContent = generate(schema, options);
    
    // Add source file comment
    const enhancedJSDoc = `/**
 * Generated from JSON Schema: ${file}
 * Date: ${new Date().toISOString()}
 */

${jsdocContent}`;
    
    // Write individual file
    const outputFile = file.replace('.json', '.js');
    const outputPath = path.join(outputDir, outputFile);
    
    fs.writeFileSync(outputPath, enhancedJSDoc, 'utf8');
    console.log(`✓ ${file} -> ${outputFile}`);
    
    // Also collect for combined file
    allJSDocs.push(`// === ${file} ===\n${enhancedJSDoc}`);
  } catch (error) {
    console.error(`✗ Error converting ${file}:`, error.message);
  }
});

// Create a combined file with all typedefs
const combinedPath = path.join(outputDir, 'all-types.js');
const combinedContent = `/**
 * OpenTUI Complete Type Definitions
 * Generated from JSON Schemas
 * Date: ${new Date().toISOString()}
 */

${allJSDocs.join('\n\n')}`;

fs.writeFileSync(combinedPath, combinedContent, 'utf8');

console.log();
console.log(`JSDoc files generated in ${outputDir}`);
console.log(`Combined typedef file: all-types.js`);