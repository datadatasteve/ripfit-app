// ============================================================================
// USDA Foundation Foods CSV Import
// ============================================================================
// Purpose: Download and import USDA Foundation Foods dataset
// Dataset: ~1,000-2,000 common unprocessed foods (fruits, vegetables, meats, grains, etc.)
// Source: https://fdc.nal.usda.gov/download-datasets.html

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const unzipper = require('unzipper');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Download URL for latest Foundation Foods dataset (December 2025)
const FOUNDATION_FOODS_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2025-12-18.zip';

// Temporary directory for downloads
const TEMP_DIR = path.join(__dirname, '../../temp');
const ZIP_PATH = path.join(TEMP_DIR, 'foundation_foods.zip');
const EXTRACT_DIR = path.join(TEMP_DIR, 'foundation_foods');

// ============================================================================
// DOWNLOAD AND EXTRACT
// ============================================================================

async function downloadDataset() {
  console.log('📥 Downloading USDA Foundation Foods dataset...');
  console.log(`   Source: ${FOUNDATION_FOODS_URL}`);

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  // Download the ZIP file
  const writer = fs.createWriteStream(ZIP_PATH);
  const response = await axios({
    url: FOUNDATION_FOODS_URL,
    method: 'GET',
    responseType: 'stream'
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      console.log('✓ Download complete');
      resolve();
    });
    writer.on('error', reject);
  });
}

async function extractDataset() {
  console.log('📦 Extracting dataset...');

  // Create extract directory
  if (!fs.existsSync(EXTRACT_DIR)) {
    fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  }

  // Extract ZIP file
  await fs.createReadStream(ZIP_PATH)
    .pipe(unzipper.Extract({ path: EXTRACT_DIR }))
    .promise();

  console.log('✓ Extraction complete');
  
  // Debug: Show what was actually extracted
  console.log('\n🔍 Extracted files:');
  const listFiles = (dir, indent = '') => {
    const items = fs.readdirSync(dir);
    items.forEach(item => {
      const fullPath = path.join(dir, item);
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        console.log(`${indent}📁 ${item}/`);
        listFiles(fullPath, indent + '  ');
      } else {
        console.log(`${indent}📄 ${item}`);
      }
    });
  };
  listFiles(EXTRACT_DIR);
  console.log('');
}

// ============================================================================
// PARSE CSV FILES
// ============================================================================

/**
 * Parse the food.csv file
 * Contains basic food information
 */
async function parseFoodsCSV() {
  // Find the subdirectory (name changes with each release)
  const items = fs.readdirSync(EXTRACT_DIR);
  const subdir = items.find(item => fs.statSync(path.join(EXTRACT_DIR, item)).isDirectory());
  
  if (!subdir) {
    throw new Error(`No subdirectory found in ${EXTRACT_DIR}`);
  }
  
  const foodsPath = path.join(EXTRACT_DIR, subdir, 'food.csv');
  
  if (!fs.existsSync(foodsPath)) {
    throw new Error(`food.csv not found at ${foodsPath}`);
  }

  const foods = [];
  const parser = fs.createReadStream(foodsPath)
    .pipe(parse({
      columns: true,
      skip_empty_lines: true
    }));

  for await (const record of parser) {
    // Only import Foundation Foods (data_type = 'foundation_food')
    if (record.data_type === 'foundation_food') {
      foods.push({
        fdc_id: parseInt(record.fdc_id),
        description: record.description,
        data_type: record.data_type,
        publication_date: record.publication_date
      });
    }
  }

  console.log(`✓ Parsed ${foods.length} foundation foods`);
  return foods;
}

/**
 * Parse the food_nutrient.csv file
 * Contains nutrition values for each food
 */
