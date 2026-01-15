# Import/Export Guide

Complete guide for importing and exporting data in RipFit.

## Overview

RipFit gives you full ownership of your data. You can:
- **Export** all data in CSV/JSON formats
- **Import** data from other apps or spreadsheets
- **Auto-export** to cloud storage (Google Drive, Dropbox)

---

## Exporting Data

### Export Formats

**CSV/XLSX** - Best for:
- Spreadsheet analysis (Excel, Google Sheets)
- Creating charts and graphs
- Sharing with trainers/coaches
- Quick data inspection

**JSON** - Best for:
- Complete data backup
- Re-importing to RipFit
- Programmatic access
- API integrations

### How to Export

#### Via Web Interface
1. Navigate to Settings → Export Data
2. Select data type:
   - Workout History
   - Workout Routines
   - Body Composition
   - All Data (complete backup)
3. Choose format: CSV or JSON
4. Click "Export"
5. File downloads automatically

#### Via API
```bash
# Export workouts as CSV
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/v1/export/workouts?format=csv" \
  --output workouts.csv

# Export body metrics as JSON
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/v1/export/metrics?format=json" \
  --output metrics.json
```

---

## CSV Export Formats

### Workout History CSV

**Filename**: `workout_history_YYYY-MM-DD.csv`

**Columns:**
```csv
workout_date,start_time,end_time,routine_name,exercise_name,set_number,reps,weight,weight_unit,rpe,set_type,exercise_notes,overall_notes
2026-01-13,18:30,19:45,Push Day A,Barbell Bench Press,1,5,185,lbs,7,normal,,Great session
2026-01-13,18:30,19:45,Push Day A,Barbell Bench Press,2,5,185,lbs,8,normal,,
```

### Body Metrics CSV

**Filename**: `body_metrics_YYYY-MM-DD.csv`

**Columns:**
```csv
date,scan_method,bodyweight,bodyweight_unit,body_fat_percentage,lean_mass,lean_mass_unit,notes
2026-01-01,InBody 770,185.2,lbs,18.5,150.3,lbs,Baseline scan
2026-02-01,InBody 770,182.8,lbs,16.2,152.1,lbs,One month progress
```

### Workout Routines CSV

**Filename**: `routines_YYYY-MM-DD.csv`

**Columns:**
```csv
routine_name,exercise_name,order,target_sets,target_reps,target_weight,superset_group,notes
Push Day A,Barbell Bench Press,1,5,5,185,,Pause reps
Push Day A,Overhead Press,2,4,8,95,,
```

---

## JSON Export Formats

### Complete Backup Structure

**Filename**: `ripfit_backup_YYYY-MM-DD.json`

```json
{
  "export_info": {
    "version": "1.0",
    "exported_at": "2026-01-14T20:00:00Z",
    "user_id": 1
  },
  "user_profile": {
    "username": "ripuser",
    "email": "user@example.com"
  },
  "routines": [...],
  "workouts": [...],
  "body_metrics": [...],
  "custom_exercises": [...]
}
```

---

## Importing Data

### Supported Import Sources

1. **CSV Files**
   - Workout logs from spreadsheets
   - Body scan data exports
   - Exercise libraries

2. **JSON Files**
   - RipFit backup files
   - API responses from other apps

3. **PDF Files** (Phase 2)
   - InBody scan reports
   - DEXA scan reports

4. **Manual Entry**
   - Web forms for any data type
   - Mobile-friendly input

### Import CSV Templates

Download these templates to fill in your data:

#### Workout History Template

**File**: `workout_import_template.csv`

```csv
workout_date,exercise_name,set_number,reps,weight,weight_unit,rpe,notes
2026-01-10,Barbell Squat,1,5,225,lbs,8,Felt strong
2026-01-10,Barbell Squat,2,5,225,lbs,9,
```

**Required columns:**
- `workout_date` (YYYY-MM-DD format)
- `exercise_name` (must match exercise in library)
- `set_number` (1, 2, 3, ...)
- `reps` (number)
- `weight` (number)

**Optional columns:**
- `weight_unit` (lbs/kg, defaults to lbs)
- `rpe` (1-10)
- `notes`
- `routine_name`

