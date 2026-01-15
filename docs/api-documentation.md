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
        },
        {
          "id": 12,
          "name": "Triceps",
          "involvement_level": "SECONDARY"
        }
      ]
    }
  ],
  "total": 250
}
```

### Get Exercise by ID
**GET** `/exercises/:id`

**Response:**
```json
{
  "id": 1,
  "name": "Barbell Bench Press",
  "description": "...",
  "alternatives": [
    {
      "id": 15,
      "name": "Dumbbell Bench Press",
      "reason": "More shoulder-friendly"
    }
  ]
}
```

### Create Custom Exercise
**POST** `/exercises`
*Requires authentication*

**Request Body:**
```json
{
  "name": "Rip's Special Shoulder Raise",
  "description": "Custom variation with 3-second holds",
  "category": "Push",
  "equipment_type": "Dumbbell",
  "muscle_ids": [18, 19],
  "involvement_levels": ["PRIMARY", "SECONDARY"]
}
```

---

## Workout Routines

### List User's Routines
**GET** `/routines`
*Requires authentication*

**Response:**
```json
{
  "routines": [
    {
      "id": 1,
      "name": "Push Day A",
      "description": "Heavy compounds, 5x5",
      "is_active": true,
      "exercises": [
        {
          "exercise_id": 1,
          "exercise_name": "Barbell Bench Press",
          "order_index": 1,
          "target_sets": 5,
          "target_reps": 5,
          "target_weight": 185,
          "superset_group": null
        }
      ]
    }
  ]
}
```

### Create Routine
**POST** `/routines`
*Requires authentication*

**Request Body:**
```json
{
  "name": "Leg Day B",
  "description": "Volume day",
  "exercises": [
    {
      "exercise_id": 25,
      "order_index": 1,
      "target_sets": 4,
      "target_reps": 8,
      "target_weight": 225
    },
    {
      "exercise_id": 28,
      "order_index": 2,
      "target_sets": 3,
      "target_reps": 12,
      "superset_group": 1
    },
    {
      "exercise_id": 31,
      "order_index": 3,
      "target_sets": 3,
      "target_reps": 12,
      "superset_group": 1
    }
  ]
}
```

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

### Get Workout Details
**GET** `/workouts/:id`
*Requires authentication*

**Response:**
```json
{
  "id": 1,
  "workout_date": "2026-01-13",
  "overall_notes": "Great session, felt strong",
  "exercises": [
    {
      "exercise_id": 1,
      "exercise_name": "Barbell Bench Press",
      "exercise_notes": "Shoulder felt good today",
      "sets": [
        {
          "set_number": 1,
          "reps_completed": 5,
          "weight_used": 185,
          "rpe": 7,
          "rest_seconds": null
        },
        {
          "set_number": 2,
          "reps_completed": 5,
          "weight_used": 185,
          "rpe": 8,
          "rest_seconds": 180
        }
      ]
    }
  ]
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
  "overall_notes": "Quick session, limited time",
  "exercises": [
    {
      "exercise_id": 1,
      "order_index": 1,
      "exercise_notes": null,
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

**Response:**
```json
{
  "metrics": [
    {
      "id": 1,
      "metric_date": "2026-01-01",
      "scan_method": "InBody 770",
      "bodyweight": 185.2,
      "body_fat_percentage": 18.5,
      "notes": "Baseline scan"
    }
  ]
}
```

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
    "lean_body_mass": {"value": 152.0, "unit": "lbs"},
    "segmental_analysis": {
      "right_arm": {"lean_mass": 7.3, "fat_mass": 1.7, "unit": "lbs"}
    }
  },
  "notes": "Two-week progress check"
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

**Response:**
File download

### Export Routines
**GET** `/export/routines`
*Requires authentication*

**Query Parameters:**
- `format`: json or csv

**Response:**
File download

### Export Body Metrics
**GET** `/export/metrics`
*Requires authentication*

**Query Parameters:**
- `format`: csv, xlsx, or json

**Response:**
File download

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

**Last Updated**: January 14, 2026
