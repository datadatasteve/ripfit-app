// ============================================================================
// USDA Branded Foods Import - Popular Products Only
// ============================================================================
// Purpose: Import ~5,000-10,000 popular branded foods with barcodes
// Filters: Top brands, recent data (last 3 years), complete nutrition info

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

// Download URL for latest Branded Foods dataset (December 2025)
const BRANDED_FOODS_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_branded_food_csv_2025-12-18.zip';

// Temporary directory
const TEMP_DIR = path.join(__dirname, '../../temp');
const ZIP_PATH = path.join(TEMP_DIR, 'branded_foods.zip');
const EXTRACT_DIR = path.join(TEMP_DIR, 'branded_foods');

// Top 50 food brands (covers most common packaged foods)
const TOP_BRANDS = [
  'General Mills', 'Kellogg Company', 'Nestle', 'Kraft Foods', 'Conagra Brands',
  'Pepsi Co', 'Coca Cola', 'Unilever', 'Danone', 'Chobani',
  'Frito Lay', 'Post Holdings', 'Campbell Soup', 'Hormel Foods', 'Tyson Foods',
  'Smithfield Foods', 'Mars', 'Hershey', 'Mondelez', 'Ferrero',
  'Quaker Oats', 'Kashi', 'Nature Valley', 'Clif Bar', 'KIND',
  'RXBAR', 'Quest Nutrition', 'Premier Protein', 'Muscle Milk', 'Optimum Nutrition',
  'Gatorade', 'Powerade', 'Red Bull', 'Monster Energy', 'Rockstar',
  'Starbucks', 'Dunkin', 'Greek Gods', 'Fage', 'Yoplait',
  'Dole', 'Del Monte', 'Green Giant', 'Birds Eye', 'Ore Ida',
  'Stouffer', "Amy's Kitchen", 'Lean Cuisine', 'Healthy Choice', 'Smart Ones'
];

// ============================================================================
// DOWNLOAD AND EXTRACT
// ============================================================================

async function downloadDataset() {
  console.log('📥 Downloading USDA Branded Foods dataset...');
  console.log(`   Source: ${BRANDED_FOODS_URL}`);
  console.log('   ⚠️  This is a large file (~427MB), may take 2-5 minutes...\n');

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const writer = fs.createWriteStream(ZIP_PATH);
  const response = await axios({
    url: BRANDED_FOODS_URL,
    method: 'GET',
    responseType: 'stream',
    onDownloadProgress: (progressEvent) => {
      const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
      process.stdout.write(`\r   Progress: ${percentCompleted}%`);
    }
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      console.log('\n✓ Download complete');
      resolve();
    });
    writer.on('error', reject);
  });
}

async function extractDataset() {
  console.log('📦 Extracting dataset...');

  if (!fs.existsSync(EXTRACT_DIR)) {
    fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  }

  await fs.createReadStream(ZIP_PATH)
    .pipe(unzipper.Extract({ path: EXTRACT_DIR }))
    .promise();

  console.log('✓ Extraction complete\n');
}

// ============================================================================
// PARSE CSV FILES
// ============================================================================

async function parseBrandedFoodsCSV() {
  // Find the subdirectory
  const items = fs.readdirSync(EXTRACT_DIR);
  const subdir = items.find(item => fs.statSync(path.join(EXTRACT_DIR, item)).isDirectory());
  
  if (!subdir) {
    throw new Error(`No subdirectory found in ${EXTRACT_DIR}`);
  }
  
  const brandedFoodsPath = path.join(EXTRACT_DIR, subdir, 'branded_food.csv');
  const foodsPath = path.join(EXTRACT_DIR, subdir, 'food.csv');
  
  if (!fs.existsSync(brandedFoodsPath) || !fs.existsSync(foodsPath)) {
    throw new Error('Required CSV files not found');
  }

  console.log('📄 Parsing branded_food.csv...');
  
  // Parse branded_food.csv for brand info and barcodes
  const brandedFoods = new Map();
  const brandedParser = fs.createReadStream(brandedFoodsPath)
    .pipe(parse({ columns: true, skip_empty_lines: true }));

  for await (const record of brandedParser) {
    // Filter: Only include top brands
    const brandOwner = record.brand_owner || '';
    const isTopBrand = TOP_BRANDS.some(brand => 
      brandOwner.toLowerCase().includes(brand.toLowerCase())
    );

    if (isTopBrand && record.gtin_upc) {
      brandedFoods.set(record.fdc_id, {
        gtin_upc: record.gtin_upc,
        brand_owner: record.brand_owner,
        brand_name: record.brand_name,
        ingredients: record.ingredients,
        serving_size: record.serving_size,
        serving_size_unit: record.serving_size_unit
      });
    }
  }

  console.log(`✓ Found ${brandedFoods.size} foods from top brands`);

  // Parse food.csv for basic food info
  console.log('📄 Parsing food.csv...');
  
  const foods = [];
  const foodParser = fs.createReadStream(foodsPath)
    .pipe(parse({ columns: true, skip_empty_lines: true }));

  for await (const record of foodParser) {
    if (record.data_type === 'branded_food' && brandedFoods.has(record.fdc_id)) {
      const brandedInfo = brandedFoods.get(record.fdc_id);
      foods.push({
        fdc_id: parseInt(record.fdc_id),
        description: record.description,
        ...brandedInfo
      });
    }
  }

  console.log(`✓ Matched ${foods.length} branded foods\n`);
  return foods;
}

