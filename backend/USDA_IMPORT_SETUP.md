# USDA Food Data Import - Setup Instructions

## Overview
You now have TWO methods for populating your foods database:
1. **Foundation Foods CSV Import** (Option A) - Seed with ~1,000-2,000 common foods
2. **USDA API Integration** (Option B) - Real-time barcode scanning and lookups

---

## Files Created

### Backend Scripts
- `backend/services/usda-api.js` - API client for barcode scanning
- `backend/database/seeds/import-foundation-foods.js` - CSV import script

---

## Step 1: Install Dependencies

Add these packages to your backend:

```bash
cd ~/Desktop/dev_proj/ripfit-app/backend
npm install axios csv-parse unzipper
```

**What each does:**
- `axios` - HTTP client for API requests and file downloads
- `csv-parse` - Parse CSV files from USDA
- `unzipper` - Extract ZIP archives

---

## Step 2: Add Your API Key to .env

```bash
cd ~/Desktop/dev_proj/ripfit-app/backend
echo "USDA_API_KEY=your-actual-api-key-here" >> .env
```

**Replace `your-actual-api-key-here` with your actual USDA API key.**

---

## Step 3: Update package.json Scripts

Add this to `backend/package.json` under `"scripts"`:

```json
{
  "scripts": {
    "migrate": "node database/migrate.js",
    "seed:exercises": "node database/seeds/import-exercises-exercisedb.js",
    "seed:foods": "node database/seeds/import-foundation-foods.js"
  }
}
```

---

## Step 4: Run Foundation Foods Import (Option A)

This downloads ~1,000-2,000 common foods from USDA:

```bash
cd ~/Desktop/dev_proj/ripfit-app/backend
npm run seed:foods
```

**Expected output:**
```
==================================================
USDA Foundation Foods Import
==================================================

📥 Downloading USDA Foundation Foods dataset...
   Source: https://fdc.nal.usda.gov/fdc-datasets/...
✓ Download complete
📦 Extracting dataset...
✓ Extraction complete
✓ Parsed 1,234 foundation foods
✓ Parsed nutrients for 1,234 foods
💾 Importing to database...
   Imported 100 foods...
   Imported 200 foods...
   ...
✓ Import complete: 1,234 imported, 0 skipped
🧹 Cleaning up temporary files...
✓ Cleanup complete

✅ Foundation Foods import successful!
```

**This takes ~2-5 minutes depending on internet speed.**

---

## Step 5: Test the API Integration (Option B)

Create a test script to verify barcode scanning works:

```bash
cd ~/Desktop/dev_proj/ripfit-app/backend
node -e "
const usdaApi = require('./services/usda-api');

async function test() {
  // Test barcode lookup
  const yogurt = await usdaApi.searchByBarcode('0005450000219');
  if (yogurt) {
    console.log('✓ Barcode lookup works!');
    console.log(usdaApi.parseNutrients(yogurt));
  } else {
    console.log('✗ Barcode not found');
  }
}

test();
"
```

---

## How to Use Both Methods

### Method 1: Foundation Foods (Seeded Data)
```javascript
// Query existing foods in database
const result = await pool.query(
  'SELECT * FROM foods WHERE name ILIKE $1',
  ['%chicken%']
);
```

### Method 2: API Barcode Scanning (On-Demand)
```javascript
const usdaApi = require('../services/usda-api');

// User scans barcode
const barcode = '0005450000219';

// Check database first
let food = await pool.query(
  'SELECT * FROM foods WHERE gtin_upc = $1',
  [barcode]
);

// If not found, query USDA API
if (food.rows.length === 0) {
  const usdaFood = await usdaApi.searchByBarcode(barcode);
  
  if (usdaFood) {
    const nutrition = usdaApi.parseNutrients(usdaFood);
    
    // Save to database
    food = await pool.query(`
      INSERT INTO foods (
        name, serving_size, calories, protein_g, carbs_g, fat_g,
        fiber_g, sugar_g, gtin_upc, brand_owner, brand_name,
        ingredients, source, usda_fdc_id, is_verified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      nutrition.name,
      nutrition.serving_size,
      nutrition.calories,
      nutrition.protein_g,
      nutrition.carbs_g,
      nutrition.fat_g,
      nutrition.fiber_g,
      nutrition.sugar_g,
      nutrition.gtin_upc,
      nutrition.brand_owner,
      nutrition.brand_name,
      nutrition.ingredients,
      nutrition.source,
      nutrition.usda_fdc_id,
      true
    ]);
  }
}

// Return food to user
return food.rows[0];
```

---

## Troubleshooting

### "USDA_API_KEY not found"
- Make sure you added it to `.env`
- Restart any running Node processes

### "Download failed"
- Check internet connection
- USDA website may be down (try again later)

### "CSV file not found"
- The ZIP file structure may have changed
- Check the extracted folder at `backend/temp/foundation_foods/`

### "Import failed - duplicate key"
- Foods already exist in database
- This is normal if you run the import twice
- Script uses `ON CONFLICT DO NOTHING` to skip duplicates

---

## Next Steps

Once both imports are working:
1. Build the nutrition tracking API endpoints
2. Create meal logging functionality  
3. Implement barcode scanning in the frontend

---

## Questions?

Reference the official docs:
- USDA API Guide: https://fdc.nal.usda.gov/api-guide.html
- USDA Downloads: https://fdc.nal.usda.gov/download-datasets.html