#### Body Metrics Template

**File**: `body_metrics_template.csv`

```csv
date,scan_method,bodyweight,bodyweight_unit,body_fat_percentage,lean_mass,lean_mass_unit
2026-01-01,InBody 770,185.2,lbs,18.5,150.3,lbs
```

**Required columns:**
- `date` (YYYY-MM-DD)

**Optional columns:**
- All body composition fields
- Units for each measurement

### How to Import

#### Via Web Interface
1. Navigate to Settings → Import Data
2. Select data type to import
3. Choose file or use manual entry
4. Review data preview
5. Map columns (if CSV)
6. Confirm import

#### Column Mapping

For CSV files from other apps, you'll map their columns to RipFit's schema:

**Example:**
```
Their CSV          →    RipFit Field
-----------------------------------------
Date               →    workout_date
Exercise           →    exercise_name
Weight (lbs)       →    weight
Reps               →    reps
Set                →    set_number
```

---

## Auto-Export Configuration

### Setup Auto-Export

1. Go to Settings → Auto-Export
2. Toggle "Enable Auto-Export"
3. Configure:
   - **Frequency**: Weekly or Monthly
   - **Format**: CSV, JSON, or Both
   - **Destination**: Email, Google Drive, or Dropbox

### Google Drive Setup

1. Click "Connect Google Drive"
2. Authorize RipFit access
3. Choose folder: `/RipFit/Backups/`
4. Exports will automatically upload

### Dropbox Setup

1. Click "Connect Dropbox"
2. Authorize RipFit access
3. Exports saved to `/Apps/RipFit/`

### Email Delivery

Exports can be emailed as zip files:
- Sent to your registered email
- Check spam folder if not received within 15 minutes
- Files available for 48 hours via download link

---

## Data Portability

### Exporting to Other Apps

**To Excel/Google Sheets:**
1. Export as CSV
2. Open in your spreadsheet app
3. Data ready for analysis

**To Notion:**
1. Export as CSV
2. Create Notion database
3. Import CSV → Notion automatically maps columns

**To Other Fitness Apps:**
Most apps accept CSV format for workout history.

### Backing Up Your Data

**Best Practice:**
1. Export complete JSON backup monthly
2. Export CSV files weekly for analysis
3. Enable auto-export to cloud storage
4. Keep local copies before major changes

---

## Advanced: Programmatic Import

### Using the API

```javascript
// Import workouts from CSV
const formData = new FormData();
formData.append('file', csvFile);
formData.append('type', 'workouts');

fetch('http://localhost:3000/api/v1/import/csv', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
})
.then(response => response.json())
.then(data => {
  console.log(`Imported ${data.imported_count} workouts`);
});
```

### Batch Import Script

```bash
#!/bin/bash
# Import multiple CSV files

TOKEN="your_token_here"
API_URL="http://localhost:3000/api/v1"

for file in exports/*.csv; do
  echo "Importing $file..."
  curl -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@$file" \
    -F "type=workouts" \
    "$API_URL/import/csv"
done
```

---

## Troubleshooting

### Common Import Issues

**"Invalid date format"**
- Use YYYY-MM-DD format
- Example: 2026-01-14, not 01/14/2026

**"Exercise not found"**
- Exercise name must exactly match library
- Check spelling and capitalization
- Add custom exercise first if needed

**"Invalid column mapping"**
- Ensure all required columns are mapped
- Check column headers match template

**"File too large"**
- Max file size: 10MB
- Split large files into smaller batches
- Use JSON for more efficient compression

### Getting Help

1. Check our [FAQ](https://ripfit.app/faq)
2. Review [sample files](https://github.com/yourusername/ripfit-app/tree/main/docs/samples)
3. Contact support with your export file

---

## Privacy & Security

**Your data is yours:**
- We never sell your data
- Exports include all your data, always
- Delete account = delete all data
- Photos stored locally only (never uploaded)

**Export security:**
- Exports are temporary (48hr expiration)
- Download links are unique and one-time use
- Use HTTPS for all downloads

---

**Last Updated**: January 14, 2026