async function parseNutrientsCSV() {
  // Find the subdirectory (name changes with each release)
  const items = fs.readdirSync(EXTRACT_DIR);
  const subdir = items.find(item => fs.statSync(path.join(EXTRACT_DIR, item)).isDirectory());
  
  if (!subdir) {
    throw new Error(`No subdirectory found in ${EXTRACT_DIR}`);
  }
  
  const nutrientsPath = path.join(EXTRACT_DIR, subdir, 'food_nutrient.csv');
  
  if (!fs.existsSync(nutrientsPath)) {
    throw new Error(`food_nutrient.csv not found at ${nutrientsPath}`);
  }

  const nutrients = {};
  const parser = fs.createReadStream(nutrientsPath)
    .pipe(parse({
      columns: true,
      skip_empty_lines: true
    }));

  for await (const record of parser) {
    const fdcId = parseInt(record.fdc_id);
    const nutrientId = parseInt(record.nutrient_id);
    const amount = parseFloat(record.amount) || 0;

    if (!nutrients[fdcId]) {
      nutrients[fdcId] = {};
    }

    // Map USDA nutrient IDs to our field names
    const nutrientMap = {
      1008: 'calories',      // Energy (kcal)
      1003: 'protein_g',     // Protein
      1004: 'fat_g',         // Total lipid (fat)
      1005: 'carbs_g',       // Carbohydrate, by difference
      1079: 'fiber_g',       // Fiber, total dietary
      2000: 'sugar_g'        // Sugars, total including NLEA
    };

    const fieldName = nutrientMap[nutrientId];
    if (fieldName) {
      nutrients[fdcId][fieldName] = amount;
    }
  }

  console.log(`✓ Parsed nutrients for ${Object.keys(nutrients).length} foods`);
  return nutrients;
}

// ============================================================================
// IMPORT TO DATABASE
// ============================================================================

async function importToDatabase(foods, nutrients) {
  console.log('💾 Importing to database...');

  const client = await pool.connect();
  let imported = 0;
  let skipped = 0;

  try {
    await client.query('BEGIN');

    for (const food of foods) {
      const nutrition = nutrients[food.fdc_id] || {};

      // Skip if missing critical nutrition data
      if (!nutrition.calories && !nutrition.protein_g && !nutrition.carbs_g) {
        skipped++;
        continue;
      }

      // Skip if negative nutrition values (violates check constraints)
      if (nutrition.protein_g < 0 || nutrition.carbs_g < 0 || nutrition.fat_g < 0) {
        skipped++;
        continue;
      }

      try {
        await client.query(`
          INSERT INTO foods (
            name, serving_size, serving_unit, calories_per_100g, protein_per_100g, 
            carbs_per_100g, fat_per_100g, fiber_per_100g, sugar_per_100g, 
            source, usda_fdc_id, is_verified
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          food.description,
          100,  // Foundation Foods are standardized per 100g
          'g',  // grams
          nutrition.calories || 0,
          nutrition.protein_g || 0,
          nutrition.carbs_g || 0,
          nutrition.fat_g || 0,
          nutrition.fiber_g || 0,
          nutrition.sugar_g || 0,
          'usda_foundation',
          food.fdc_id,
          true  // USDA data is verified
        ]);

        imported++;

        // Log progress every 100 foods
        if (imported % 100 === 0) {
          console.log(`   Imported ${imported} foods...`);
        }
      } catch (err) {
        console.error(`   Error importing food ${food.fdc_id}:`, err.message);
      }
    }

    await client.query('COMMIT');
    console.log(`✓ Import complete: ${imported} imported, ${skipped} skipped`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Import failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// CLEANUP
// ============================================================================

function cleanup() {
  console.log('🧹 Cleaning up temporary files...');
  
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log('✓ Cleanup complete');
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('\n==================================================');
  console.log('USDA Foundation Foods Import');
  console.log('==================================================\n');

  try {
    // Step 1: Download
    await downloadDataset();

    // Step 2: Extract
    await extractDataset();

    // Step 3: Parse CSV files
    const foods = await parseFoodsCSV();
    const nutrients = await parseNutrientsCSV();

    // Step 4: Import to database
    await importToDatabase(foods, nutrients);

    // Step 5: Cleanup
    cleanup();

    console.log('\n✅ Foundation Foods import successful!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Import failed:', error.message);
    console.error(error.stack);
    console.log('\n⚠️  Temp files NOT cleaned up for debugging');
    console.log(`   Check: ${TEMP_DIR}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };
