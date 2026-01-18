# API Documentation

## Base URL
```
http://localhost:3000/api/v1
```

## Authentication

All authenticated endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

### Register User
**POST** `/auth/register`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "username": "ripuser"
}
```

**Response:**
```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "ripuser"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Login
**POST** `/auth/login`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response:**
```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "ripuser"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### OAuth Login (Google)
**GET** `/auth/google`
Redirects to Google OAuth consent screen

**Callback:** `/auth/google/callback`

### OAuth Login (Apple)
**GET** `/auth/apple`
Redirects to Apple OAuth consent screen

**Callback:** `/auth/apple/callback`

---

## Exercises

### List Exercises
**GET** `/exercises`

**Query Parameters:**
- `category` (optional): Filter by category (Push, Pull, Legs, Core)
- `equipment` (optional): Filter by equipment type
- `custom` (optional): Include only custom exercises (true/false)

**Response:**
```json
{
  "exercises": [
    {
      "id": 1,
      "name": "Barbell Bench Press",
      "description": "Lie flat on bench, lower bar to chest, press up",
      "category": "Push",
      "equipment_type": "Barbell",
      "is_custom": false,
      "muscles": [
        {
          "id": 5,
          "name": "Chest",
          "involvement_level": "PRIMARY"
        }
      ]
    }
  ],
  "total": 250
}
```

### Get Exercise by ID
**GET** `/exercises/:id`

### Create Custom Exercise
**POST** `/exercises`
*Requires authentication*

**Request Body:**
```json
{
  "name": "Custom Shoulder Raise",
  "description": "3-second holds at top",
  "category": "Push",
  "equipment_type": "Dumbbell"
}
```

---

## Foods

### Search Foods
**GET** `/foods`

**Query Parameters:**
- `search` (optional): Search food name
- `source` (optional): Filter by source (USDA, custom, branded)
- `limit` (optional): Results per page (default: 20)

**Response:**
```json
{
  "foods": [
    {
      "id": 1,
      "name": "Chicken Breast, Raw",
      "brand": null,
      "calories_per_100g": 120,
      "protein_per_100g": 22.5,
      "carbs_per_100g": 0,
      "fat_per_100g": 2.6,
      "serving_size": 100,
      "serving_unit": "g",
      "source": "USDA"
    }
  ],
  "total": 10250
}
```

### Get Food by ID
**GET** `/foods/:id`

**Response:**
```json
{
  "id": 1,
  "name": "Chicken Breast, Raw",
  "brand": null,
  "description": "Skinless, boneless chicken breast",
  "calories_per_100g": 120,
  "protein_per_100g": 22.5,
  "carbs_per_100g": 0,
  "fat_per_100g": 2.6,
  "fiber_per_100g": 0,
  "sugar_per_100g": 0,
  "sodium_per_100g": 63,
  "serving_size": 100,
  "serving_unit": "g",
  "source": "USDA"
}
```

### Create Custom Food
**POST** `/foods`
*Requires authentication*

**Request Body:**
```json
{
  "name": "My Protein Shake",
  "calories_per_100g": 80,
  "protein_per_100g": 15,
  "carbs_per_100g": 5,
  "fat_per_100g": 1,
  "serving_size": 250,
  "serving_unit": "ml"
}
```

---

## Nutrition Tracking

### List User's Meals
**GET** `/meals`
*Requires authentication*

**Query Parameters:**
- `start_date` (optional): Filter from date (YYYY-MM-DD)
- `end_date` (optional): Filter to date (YYYY-MM-DD)
- `meal_type` (optional): Filter by type (breakfast/lunch/dinner/snack)

**Response:**
```json
{
  "meals": [
    {
      "id": 1,
      "meal_date": "2026-01-15",
      "meal_type": "breakfast",
      "meal_name": "Post-workout",
      "total_calories": 450,
      "total_protein": 35,
      "total_carbs": 40,
      "total_fat": 12,
      "foods_count": 3
    }
  ],
  "total": 15
}
```

### Get Meal Details
**GET** `/meals/:id`
*Requires authentication*

**Response:**
```json
{
  "id": 1,
  "meal_date": "2026-01-15",
  "meal_type": "breakfast",
  "meal_name": "Post-workout",
  "notes": "Felt good after this",
  "foods": [
    {
      "id": 1,
      "food_name": "Chicken Breast, Cooked",
      "serving_size": 150,
      "serving_unit": "g",
      "calories": 180,
      "protein": 33.8,
      "carbs": 0,
      "fat": 3.9
    },
    {
      "id": 2,
      "food_name": "Brown Rice, Cooked",
      "serving_size": 200,
      "serving_unit": "g",
      "calories": 220,
      "protein": 4.5,
      "carbs": 46,
      "fat": 1.6
    }
  ],
  "totals": {
    "calories": 450,
    "protein": 38.3,
    "carbs": 46,
    "fat": 5.5
  }
}
```

### Log Meal
**POST** `/meals`
*Requires authentication*

**Request Body:**
```json
{
  "meal_date": "2026-01-15",
  "meal_type": "lunch",
  "meal_name": "Pre-workout meal",
  "foods": [
    {
      "food_id": 15,
      "serving_size": 150,
      "serving_unit": "g"
    },
    {
      "food_id": 42,
      "serving_size": 1,
      "serving_unit": "cup"
    }
  ]
}
```

**Response:**
```json
{
  "id": 5,
  "meal_date": "2026-01-15",
  "meal_type": "lunch",
  "totals": {
    "calories": 520,
    "protein": 45,
    "carbs": 52,
    "fat": 8
  }
}
```

### Update Meal
**PUT** `/meals/:id`
*Requires authentication*

### Delete Meal
**DELETE** `/meals/:id`
*Requires authentication*

---

## Daily Nutrition Summary

### Get Daily Summary
**GET** `/nutrition/daily/:date`
*Requires authentication*

**Response:**
```json
{
  "user_id": 1,
  "summary_date": "2026-01-15",
  "totals": {
    "calories": 2450,
    "protein": 185,
    "carbs": 220,
    "fat": 68,
    "fiber": 35
  },
  "by_meal": {
    "breakfast": {
      "calories": 450,
      "protein": 35
    },
    "lunch": {
      "calories": 650,
      "protein": 48
    },
    "dinner": {
      "calories": 800,
      "protein": 62
    },
    "snacks": {
      "calories": 550,
      "protein": 40
    }
  },
  "vs_plan": {
    "calories_target": 2500,
    "calories_remaining": 50,
    "protein_target": 180,
    "protein_over": 5
  }
}
```

### Get Weekly Summary
**GET** `/nutrition/weekly`
*Requires authentication*

**Query Parameters:**
- `start_date` (required): Start of week (YYYY-MM-DD)

**Response:**
```json
{
  "week_start": "2026-01-13",
  "week_end": "2026-01-19",
  "daily_summaries": [
    {
      "date": "2026-01-13",
      "total_calories": 2300,
      "total_protein": 175
    }
  ],
  "weekly_averages": {
    "avg_calories": 2380,
    "avg_protein": 182,
    "avg_carbs": 215,
    "avg_fat": 70
  }
}
```

---

## Workout Routines

### List User's Routines
**GET** `/routines`
*Requires authentication*

### Create Routine
**POST** `/routines`
*Requires authentication*

---

## Workouts

### List User's Workouts
**GET** `/workouts`
*Requires authentication*

**Query Parameters:**
- `start_date` (optional): Filter from date (YYYY-MM-DD)
- `end_date` (optional): Filter to date (YYYY-MM-DD)
- `routine_id` (optional): Filter by routine

**Response:**
```json
{
  "workouts": [
    {
      "id": 1,
      "workout_date": "2026-01-13",
      "start_time": "2026-01-13T18:30:00Z",
      "end_time": "2026-01-13T19:45:00Z",
      "duration_minutes": 75,
      "routine_name": "Push Day A",
      "exercises_count": 5,
      "total_sets": 18,
      "total_volume": 8450
    }
  ],
  "total": 42
}
```

### Log Workout
**POST** `/workouts`
*Requires authentication*

**Request Body:**
```json
{
  "routine_id": 1,
  "workout_date": "2026-01-14",
  "start_time": "2026-01-14T17:00:00Z",
  "end_time": "2026-01-14T18:15:00Z",
  "overall_notes": "Quick session",
  "exercises": [
    {
      "exercise_id": 1,
      "order_index": 1,
      "sets": [
        {
          "set_number": 1,
          "reps_completed": 5,
          "weight_used": 185,
          "rpe": 7
        }
      ]
    }
  ]
}
```

---

## Body Composition

### List User's Metrics
**GET** `/metrics`
*Requires authentication*

### Record Body Composition
**POST** `/metrics`
*Requires authentication*

**Request Body:**
```json
{
  "metric_date": "2026-01-15",
  "scan_method": "InBody 770",
  "body_composition": {
    "bodyweight": {"value": 183.5, "unit": "lbs"},
    "body_fat_percentage": {"value": 17.2, "unit": "%"},
    "lean_body_mass": {"value": 152.0, "unit": "lbs"}
  }
}
```

---

## Data Export

### Export Workouts
**GET** `/export/workouts`
*Requires authentication*

**Query Parameters:**
- `format`: csv, xlsx, or json
- `start_date` (optional)
- `end_date` (optional)

### Export Nutrition
**GET** `/export/nutrition`
*Requires authentication*

**Query Parameters:**
- `format`: csv, xlsx, or json
- `start_date` (optional)
- `end_date` (optional)

### Export All Data
**GET** `/export/all`
*Requires authentication*

**Query Parameters:**
- `format`: json (complete backup)

---

## Error Responses

All errors follow this format:
```json
{
  "error": "Error message",
  "details": "Additional context (development only)"
}
```

**Common Status Codes:**
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

---

## Rate Limiting

- **Limit**: 100 requests per 15 minutes per IP
- **Headers**:
  - `X-RateLimit-Limit`: Request limit
  - `X-RateLimit-Remaining`: Requests remaining
  - `X-RateLimit-Reset`: Time when limit resets

---

**Last Updated**: January 15, 2026
