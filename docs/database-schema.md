# Database Schema Documentation

## Overview

RipFit uses PostgreSQL with 16 core tables organized into 6 functional categories. The schema is designed for flexibility, scalability, and data integrity.

## Design Principles

1. **Flexibility**: JSONB fields for variable data (body composition, custom metrics)
2. **Privacy**: Photo metadata only (photos stored locally on user devices)
3. **Normalization**: Proper relationships to avoid data duplication
4. **Performance**: Indexed foreign keys and commonly queried fields
5. **Extensibility**: Easy to add new features without major migrations

---

## Category 1: User/Authentication

### users
User accounts and authentication data.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique user identifier |
| email | VARCHAR(255) | UNIQUE, NOT NULL | User's email (login) |
| password_hash | VARCHAR(255) | NOT NULL | Hashed password |
| username | VARCHAR(50) | UNIQUE, NOT NULL | Display name |
| oauth_provider | VARCHAR(50) | NULL | OAuth provider (google, apple, null) |
| oauth_id | VARCHAR(255) | NULL | OAuth user ID |
| created_at | TIMESTAMP | DEFAULT NOW() | Account creation time |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last account update |

**Indexes:**
- `idx_users_email` on `email`
- `idx_users_username` on `username`
- `idx_users_oauth` on `oauth_provider, oauth_id`

---

## Category 2: Exercise Library

### exercises
Master exercise library (system-provided + user-custom).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique exercise identifier |
| name | VARCHAR(255) | NOT NULL | Exercise name |
| description | TEXT | NULL | How to perform the exercise |
| category | VARCHAR(50) | NULL | Push/Pull/Legs/Core |
| equipment_type | VARCHAR(50) | NULL | Barbell/Dumbbell/Machine/etc |
| is_custom | BOOLEAN | DEFAULT FALSE | System or user-created |
| created_by_user_id | INTEGER | FK users(id) | Creator (NULL if system) |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation time |

**Indexes:**
- `idx_exercises_name` on `name`
- `idx_exercises_category` on `category`
- `idx_exercises_user` on `created_by_user_id`

### exercise_alternatives
Alternative/substitute exercises.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| exercise_id | INTEGER | FK exercises(id) | Main exercise |
| alternative_exercise_id | INTEGER | FK exercises(id) | Substitute exercise |
| reason | TEXT | NULL | Why it's an alternative |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation time |

### muscles
Muscle groups database.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| name | VARCHAR(100) | NOT NULL | Muscle name (Chest, Biceps, etc) |
| muscle_group | VARCHAR(50) | NULL | Upper/Lower/Core |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation time |

### exercise_muscles
Links exercises to muscles (many-to-many).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| exercise_id | INTEGER | FK exercises(id) | The exercise |
| muscle_id | INTEGER | FK muscles(id) | The muscle |
| involvement_level | VARCHAR(20) | NOT NULL | PRIMARY/SECONDARY/STABILIZER |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation time |

**Indexes:**
- `idx_exercise_muscles_exercise` on `exercise_id`
- `idx_exercise_muscles_muscle` on `muscle_id`

---

## Category 3: Workout Routines (Planning)

### workout_routines
Saved workout programs/templates.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| user_id | INTEGER | FK users(id) | Routine owner |
| name | VARCHAR(255) | NOT NULL | Routine name (Push Day A) |
| description | TEXT | NULL | Routine notes |
| is_active | BOOLEAN | DEFAULT TRUE | Currently using? |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation time |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last modified |

**Indexes:**
- `idx_routines_user` on `user_id`

### routine_exercises
Exercises within each routine.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| routine_id | INTEGER | FK workout_routines(id) | Parent routine |
| exercise_id | INTEGER | FK exercises(id) | The exercise |
| order_index | INTEGER | NOT NULL | Exercise order (1,2,3...) |
| target_sets | INTEGER | NULL | Planned sets |
| target_reps | INTEGER | NULL | Planned reps |
| target_weight | DECIMAL(6,2) | NULL | Planned weight |
| superset_group | INTEGER | NULL | Superset group (1,2,3, NULL) |
| notes | TEXT | NULL | Exercise-specific notes |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation time |

