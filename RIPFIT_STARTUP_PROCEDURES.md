# RipFit Startup and Testing Procedures

## Prerequisites

Before starting, verify you have:
- Docker Desktop installed and running
- Node.js installed
- Terminal access

## Starting the Application

### Step 1: Start Docker Database

```bash
docker start ripfit-db
```

Wait 10 seconds for database to fully start.

Verify it's running:
```bash
docker ps
```

You should see ripfit-db in the list with STATUS "Up".

### Step 2: Navigate to Backend Directory

```bash
cd ~/Desktop/dev_proj/ripfit-app/backend
```

### Step 3: Start Backend Server

```bash
npm start
```

You should see:
```
RipFit API Server
Port: 3000
API Base: http://localhost:3000/api/v1
```

Leave this terminal window open. The server must stay running.

## Testing the Application

### Test 1: Health Check

Open browser and go to:
```
http://localhost:3000/health
```

Expected result: JSON response showing server is healthy

### Test 2: Food Search

Open browser and go to:
```
http://localhost:3000/api/v1/nutrition/foods/search?q=chicken
```

Expected result: JSON with 5 chicken products from database

### Test 3: Barcode Scanner

Open a NEW terminal window (keep server running in first window).

Run this command:
```bash
curl -X POST http://localhost:3000/api/v1/nutrition/foods/barcode/012000006340
```

Expected result: JSON with product details OR "Barcode not found" error

### Test 4: Check Database Directly

In the new terminal window:
```bash
docker exec -it ripfit-db psql -U ripfit_user -d ripfit_dev
```

Once inside PostgreSQL, run:
```sql
SELECT COUNT(*) FROM foods;
```

Expected result: Total count of foods in database

To exit PostgreSQL:
```sql
\q
```

## Common Testing Commands

### Check How Many Foods Have Barcodes
```bash
docker exec -it ripfit-db psql -U ripfit_user -d ripfit_dev -c "SELECT COUNT(*) FROM foods WHERE gtin_upc IS NOT NULL;"
```

### Search for Specific Barcode in Database
```bash
docker exec -it ripfit-db psql -U ripfit_user -d ripfit_dev -c "SELECT name, brand, gtin_upc FROM foods WHERE gtin_upc = 'YOUR_BARCODE_HERE';"
```

### List Sample Foods with Barcodes
```bash
docker exec -it ripfit-db psql -U ripfit_user -d ripfit_dev -c "SELECT gtin_upc, name, brand FROM foods WHERE gtin_upc IS NOT NULL LIMIT 10;"
```

### Check Total Foods by Source
```bash
docker exec -it ripfit-db psql -U ripfit_user -d ripfit_dev -c "SELECT source, COUNT(*) FROM foods GROUP BY source;"
```

## Stopping the Application

### Stop Backend Server
In the terminal where npm start is running:
- Press Ctrl+C

### Stop Docker Database
```bash
docker stop ripfit-db
```

## Troubleshooting

### Problem: "Cannot connect to database"
Solution:
1. Check Docker is running: `docker ps`
2. If ripfit-db not listed, start it: `docker start ripfit-db`
3. Wait 10 seconds
4. Restart backend: `npm start`

### Problem: "Port 3000 already in use"
Solution:
1. Find the process: `lsof -ti:3000`
2. Kill it: `kill -9 <PID>`
3. Restart: `npm start`

### Problem: Backend shows errors on startup
Solution:
1. Check .env file exists in backend directory
2. Verify database credentials match docker-compose settings
3. Check backend/src/config/database.js for connection settings

### Problem: API returns 404 errors
Solution:
1. Verify you're using correct URL pattern: `/api/v1/nutrition/foods/search`
2. Check backend console for route registration logs
3. Ensure server is fully started (see startup banner)

### Problem: Food search returns empty results
Solution:
1. Check database has data: See "Test 4" above
2. Verify search parameter is `q=` not `query=`
3. Try different search terms (chicken, beef, rice)

### Problem: Barcode always returns "not found"
Solution:
1. Check how many barcodes exist in database (see Common Testing Commands)
2. If count is low (only 1-2), branded foods import needs to be fixed
3. Test with a barcode you know exists in the database

## Running Database Imports

### Import Exercises (if needed)
```bash
cd ~/Desktop/dev_proj/ripfit-app/backend
node database/seeds/import-exercises-exercisedb.js.js
```

### Import Foundation Foods (if needed)
```bash
cd ~/Desktop/dev_proj/ripfit-app/backend
node database/seeds/import-foundation-foods.js
```

### Import Branded Foods (currently broken)
```bash
cd ~/Desktop/dev_proj/ripfit-app/backend
node database/seeds/import-branded-foods.js
```

Note: This import claims to succeed but only loads 1 barcode. This is the issue we need to fix.

## Accessing Database Console

To explore database manually:
```bash
docker exec -it ripfit-db psql -U ripfit_user -d ripfit_dev
```

Useful commands once inside:
- `\dt` - List all tables
- `\d foods` - Show foods table structure
- `\d+ foods` - Show detailed foods table info
- `SELECT * FROM foods LIMIT 5;` - Show sample foods
- `\q` - Exit

## Quick Reference

### URLs You'll Use
- Backend API: http://localhost:3000/api/v1
- Health check: http://localhost:3000/health
- Food search: http://localhost:3000/api/v1/nutrition/foods/search?q=TERM

### Important Directories
- Project root: ~/Desktop/dev_proj/ripfit-app/
- Backend code: ~/Desktop/dev_proj/ripfit-app/backend/
- Database seeds: ~/Desktop/dev_proj/ripfit-app/backend/database/seeds/
- API routes: ~/Desktop/dev_proj/ripfit-app/backend/src/routes/
- Controllers: ~/Desktop/dev_proj/ripfit-app/backend/src/controllers/

### Two Terminal Window Setup
- Window 1: Backend server running (npm start) - LEAVE OPEN
- Window 2: Run test commands (curl, docker, etc)