async function parseNutrientsCSV() {
  const items = fs.readdirSync(EXTRACT_DIR);
  const subdir = items.find(item => fs.statSync(path.join(EXTRACT_DIR, item)).isDirectory());
  const nutrientsPath = path.join(EXTRACT_DIR, subdir, 'food_nutrient.csv');

  console.log('📄 Parsing food_nutrient.csv (this may take a few minutes)...');

  const nutrients = {};
  const parser = fs.createReadStream(nutrientsPath)
    .pipe(parse({ columns: true, skip_empty_lines: true }));

  let count = 0;
  for await (const record of parser) {
    const fdcId = parseInt(record.fdc_id);
    const nutrientId = parseInt(record.nutrient_id);
    const amount = parseFloat(record.amount) || 0;

    if (!nutrients[fdcId]) {
      nutrients[fdcId] = {};
    }

    // Map USDA nutrient IDs
    const nutrientMap = {
      1008: 'calories',
      1003: 'protein_g',
      1004: 'fat_g',
      1005: 'carbs_g',
      1079: 'fiber_g',
      2000: 'sugar_g'
    };

    const fieldName = nutrientMap[nutrientId];
    if (fieldName) {
      nutrients[fdcId][fieldName] = amount;
    }

    count++;
    if (count % 100000 === 0) {
      process.stdout.write(`\r   Processed ${count.toLocaleString()} nutrient records...`);
    }
  }

  console.log(`\n✓ Parsed nutrients for ${Object.keys(nutrients).length} foods\n`);
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

      // Skip if negative values
      if (nutrition.protein_g < 0 || nutrition.carbs_g < 0 || nutrition.fat_g < 0) {
        skipped++;
        continue;
      }

      try {
        // Parse serving size (e.g., "32g" -> 32)
        let servingSize = 100;
        let servingUnit = 'g';
        
        if (food.serving_size) {
          const sizeMatch = food.serving_size.match(/(\d+(?:\.\d+)?)/);
          if (sizeMatch) {
            servingSize = parseFloat(sizeMatch[1]);
          }
          if (food.serving_size_unit) {
            servingUnit = food.serving_size_unit.toLowerCase();
          }
        }

        await client.query(`
          INSERT INTO foods (
            name, brand, serving_size, serving_unit, calories_per_100g, 
            protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, 
            sugar_per_100g, gtin_upc, source, usda_fdc_id, is_verified
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
          food.description.substring(0, 255),
          (food.brand_owner || '').substring(0, 255),
          servingSize,
          servingUnit,
          nutrition.calories || 0,
          nutrition.protein_g || 0,
          nutrition.carbs_g || 0,
          nutrition.fat_g || 0,
          nutrition.fiber_g || 0,
          nutrition.sugar_g || 0,
          food.gtin_upc,
          'usda_branded',
          food.fdc_id,
          true
        ]);

        imported++;

        if (imported % 100 === 0) {
          console.log(`   Imported ${imported} foods...`);
        }
      } catch (err) {
        // Duplicate barcode - skip silently
        if (err.code !== '23505') {
          console.error(`Error food ${food.fdc_id}:`, err.message, err.code);
        }
        skipped++;
      }
    }

    await client.query('COMMIT');
    console.log(`✓ Import complete: ${imported} imported, ${skipped} skipped\n`);
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
    console.log('✓ Cleanup complete\n');
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('\n==================================================');
  console.log('USDA Branded Foods Import - Top Brands');
  console.log('==================================================\n');

  try {
    await downloadDataset();
    await extractDataset();
    
    const foods = await parseBrandedFoodsCSV();
    const nutrients = await parseNutrientsCSV();
    
    await importToDatabase(foods, nutrients);
    cleanup();

    console.log('✅ Branded foods import successful!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Import failed:', error.message);
    console.error(error.stack);
    cleanup();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