**Indexes:**
- `idx_routine_exercises_routine` on `routine_id`
- `idx_routine_exercises_order` on `routine_id, order_index`

### exercise_replacements
Temporary exercise substitutions (injury/equipment).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| routine_id | INTEGER | FK workout_routines(id) | Affected routine |
| original_exercise_id | INTEGER | FK exercises(id) | Exercise being replaced |
| replacement_exercise_id | INTEGER | FK exercises(id) | Substitute exercise |
| start_date | DATE | NOT NULL | Replacement starts |
| end_date | DATE | NULL | Replacement ends (NULL = permanent) |
| reason | TEXT | NULL | Why replaced |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation time |

### routine_additions_preferences
Remembers user preferences for ad-hoc added exercises.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| user_id | INTEGER | FK users(id) | The user |
| routine_id | INTEGER | FK workout_routines(id) | The routine |
| exercise_id | INTEGER | FK exercises(id) | Added exercise |
| action | VARCHAR(20) | NOT NULL | ALWAYS_ADD/ALWAYS_ASK/NEVER_ADD |
| created_at | TIMESTAMP | DEFAULT NOW() | Creation time |

---

## Category 4: Workout Logging (Execution)

### workouts
Individual gym sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| user_id | INTEGER | FK users(id) | Who worked out |
| routine_id | INTEGER | FK workout_routines(id) NULL | Routine used (NULL = freestyle) |
| workout_date | DATE | NOT NULL | Date of workout |
| start_time | TIMESTAMP | NULL | When started |
| end_time | TIMESTAMP | NULL | When finished |
| overall_notes | TEXT | NULL | Session-level notes |
| created_at | TIMESTAMP | DEFAULT NOW() | Record creation time |

**Indexes:**
- `idx_workouts_user_date` on `user_id, workout_date`

### workout_exercises
Exercises performed in a workout session.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| workout_id | INTEGER | FK workouts(id) | Parent workout |
| exercise_id | INTEGER | FK exercises(id) | Exercise performed |
| order_index | INTEGER | NOT NULL | Order done (1,2,3...) |
| exercise_notes | TEXT | NULL | Exercise-level notes |
| created_at | TIMESTAMP | DEFAULT NOW() | Record creation time |

**Indexes:**
- `idx_workout_exercises_workout` on `workout_id`

### workout_sets
Individual sets logged.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| workout_exercise_id | INTEGER | FK workout_exercises(id) | Parent exercise |
| set_number | INTEGER | NOT NULL | Set number (1,2,3...) |
| reps_completed | INTEGER | NOT NULL | Reps done |
| weight_used | DECIMAL(6,2) | NOT NULL | Weight lifted |
| rpe | INTEGER | NULL | Rate of Perceived Exertion (1-10) |
| rest_seconds | INTEGER | NULL | Rest before this set |
| tempo | VARCHAR(20) | NULL | Lifting tempo (3-1-1-0) |
| set_type | VARCHAR(20) | DEFAULT 'normal' | normal/warmup/drop/superset |
| superset_group | INTEGER | NULL | Superset group (1,2,3, NULL) |
| created_at | TIMESTAMP | DEFAULT NOW() | Record creation time |

**Indexes:**
- `idx_workout_sets_exercise` on `workout_exercise_id`

---

## Category 5: Progress Tracking

### user_metrics
Body composition and measurements.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| user_id | INTEGER | FK users(id) | Metric owner |
| metric_date | DATE | NOT NULL | Date measured |
| scan_method | VARCHAR(100) | NULL | InBody 770, DEXA, etc |
| body_composition | JSONB | NULL | All metrics (flexible structure) |
| notes | TEXT | NULL | Scan notes |
| created_at | TIMESTAMP | DEFAULT NOW() | Record creation time |

**JSONB Structure Example:**
```json
{
  "bodyweight": {"value": 185.2, "unit": "lbs"},
  "body_fat_percentage": {"value": 18.5, "unit": "%"},
  "lean_body_mass": {"value": 150.3, "unit": "lbs"},
  "segmental_analysis": {
    "right_arm": {"lean_mass": 7.2, "fat_mass": 1.8, "unit": "lbs"},
    "torso": {"lean_mass": 58.3, "fat_mass": 18.2, "unit": "lbs"}
  },
  "custom_metrics": {
    "waist_circumference": {"value": 34, "unit": "inches"}
  }
}
```

