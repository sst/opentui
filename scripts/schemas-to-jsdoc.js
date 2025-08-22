#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const jsdoc = require('json-schema-to-jsdoc');

const schemasDir = path.join(__dirname, '../packages/core/docs/api/schemas');
const outputDir = path.join(__dirname, '../packages/core/docs/api/jsdoc');

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Get all JSON schema files
const schemaFiles = fs.readdirSync(schemasDir).filter(file => file.endsWith('.json'));

console.log(`Converting ${schemaFiles.length} JSON schemas to JSDoc...`);

schemaFiles.forEach(file => {
  const schemaPath = path.join(schemasDir, file);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  
  try {
    // Convert schema to JSDoc
    const jsdocComment = jsdoc(schema);
    
    // Create output filename
    const outputFile = file.replace('.json', '.js');
    const outputPath = path.join(outputDir, outputFile);
    
    // Write JSDoc to file
    fs.writeFileSync(outputPath, jsdocComment, 'utf8');
    console.log(`✓ Converted ${file} -> ${outputFile}`);
  } catch (error) {
    console.error(`✗ Error converting ${file}:`, error.message);
  }
});

console.log(`\nJSDoc files generated in ${outputDir}`);