**Indexes:**
- `idx_metrics_user_date` on `user_id, metric_date`
- GIN index on `body_composition` for JSONB queries

### progress_photos
Progress photo metadata (photos stored locally).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| user_id | INTEGER | FK users(id) | Photo owner |
| photo_filename | VARCHAR(255) | NOT NULL | Filename only |
| photo_date | DATE | NOT NULL | Date taken |
| metric_id | INTEGER | FK user_metrics(id) NULL | Linked body scan |
| notes | TEXT | NULL | Photo notes |
| created_at | TIMESTAMP | DEFAULT NOW() | Record creation time |

**Indexes:**
- `idx_photos_user_date` on `user_id, photo_date`

### nutrition_plans
Dietary targets and macro breakdowns (Phase 3 feature).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| user_id | INTEGER | FK users(id) | Plan owner |
| plan_date | DATE | NOT NULL | Plan start date |
| metric_id | INTEGER | FK user_metrics(id) NULL | Based on scan |
| daily_calories | INTEGER | NULL | Total calories/day |
| daily_protein | DECIMAL(6,2) | NULL | Protein g/day |
| daily_carbs | DECIMAL(6,2) | NULL | Carbs g/day |
| daily_fat | DECIMAL(6,2) | NULL | Fat g/day |
| meals_per_day | INTEGER | NULL | Number of meals |
| calories_per_meal | INTEGER | NULL | Approx calories/meal |
| protein_per_meal | DECIMAL(6,2) | NULL | Approx protein/meal |
| carbs_per_meal | DECIMAL(6,2) | NULL | Approx carbs/meal |
| fat_per_meal | DECIMAL(6,2) | NULL | Approx fat/meal |
| notes | TEXT | NULL | Dietary guidance |
| is_active | BOOLEAN | DEFAULT TRUE | Currently following? |
| created_at | TIMESTAMP | DEFAULT NOW() | Record creation time |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last modified |

---

## Category 6: Import/Export

### user_export_preferences
Auto-export settings.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PRIMARY KEY | Unique identifier |
| user_id | INTEGER | FK users(id) | Preference owner |
| auto_export_enabled | BOOLEAN | DEFAULT FALSE | Auto-export on? |
| export_frequency | VARCHAR(20) | NULL | weekly/monthly |
| export_format | VARCHAR(20) | NULL | csv/json/both |
| export_destination | VARCHAR(50) | NULL | email/google_drive/dropbox |
| last_export_date | TIMESTAMP | NULL | Last export time |
| created_at | TIMESTAMP | DEFAULT NOW() | Record creation time |
| updated_at | TIMESTAMP | DEFAULT NOW() | Last modified |

---

## Relationships Summary

```
users (1) ──┬─→ (∞) exercises [custom]
            ├─→ (∞) workout_routines
            ├─→ (∞) workouts
            ├─→ (∞) user_metrics
            ├─→ (∞) progress_photos
            ├─→ (∞) nutrition_plans
            └─→ (1) user_export_preferences

exercises (1) ──┬─→ (∞) exercise_alternatives [main]
                ├─→ (∞) exercise_alternatives [alternative]
                ├─→ (∞) exercise_muscles
                ├─→ (∞) routine_exercises
                └─→ (∞) workout_exercises

workout_routines (1) ──┬─→ (∞) routine_exercises
                        ├─→ (∞) exercise_replacements
                        ├─→ (∞) routine_additions_preferences
                        └─→ (∞) workouts

workouts (1) ──→ (∞) workout_exercises ──→ (∞) workout_sets

user_metrics (1) ──┬─→ (∞) progress_photos
                   └─→ (∞) nutrition_plans
```

---

## Migration Strategy

1. **001_initial_schema.sql** - Create all tables
2. **002_add_indexes.sql** - Add performance indexes
3. **003_seed_exercises.sql** - Load system exercise library
4. **004_seed_muscles.sql** - Load muscle groups

Future migrations as features are added.

---

**Last Updated**: January 14, 2026
