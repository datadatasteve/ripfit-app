# RipFit — Database Schema Reference

## How to use this doc

- Updated any time a migration is run or a shell schema change is made
- When a new feature changes the schema, the implementing chat will list the exact lines to add here
- **Regenerated in full on 2026-11-22 (Phase 0A-1)** from a local database built from repo migrations 001 through 031. Every column's Notes start with the migration that created it. Types are the real Postgres types (`timestamp` means `timestamp without time zone`).
- **Updated 2026-11-24 (Phase 0B-1)** for migrations 032 and 033, checked against `backend/scripts/one-off/dump-schema.js` run on a local database built from migrations 001 through 033: every table and column in the database is listed here.
- **Updated 2026-11-26 (Phase 1A-2)** for migrations 034, 035 and 036, generated from `backend/scripts/one-off/dump-schema.js` run on a local database built from migrations 001 through 036 (every table and column the dump lists is here; `schema_migrations` is left out as before). Soft delete (036): `workouts`, `workout_sets` and `workout_cardio_segments` have `deleted_at`; every read path skips rows where it is set.

## Connection

- Host: Northflank addon `ripfit-db`
- Env vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`
- SSL: `rejectUnauthorized: false`

## Key facts (Phase 0A-1)

- `workouts.start_time` / `end_time` and `workout_sets.created_at` are `timestamp` **without** time zone holding UTC. Convert with `(col AT TIME ZONE 'UTC') AT TIME ZONE users.timezone` for local hours. The server and database session must stay on UTC.
- Workout duration has one definition (`backend/src/utils/workoutStatus.js`, `durationSql`): `duration_seconds` if set, else `end_time - start_time - total_paused_seconds`. `cardio_sessions` use their own `duration_seconds`.
- Stats, "last time", overload and program progress count `status = 'completed'` only.
- `schema_migrations` (id, migration_name, executed_at) is created by `migrate.js`, not by a migration file, so it is not listed below.

---

## Tables

### bug_reports

Created in migration 013.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 013|
|user_id|integer FK → users (set null)|migration 013|
|title|text not null|migration 013|
|description|text not null|migration 013|
|current_view|text|migration 013|
|user_agent|text|migration 013|
|app_version|text|migration 013|
|status|text not null|migration 013; default 'open'|
|admin_notes|text|migration 013|
|created_at|timestamptz not null|migration 013; default now()|
|updated_at|timestamptz not null|migration 013; default now()|

### calendar_feed_tokens

Created in migration 035. Private calendar (.ics) feed token per user (Phase 1A-1). Regenerating replaces the token.

|Column|Type|Notes|
|---|---|---|
|user_id|integer FK → users (cascade) PK|migration 035|
|token|text not null|migration 035|
|created_at|timestamptz|migration 035; default now()|
|rotated_at|timestamptz|migration 035|

Constraints: `calendar_feed_tokens_token_key` UNIQUE (token)

### cardio_checkpoints

Created in migration 014.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 014|
|cardio_session_id|integer FK → cardio_sessions (cascade) not null|migration 014|
|checkpoint_name|text not null|migration 014|
|checkpoint_order|integer not null|migration 014|
|recorded_at|timestamptz|migration 014; default now()|
|distance|numeric(10,2)|migration 014|
|avg_speed|numeric(6,2)|migration 014|
|max_speed|numeric(6,2)|migration 014|
|odometer|numeric(10,2)|migration 014|
|avg_heart_rate|integer|migration 014|
|max_heart_rate|integer|migration 014|
|est_calories|integer|migration 014|
|elevation_gain|numeric(8,2)|migration 014|
|elevation_loss|numeric(8,2)|migration 014|
|created_at|timestamptz|migration 014; default now()|
|updated_at|timestamptz|migration 014; default now()|

### cardio_samples

Created in migration 036. Time series for later device or file imports (Phase 1A-2); storage only. owner_type cardio_session | segment.

|Column|Type|Notes|
|---|---|---|
|id|bigserial PK|migration 036|
|user_id|integer FK → users (cascade) not null|migration 036|
|owner_type|text not null|migration 036|
|owner_id|integer not null|migration 036|
|offset_seconds|numeric(10,2) not null|migration 036|
|heart_rate|integer|migration 036|
|elevation|numeric(8,2)|migration 036|
|latitude|numeric(9,6)|migration 036|
|longitude|numeric(9,6)|migration 036|
|cadence|integer|migration 036|
|speed|numeric(8,3)|migration 036|
|distance|numeric(10,3)|migration 036|
|power|integer|migration 036|
|created_at|timestamptz|migration 036; default now()|

Constraints: `cardio_samples_offset_nonneg` CHECK ((offset_seconds >= (0)::numeric)); `cardio_samples_owner_type_allowed` CHECK ((owner_type = ANY (ARRAY['cardio_session'::text, 'segment'::text])))

### cardio_sessions

Created in migration 009. Dedicated Quick Cardio flow (separate from workouts with workout_type cardio). Has no program_id.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 009|
|user_id|integer FK → users (cascade) not null|migration 009|
|session_date|date not null|migration 009|
|cardio_type|varchar(50) not null|migration 009|
|start_time|timestamptz|migration 009|
|end_time|timestamptz|migration 009|
|goal_duration_seconds|integer|migration 009|
|goal_distance|numeric(8,2)|migration 009|
|goal_distance_unit|varchar(10)|migration 009; default 'mi'|
|goal_speed|numeric(6,2)|migration 009|
|duration_seconds|integer|migration 009|
|distance|numeric(8,2)|migration 009|
|distance_unit|varchar(10)|migration 009; default 'mi'|
|avg_heart_rate|integer|migration 009|
|max_heart_rate|integer|migration 009|
|calories_burned|integer|migration 009|
|avg_speed|numeric(6,2)|migration 009|
|max_speed|numeric(6,2)|migration 009|
|elevation_gain|numeric(8,2)|migration 009|
|hr_zone_1_seconds|integer|migration 009|
|hr_zone_2_seconds|integer|migration 009|
|hr_zone_3_seconds|integer|migration 009|
|hr_zone_4_seconds|integer|migration 009|
|hr_zone_5_seconds|integer|migration 009|
|pre_session_notes|text|migration 009|
|mid_session_notes|text|migration 009|
|post_session_notes|text|migration 009|
|status|varchar(20)|migration 009; default 'completed'; 'in_progress' \| 'completed' \| 'cancelled'|
|created_at|timestamptz|migration 009; default now()|
|updated_at|timestamptz|migration 009; default now()|
|session_rating|smallint|migration 012|
|session_notes|text|migration 012|
|elevation_loss|numeric|migration 014|
|min_heart_rate|integer|migration 036|
|elevation_max|numeric(8,2)|migration 036|
|route_data|jsonb|migration 036|
|avg_cadence|integer|migration 036|
|max_cadence|integer|migration 036|
|source_device|text|migration 036|
|external_id|text|migration 036|
|saved_route_id|integer FK → saved_routes (set null)|migration 036|

Constraints: `cardio_sessions_session_rating_check` CHECK (((session_rating >= 1) AND (session_rating <= 10))); `cardio_sessions_status_check` CHECK (((status)::text = ANY ((ARRAY['in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))

### checkin_entries

Created in migration 036. Daily check-in answers, one per item per day (Phase 1A-2).

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 036|
|user_id|integer FK → users (cascade) not null|migration 036|
|item_id|integer FK → checkin_items (cascade) not null|migration 036|
|entry_date|date not null|migration 036|
|value|smallint not null|migration 036|
|created_at|timestamptz|migration 036; default now()|
|updated_at|timestamptz|migration 036; default now()|

### checkin_items

Created in migration 036. Daily check-in items (Phase 1A-2): presets (sleep, soreness, energy, mood; created per user on first read) and user-defined items. Optional link to a habit.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 036|
|user_id|integer FK → users (cascade) not null|migration 036|
|preset_key|text|migration 036|
|label|text not null|migration 036|
|scale_min|smallint not null|migration 036; default 1|
|scale_max|smallint not null|migration 036; default 5|
|habit_id|integer FK → habits (set null)|migration 036|
|is_active|boolean not null|migration 036; default true|
|order_index|integer not null|migration 036; default 1|
|created_at|timestamptz|migration 036; default now()|

Constraints: `checkin_items_label_not_blank` CHECK ((length(btrim(label)) > 0)); `checkin_items_scale_ordered` CHECK ((scale_min < scale_max))

### circuit_movements

Created in migration 035. Movements of a circuit, with optional targets (Phase 1A-1).

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 035|
|circuit_id|integer FK → circuits (cascade) not null|migration 035|
|exercise_id|integer FK → exercises (set null)|migration 035|
|name|text|migration 035|
|order_index|integer not null|migration 035; default 1|
|target_reps|integer|migration 035|
|target_weight|numeric(7,2)|migration 035|
|target_seconds|integer|migration 035|
|target_distance|numeric(10,3)|migration 035|
|target_distance_unit|text|migration 035|
|target_rpe|smallint|migration 035|
|notes|text|migration 035|
|micro_overload|jsonb|migration 035|
|created_at|timestamptz|migration 035; default now()|
|updated_at|timestamptz|migration 035; default now()|

Constraints: `circuit_movements_rpe_range` CHECK (((target_rpe IS NULL) OR ((target_rpe >= 1) AND (target_rpe <= 11)))); `circuit_movements_targets_nonneg` CHECK ((((target_reps IS NULL) OR (target_reps >= 0)) AND ((target_weight IS NULL) OR (target_weight >= (0)::numeric)) AND ((target_seconds IS NULL) OR (target_seconds >= 0)) AND ((target_distance IS NULL) OR (target_distance >= (0)::numeric))))

### circuit_round_logs

Created in migration 035. Logged circuit rounds (Phase 1A-1): movement_id NULL = a whole round ticked (completion mode); otherwise one movement in a round (full mode). Not workout_sets, so stats are unaffected.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 035|
|circuit_id|integer FK → circuits (cascade) not null|migration 035|
|movement_id|integer FK → circuit_movements (cascade)|migration 035|
|round_number|integer not null|migration 035|
|completed|boolean not null|migration 035; default true|
|reps|integer|migration 035|
|weight|numeric(7,2)|migration 035|
|duration_seconds|integer|migration 035|
|distance|numeric(10,3)|migration 035|
|rpe|smallint|migration 035|
|logged_at|timestamptz|migration 035; default now()|

Constraints: `circuit_round_logs_round_positive` CHECK ((round_number > 0)); `circuit_round_logs_rpe_range` CHECK (((rpe IS NULL) OR ((rpe >= 1) AND (rpe <= 11)))); `circuit_round_logs_values_nonneg` CHECK ((((reps IS NULL) OR (reps >= 0)) AND ((weight IS NULL) OR (weight >= (0)::numeric)) AND ((duration_seconds IS NULL) OR (duration_seconds >= 0)) AND ((distance IS NULL) OR (distance >= (0)::numeric))))

### circuits

Created in migration 035. Circuit blocks (Phase 1A-1): in a routine (template) or a workout (instance), never both. Only name and logging_mode are required.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 035|
|user_id|integer FK → users (cascade) not null|migration 035|
|routine_id|integer FK → workout_routines (cascade)|migration 035|
|workout_id|integer FK → workouts (cascade)|migration 035|
|source_circuit_id|integer FK → circuits (set null)|migration 035|
|name|text not null|migration 035|
|logging_mode|text not null|migration 035|
|rounds|integer|migration 035|
|work_seconds|integer|migration 035|
|rest_seconds|integer|migration 035|
|order_index|integer|migration 035|
|notes|text|migration 035|
|completed_at|timestamptz|migration 035|
|created_at|timestamptz|migration 035; default now()|
|updated_at|timestamptz|migration 035; default now()|

Constraints: `circuits_logging_mode_allowed` CHECK ((logging_mode = ANY (ARRAY['completion'::text, 'full'::text]))); `circuits_one_owner` CHECK ((num_nonnulls(routine_id, workout_id) = 1)); `circuits_rest_nonneg` CHECK (((rest_seconds IS NULL) OR (rest_seconds >= 0))); `circuits_rounds_positive` CHECK (((rounds IS NULL) OR (rounds > 0))); `circuits_work_nonneg` CHECK (((work_seconds IS NULL) OR (work_seconds >= 0)))

### daily_nutrition_summary

Created in migration 002.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 002|
|user_id|integer FK → users (cascade) not null|migration 002|
|summary_date|date not null|migration 002|
|total_calories|numeric(8,2)|migration 002; default 0|
|total_protein|numeric(6,2)|migration 002; default 0|
|total_carbs|numeric(6,2)|migration 002; default 0|
|total_fat|numeric(6,2)|migration 002; default 0|
|total_fiber|numeric(6,2)|migration 002; default 0|
|breakfast_calories|numeric(8,2)|migration 002; default 0|
|lunch_calories|numeric(8,2)|migration 002; default 0|
|dinner_calories|numeric(8,2)|migration 002; default 0|
|snack_calories|numeric(8,2)|migration 002; default 0|
|nutrition_plan_id|integer FK → nutrition_plans (set null)|migration 002|
|calories_vs_target|numeric(8,2)|migration 002|
|protein_vs_target|numeric(6,2)|migration 002|
|created_at|timestamp|migration 002; default CURRENT_TIMESTAMP|
|updated_at|timestamp|migration 002; default CURRENT_TIMESTAMP|

Constraints: `unique_user_date` UNIQUE (user_id, summary_date)

### error_logs

Created in migration 013.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 013|
|user_id|integer FK → users (set null)|migration 013|
|error_message|text not null|migration 013|
|error_stack|text|migration 013|
|component|text|migration 013|
|current_view|text|migration 013|
|user_agent|text|migration 013|
|url|text|migration 013|
|severity|text not null|migration 013; default 'error'|
|resolved|boolean not null|migration 013; default false|
|created_at|timestamptz not null|migration 013; default now()|

### exercise_aliases

Created in migration 035. Exercise aliases (Phase 1A-1). user_id NULL = global (admin-curated); otherwise private to that user. Exercise search matches them.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 035|
|exercise_id|integer FK → exercises (cascade) not null|migration 035|
|user_id|integer FK → users (cascade)|migration 035|
|alias|text not null|migration 035|
|created_by_user_id|integer FK → users (set null)|migration 035|
|created_at|timestamptz|migration 035; default now()|

Constraints: `exercise_aliases_alias_not_blank` CHECK ((length(btrim(alias)) > 0))

### exercise_alternatives

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|exercise_id|integer FK → exercises (cascade) not null|migration 001|
|alternative_exercise_id|integer FK → exercises (cascade) not null|migration 001|
|reason|text|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|

Constraints: `different_exercises` CHECK ((exercise_id <> alternative_exercise_id))

### exercise_muscles

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|exercise_id|integer FK → exercises (cascade) not null|migration 001|
|muscle_id|integer FK → muscles (cascade) not null|migration 001|
|involvement_level|varchar(20) not null|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|

Constraints: `exercise_muscles_involvement_level_check` CHECK (((involvement_level)::text = ANY ((ARRAY['PRIMARY'::character varying, 'SECONDARY'::character varying, 'STABILIZER'::character varying])::text[]))); `unique_exercise_muscle` UNIQUE (exercise_id, muscle_id)

### exercise_replacements

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|routine_id|integer FK → workout_routines (cascade) not null|migration 001|
|original_exercise_id|integer FK → exercises (cascade) not null|migration 001|
|replacement_exercise_id|integer FK → exercises (cascade) not null|migration 001|
|start_date|date not null|migration 001|
|end_date|date|migration 001|
|reason|text|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|

Constraints: `different_replacement_exercises` CHECK ((original_exercise_id <> replacement_exercise_id)); `valid_date_range` CHECK (((end_date IS NULL) OR (end_date >= start_date)))

### exercise_reports

Created in migration 021.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 021|
|exercise_id|integer FK → exercises (cascade)|migration 021|
|user_id|integer FK → users|migration 021|
|report_text|text not null|migration 021|
|created_at|timestamptz|migration 021; default now()|
|resolved|boolean|migration 021; default false|
|resolution_notes|text|migration 023|
|resolved_by|integer FK → users|migration 023|
|resolved_at|timestamptz|migration 023|

### exercises

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|name|varchar(255) not null|migration 001|
|description|text|migration 001|
|category|varchar(50)|migration 001|
|equipment_type|varchar(50)|migration 001|
|is_custom|boolean|migration 001; default false|
|created_by_user_id|integer FK → users (set null)|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|
|subcategory|varchar(50)|migration 005|
|muscles_primary|text[]|migration 006|
|muscles_secondary|text[]|migration 006|
|force|varchar(20)|migration 006|
|level|varchar(20)|migration 006|
|mechanic|varchar(20)|migration 006|
|video_url_male|varchar|migration 021|
|video_url_female|varchar|migration 021|
|instructions|text[]|migration 021|
|source|varchar|migration 027; default 'admin'|

### foods

Created in migration 002.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 002|
|name|varchar(255) not null|migration 002|
|brand|varchar(255)|migration 002|
|description|text|migration 002|
|calories_per_100g|numeric(8,2) not null|migration 002|
|protein_per_100g|numeric(6,2) not null|migration 002; default 0|
|carbs_per_100g|numeric(6,2) not null|migration 002; default 0|
|fat_per_100g|numeric(6,2) not null|migration 002; default 0|
|fiber_per_100g|numeric(6,2)|migration 002; default 0|
|sugar_per_100g|numeric(6,2)|migration 002; default 0|
|sodium_per_100g|numeric(6,2)|migration 002; default 0|
|serving_size|numeric(8,2)|migration 002|
|serving_unit|varchar(20)|migration 002|
|source|varchar(50) not null|migration 002|
|source_id|varchar(100)|migration 002|
|is_custom|boolean|migration 002; default false|
|created_by_user_id|integer FK → users (set null)|migration 002|
|created_at|timestamp|migration 002; default CURRENT_TIMESTAMP|
|updated_at|timestamp|migration 002; default CURRENT_TIMESTAMP|
|gtin_upc|varchar(20)|migration 003|
|brand_owner|varchar(100)|migration 003|
|brand_name|varchar(100)|migration 003|
|ingredients|text|migration 003|
|is_verified|boolean|migration 003; default true|
|usda_fdc_id|integer|migration 003|

Constraints: `positive_calories` CHECK ((calories_per_100g >= (0)::numeric)); `positive_macros` CHECK (((protein_per_100g >= (0)::numeric) AND (carbs_per_100g >= (0)::numeric) AND (fat_per_100g >= (0)::numeric)))

### habit_logs

Created in migration 036. Hand-logged habit values, one per habit per day (Phase 1A-2). Auto-metric habits are computed from workouts on read instead.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 036|
|habit_id|integer FK → habits (cascade) not null|migration 036|
|user_id|integer FK → users (cascade) not null|migration 036|
|log_date|date not null|migration 036|
|value|numeric(10,2) not null|migration 036; default 1|
|note|text|migration 036|
|created_at|timestamptz|migration 036; default now()|
|updated_at|timestamptz|migration 036; default now()|

Constraints: `habit_logs_value_nonneg` CHECK ((value >= (0)::numeric))

### habits

Created in migration 036. Habits (Phase 1A-2). auto_metric habits update from logged data; starter habits (starter_key) follow the settings goal named in goal_link while it has a value.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 036|
|user_id|integer FK → users (cascade) not null|migration 036|
|name|text not null|migration 036|
|description|text|migration 036|
|target_value|numeric(10,2)|migration 036|
|unit|text|migration 036|
|frequency|text not null|migration 036; default 'daily'|
|days_of_week|int4[]|migration 036|
|program_id|integer FK → programs (set null)|migration 036|
|routine_id|integer FK → workout_routines (set null)|migration 036|
|cardio_type|text|migration 036|
|auto_metric|text|migration 036|
|goal_link|text|migration 036|
|starter_key|text|migration 036|
|is_active|boolean not null|migration 036; default true|
|created_at|timestamptz|migration 036; default now()|
|updated_at|timestamptz|migration 036; default now()|

Constraints: `habits_auto_metric_allowed` CHECK (((auto_metric IS NULL) OR (auto_metric = ANY (ARRAY['workouts_completed'::text, 'workout_minutes'::text, 'cardio_minutes'::text, 'cardio_distance'::text])))); `habits_frequency_allowed` CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'specific_days'::text]))); `habits_name_not_blank` CHECK ((length(btrim(name)) > 0)); `habits_target_nonneg` CHECK (((target_value IS NULL) OR (target_value >= (0)::numeric)))

### injuries

Created in migration 036. Injury tracker (Phase 1A-2). Trainer-suggestion columns are ready for 1C-1.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 036|
|user_id|integer FK → users (cascade) not null|migration 036|
|body_area|text not null|migration 036|
|side|text|migration 036|
|start_date|date not null|migration 036|
|end_date|date|migration 036|
|status|text not null|migration 036; default 'active'|
|notes|text|migration 036|
|limit_flag|text|migration 036|
|limit_note|text|migration 036|
|source|text not null|migration 036; default 'self'|
|suggested_by_user_id|integer FK → users (set null)|migration 036|
|suggestion_status|text|migration 036|
|created_at|timestamptz|migration 036; default now()|
|updated_at|timestamptz|migration 036; default now()|

Constraints: `injuries_dates_ordered` CHECK (((end_date IS NULL) OR (end_date >= start_date))); `injuries_limit_flag_allowed` CHECK (((limit_flag IS NULL) OR (limit_flag = ANY (ARRAY['preference'::text, 'medical'::text])))); `injuries_side_allowed` CHECK (((side IS NULL) OR (side = ANY (ARRAY['left'::text, 'right'::text, 'both'::text])))); `injuries_source_allowed` CHECK ((source = ANY (ARRAY['self'::text, 'trainer'::text]))); `injuries_status_allowed` CHECK ((status = ANY (ARRAY['active'::text, 'recovering'::text, 'resolved'::text]))); `injuries_suggestion_status_allowed` CHECK (((suggestion_status IS NULL) OR (suggestion_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'dismissed'::text]))))

### meal_foods

Created in migration 002.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 002|
|meal_id|integer FK → meals (cascade) not null|migration 002|
|food_id|integer FK → foods (cascade) not null|migration 002|
|serving_size|numeric(8,2) not null|migration 002|
|serving_unit|varchar(20) not null|migration 002|
|calories|numeric(8,2) not null|migration 002|
|protein|numeric(6,2) not null|migration 002|
|carbs|numeric(6,2) not null|migration 002|
|fat|numeric(6,2) not null|migration 002|
|fiber|numeric(6,2)|migration 002|
|notes|text|migration 002|
|created_at|timestamp|migration 002; default CURRENT_TIMESTAMP|

Constraints: `positive_serving` CHECK ((serving_size > (0)::numeric))

### meals

Created in migration 002.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 002|
|user_id|integer FK → users (cascade) not null|migration 002|
|meal_date|date not null|migration 002|
|meal_type|varchar(20) not null|migration 002|
|meal_name|varchar(255)|migration 002|
|notes|text|migration 002|
|created_at|timestamp|migration 002; default CURRENT_TIMESTAMP|
|updated_at|timestamp|migration 002; default CURRENT_TIMESTAMP|

Constraints: `meals_meal_type_check` CHECK (((meal_type)::text = ANY ((ARRAY['breakfast'::character varying, 'lunch'::character varying, 'dinner'::character varying, 'snack'::character varying, 'other'::character varying])::text[])))

### muscles

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|name|varchar(100) not null|migration 001|
|muscle_group|varchar(50)|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|

Constraints: `muscles_name_key` UNIQUE (name)

### note_tags

Created in migration 036. Rules-based note tags (Phase 1A-2), rebuilt whenever a note is saved. Exercise notes are tagged per line (line_number; set_number for "Set N:" lines).

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 036|
|user_id|integer FK → users (cascade) not null|migration 036|
|workout_id|integer FK → workouts (cascade)|migration 036|
|source_type|text not null|migration 036|
|source_id|integer not null|migration 036|
|line_number|integer not null|migration 036; default 0|
|set_number|integer|migration 036|
|tag|text not null|migration 036|
|matched_keyword|text|migration 036|
|created_at|timestamptz|migration 036; default now()|

Constraints: `note_tags_source_type_allowed` CHECK ((source_type = ANY (ARRAY['workout_overall'::text, 'workout_session'::text, 'exercise'::text, 'segment'::text])))

### nutrition_plans

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|user_id|integer FK → users (cascade) not null|migration 001|
|plan_date|date not null|migration 001|
|metric_id|integer FK → user_metrics (set null)|migration 001|
|daily_calories|integer|migration 001|
|daily_protein|numeric(6,2)|migration 001|
|daily_carbs|numeric(6,2)|migration 001|
|daily_fat|numeric(6,2)|migration 001|
|meals_per_day|integer|migration 001|
|calories_per_meal|integer|migration 001|
|protein_per_meal|numeric(6,2)|migration 001|
|carbs_per_meal|numeric(6,2)|migration 001|
|fat_per_meal|numeric(6,2)|migration 001|
|notes|text|migration 001|
|is_active|boolean|migration 001; default true|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|
|updated_at|timestamp|migration 001; default CURRENT_TIMESTAMP|

Constraints: `nutrition_plans_calories_per_meal_check` CHECK ((calories_per_meal >= 0)); `nutrition_plans_carbs_per_meal_check` CHECK ((carbs_per_meal >= (0)::numeric)); `nutrition_plans_daily_calories_check` CHECK ((daily_calories > 0)); `nutrition_plans_daily_carbs_check` CHECK ((daily_carbs >= (0)::numeric)); `nutrition_plans_daily_fat_check` CHECK ((daily_fat >= (0)::numeric)); `nutrition_plans_daily_protein_check` CHECK ((daily_protein >= (0)::numeric)); `nutrition_plans_fat_per_meal_check` CHECK ((fat_per_meal >= (0)::numeric)); `nutrition_plans_meals_per_day_check` CHECK ((meals_per_day > 0)); `nutrition_plans_protein_per_meal_check` CHECK ((protein_per_meal >= (0)::numeric))

### program_day_skips

Created in migration 035. Skipped program days (Phase 1A-1): the day stays on the schedule; one skip per day.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 035|
|program_id|integer FK → programs (cascade) not null|migration 035|
|program_routine_id|integer FK → program_routines (set null)|migration 035|
|user_id|integer FK → users (cascade) not null|migration 035|
|scheduled_date|date|migration 035|
|reason|text|migration 035|
|skipped_at|timestamptz|migration 035; default now()|

### program_goals

Created in migration 036. Program goals with a target and a threshold (Phase 1A-2).

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 036|
|program_id|integer FK → programs (cascade) not null|migration 036|
|user_id|integer FK → users (cascade) not null|migration 036|
|name|text not null|migration 036|
|metric|text|migration 036|
|target_value|numeric(10,2)|migration 036|
|threshold_value|numeric(10,2)|migration 036|
|unit|text|migration 036|
|notes|text|migration 036|
|created_at|timestamptz|migration 036; default now()|
|updated_at|timestamptz|migration 036; default now()|

Constraints: `program_goals_name_not_blank` CHECK ((length(btrim(name)) > 0))

### program_journal_entries

Created in migration 020.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 020|
|program_id|integer FK → programs (cascade)|migration 020|
|user_id|integer FK → users (cascade)|migration 020|
|content|text not null|migration 020|
|created_at|timestamptz|migration 020; default now()|
|updated_at|timestamptz|migration 020; default now()|

### program_legend_items

Created in migration 035. Program document: legend entries (Phase 1A-1).

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 035|
|program_id|integer FK → programs (cascade) not null|migration 035|
|label|text not null|migration 035|
|description|text|migration 035|
|order_index|integer not null|migration 035; default 1|
|created_at|timestamptz|migration 035; default now()|

### program_pauses

Created in migration 035. Program pause and delay records (Phase 1A-1): items dated on or after from_date move delay_days later (computed on read).

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 035|
|program_id|integer FK → programs (cascade) not null|migration 035|
|user_id|integer FK → users (cascade) not null|migration 035|
|from_date|date not null|migration 035|
|delay_days|integer not null|migration 035; default 0|
|reason|text|migration 035|
|previous_status|text|migration 035|
|paused_at|timestamptz|migration 035; default now()|
|resumed_at|timestamptz|migration 035|

Constraints: `program_pauses_delay_range` CHECK (((delay_days >= 0) AND (delay_days <= 365)))

### program_phases

Created in migration 035. Program phases (Phase 1A-1): start_day (1 = first day; NULL = after the previous phase) and length in days.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 035|
|program_id|integer FK → programs (cascade) not null|migration 035|
|name|text not null|migration 035|
|start_day|integer|migration 035|
|length_days|integer not null|migration 035|
|notes|text|migration 035|
|order_index|integer not null|migration 035; default 1|
|created_at|timestamptz|migration 035; default now()|
|updated_at|timestamptz|migration 035; default now()|

Constraints: `program_phases_length_positive` CHECK ((length_days > 0)); `program_phases_start_positive` CHECK (((start_day IS NULL) OR (start_day > 0)))

### program_routines

Created in migration 018.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 018|
|program_id|integer FK → programs (cascade) not null|migration 018|
|routine_id|integer FK → workout_routines (cascade)|migration 018; NOT NULL dropped in migration 035 (NULL for rest days, single events, open days)|
|day_slot|integer|migration 018; NOT NULL dropped in migration 035 (never written by the app)|
|notes|text|migration 018|
|created_at|timestamptz|migration 018; default now()|
|week_number|integer|migration 020; default 1|
|day_of_week|integer|migration 020; 0=Mon … 6=Sun|
|is_rest_day|boolean|migration 020; default false|
|order_index|integer|migration 020; default 1|
|day_type|text|migration 035|
|title|text|migration 035|
|is_one_off|boolean not null|migration 035; default false|
|scheduled_date|date|migration 035|
|time_of_day|text|migration 035|
|planned_time|time|migration 035|
|special_tag|text|migration 035|
|special_note|text|migration 035|

Added constraints (Phase 1A): `program_routines_day_type_allowed` CHECK (((day_type IS NULL) OR (day_type = ANY (ARRAY['workout'::text, 'rest_day'::text, 'single_event'::text, 'open_day'::text])))); `program_routines_special_tag_allowed` CHECK (((special_tag IS NULL) OR (special_tag = ANY (ARRAY['pr_day'::text, 'trial'::text, 'evaluation'::text, 'milestone'::text])))); `program_routines_time_of_day_allowed` CHECK (((time_of_day IS NULL) OR (time_of_day = ANY (ARRAY['morning'::text, 'afternoon'::text, 'evening'::text]))))

### program_sources

Created in migration 035. Program document: sources (Phase 1A-1).

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 035|
|program_id|integer FK → programs (cascade) not null|migration 035|
|title|text not null|migration 035|
|url|text|migration 035|
|note|text|migration 035|
|order_index|integer not null|migration 035; default 1|
|created_at|timestamptz|migration 035; default now()|

### program_workouts

Created in migration 020. Program progress. A row only counts as done when its workout has status completed (Phase 0A-1).

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 020|
|program_id|integer FK → programs (cascade)|migration 020|
|program_routine_id|integer FK → program_routines (set null)|migration 020|
|workout_id|integer FK → workouts (cascade)|migration 020|
|scheduled_date|date|migration 020|
|completed_date|date|migration 020|
|created_at|timestamptz|migration 020; default now()|

Indexes: `uq_program_workouts_workout` UNIQUE (workout_id) WHERE workout_id IS NOT NULL (migration 033; one row per workout, duplicates removed keeping the lowest id).

### programs

Created in migration 018.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 018|
|user_id|integer FK → users (cascade) not null|migration 018|
|name|text not null|migration 018|
|description|text|migration 018|
|is_active|boolean|migration 018; default false|
|created_at|timestamptz|migration 018; default now()|
|updated_at|timestamptz|migration 018; default now()|
|duration_weeks|integer|migration 020|
|start_date|date|migration 020|
|status|text|migration 020; default 'draft'; 'draft' \| 'active' \| 'paused' \| 'completed'|
|schedule_shift_pref|text|migration 020; default 'none'|
|synopsis|text|migration 020|
|overload_strategy|varchar|migration 022; default 'none'|
|overload_increment|numeric|migration 022|
|schedule_mode|text not null|migration 035; default 'fixed'|
|workouts_per_week|integer|migration 035|
|is_pinned|boolean not null|migration 035; default false|
|pinned_at|timestamptz|migration 035|
|color|text|migration 035|
|overview|text|migration 035|
|readiness_checkin|boolean|migration 036|

Added constraints (Phase 1A): `programs_color_hex` CHECK (((color IS NULL) OR (color ~ '^#[0-9A-Fa-f]{6}$'::text))); `programs_schedule_mode_allowed` CHECK ((schedule_mode = ANY (ARRAY['fixed'::text, 'flexible'::text]))); `programs_workouts_per_week_range` CHECK (((workouts_per_week IS NULL) OR ((workouts_per_week >= 1) AND (workouts_per_week <= 14))))

### progress_photos

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|user_id|integer FK → users (cascade) not null|migration 001|
|photo_filename|varchar(255) not null|migration 001|
|photo_date|date not null|migration 001|
|metric_id|integer FK → user_metrics (set null)|migration 001|
|notes|text|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|

### record_edits

Created in migration 036. Edit audit trail (Phase 1A-2): one row per edit, soft delete or restore of a workout, set or cardio segment; changes = { column: { from, to } }.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 036|
|user_id|integer FK → users (cascade) not null|migration 036|
|record_type|text not null|migration 036|
|record_id|integer not null|migration 036|
|workout_id|integer FK → workouts (cascade)|migration 036|
|action|text not null|migration 036|
|changes|jsonb|migration 036|
|reason|text|migration 036|
|created_at|timestamptz|migration 036; default now()|

Constraints: `record_edits_action_allowed` CHECK ((action = ANY (ARRAY['edit'::text, 'delete'::text, 'restore'::text]))); `record_edits_type_allowed` CHECK ((record_type = ANY (ARRAY['workout'::text, 'set'::text, 'segment'::text])))

### review_snapshots

Created in migration 036. Cached daily / weekly review summaries (Phase 1A-2), one per user, period type and start.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 036|
|user_id|integer FK → users (cascade) not null|migration 036|
|period_type|text not null|migration 036|
|period_start|date not null|migration 036|
|period_end|date not null|migration 036|
|data|jsonb not null|migration 036|
|generated_at|timestamptz not null|migration 036; default now()|

Constraints: `review_snapshots_period_allowed` CHECK ((period_type = ANY (ARRAY['day'::text, 'week'::text])))

### routine_additions_preferences

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|user_id|integer FK → users (cascade) not null|migration 001|
|routine_id|integer FK → workout_routines (cascade) not null|migration 001|
|exercise_id|integer FK → exercises (cascade) not null|migration 001|
|action|varchar(20) not null|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|

Constraints: `routine_additions_preferences_action_check` CHECK (((action)::text = ANY ((ARRAY['ALWAYS_ADD'::character varying, 'ALWAYS_ASK'::character varying, 'NEVER_ADD'::character varying])::text[]))); `unique_routine_addition_pref` UNIQUE (user_id, routine_id, exercise_id)

### routine_exercises

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|routine_id|integer FK → workout_routines (cascade) not null|migration 001|
|exercise_id|integer FK → exercises (cascade) not null|migration 001|
|order_index|integer not null|migration 001|
|target_sets|integer|migration 001|
|target_weight|numeric(6,2)|migration 001|
|superset_group|integer|migration 001|
|notes|text|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|
|cooldown_seconds|integer|migration 014; default 60|
|training_type|text not null|migration 014; default 'standard'|
|training_duration|integer|migration 014|
|superset_order|integer|migration 014|
|overload_strategy|varchar|migration 024; default 'none'|
|overload_increment|numeric|migration 024|
|overload_schedule|varchar|migration 024; default 'linear'|
|overload_week_targets|jsonb|migration 024|
|tempo_eccentric|integer|migration 024|
|tempo_pause|integer|migration 024|
|tempo_concentric|integer|migration 024|
|target_reps_min|integer|migration 029|
|target_reps_max|integer|migration 029|
|target_rpe|smallint|migration 035|
|micro_overload|jsonb|migration 035|

Constraints: `positive_order` CHECK ((order_index > 0)); `routine_exercises_overload_schedule_check` CHECK (((overload_schedule)::text = ANY ((ARRAY['linear'::character varying, 'custom'::character varying])::text[]))); `routine_exercises_overload_strategy_check` CHECK (((overload_strategy)::text = ANY ((ARRAY['none'::character varying, 'weight'::character varying, 'reps'::character varying, 'sets'::character varying])::text[])))

Added constraints (Phase 1A): `routine_exercises_target_rpe_range` CHECK (((target_rpe IS NULL) OR ((target_rpe >= 1) AND (target_rpe <= 11))))

### saved_routes

Created in migration 036. Saved cardio routes (Phase 1A-2), reusable on segments and cardio sessions.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 036|
|user_id|integer FK → users (cascade) not null|migration 036|
|name|text not null|migration 036|
|route_data|jsonb|migration 036|
|distance|numeric(10,3)|migration 036|
|distance_unit|text|migration 036|
|notes|text|migration 036|
|created_at|timestamptz|migration 036; default now()|
|updated_at|timestamptz|migration 036; default now()|

Constraints: `saved_routes_distance_nonneg` CHECK (((distance IS NULL) OR (distance >= (0)::numeric))); `saved_routes_name_not_blank` CHECK ((length(btrim(name)) > 0))

### scheduled_workouts

Created in migration 018.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 018|
|user_id|integer FK → users (cascade) not null|migration 018|
|routine_id|integer FK → workout_routines (set null)|migration 018|
|program_id|integer FK → programs (set null)|migration 018|
|scheduled_date|date not null|migration 018|
|recurrence_type|text|migration 018|
|recurrence_value|integer|migration 018|
|recurrence_days|int4[]|migration 018|
|recurrence_end|date|migration 018|
|completed|boolean|migration 018; default false|
|workout_id|integer FK → workouts (set null)|migration 018|
|notes|text|migration 018|
|created_at|timestamptz|migration 018; default now()|
|updated_at|timestamptz|migration 018; default now()|

### tempo_templates

Created in migration 025.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 025|
|user_id|integer FK → users (cascade) not null|migration 025|
|name|varchar not null|migration 025|
|eccentric|integer not null|migration 025|
|pause|integer not null|migration 025|
|concentric|integer not null|migration 025|
|created_at|timestamptz|migration 025; default now()|

Constraints: `tempo_templates_concentric_check` CHECK ((concentric >= 0)); `tempo_templates_eccentric_check` CHECK ((eccentric >= 0)); `tempo_templates_pause_check` CHECK ((pause >= 0))

### user_exercise_names

Created in migration 035. A user's own default name for an exercise (Phase 1A-1).

|Column|Type|Notes|
|---|---|---|
|user_id|integer FK → users (cascade) not null|migration 035|
|exercise_id|integer FK → exercises (cascade) not null|migration 035|
|display_name|text not null|migration 035|
|created_at|timestamptz|migration 035; default now()|
|updated_at|timestamptz|migration 035; default now()|

Constraints: `user_exercise_names_not_blank` CHECK ((length(btrim(display_name)) > 0))

### user_export_preferences

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|user_id|integer FK → users (cascade) not null|migration 001|
|auto_export_enabled|boolean|migration 001; default false|
|export_frequency|varchar(20)|migration 001|
|export_format|varchar(20)|migration 001|
|export_destination|varchar(50)|migration 001|
|last_export_date|timestamp|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|
|updated_at|timestamp|migration 001; default CURRENT_TIMESTAMP|

Constraints: `user_export_preferences_export_destination_check` CHECK (((export_destination)::text = ANY ((ARRAY['email'::character varying, 'google_drive'::character varying, 'dropbox'::character varying])::text[]))); `user_export_preferences_export_format_check` CHECK (((export_format)::text = ANY ((ARRAY['csv'::character varying, 'json'::character varying, 'both'::character varying])::text[]))); `user_export_preferences_export_frequency_check` CHECK (((export_frequency)::text = ANY ((ARRAY['weekly'::character varying, 'monthly'::character varying])::text[]))); `user_export_preferences_user_id_key` UNIQUE (user_id)

### user_food_overrides

Created in migration 004.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 004|
|user_id|integer FK → users (cascade) not null|migration 004|
|food_id|integer FK → foods (cascade) not null|migration 004|
|calories|numeric(8,2)|migration 004|
|protein_g|numeric(8,2)|migration 004|
|carbs_g|numeric(8,2)|migration 004|
|fat_g|numeric(8,2)|migration 004|
|fiber_g|numeric(8,2)|migration 004|
|sugar_g|numeric(8,2)|migration 004|
|notes|text|migration 004|
|created_at|timestamp|migration 004; default CURRENT_TIMESTAMP|
|updated_at|timestamp|migration 004; default CURRENT_TIMESTAMP|

Constraints: `positive_calories` CHECK (((calories IS NULL) OR (calories >= (0)::numeric))); `positive_carbs` CHECK (((carbs_g IS NULL) OR (carbs_g >= (0)::numeric))); `positive_fat` CHECK (((fat_g IS NULL) OR (fat_g >= (0)::numeric))); `positive_fiber` CHECK (((fiber_g IS NULL) OR (fiber_g >= (0)::numeric))); `positive_protein` CHECK (((protein_g IS NULL) OR (protein_g >= (0)::numeric))); `positive_sugar` CHECK (((sugar_g IS NULL) OR (sugar_g >= (0)::numeric))); `unique_user_food_override` UNIQUE (user_id, food_id)

### user_metrics

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|user_id|integer FK → users (cascade) not null|migration 001|
|metric_date|date not null|migration 001|
|scan_method|varchar(100)|migration 001|
|body_composition|jsonb|migration 001|
|notes|text|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|

### users

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|email|varchar(255) not null|migration 001|
|password_hash|varchar(255) not null|migration 001|
|username|varchar(50) not null|migration 001|
|oauth_provider|varchar(50)|migration 001|
|oauth_id|varchar(255)|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|
|updated_at|timestamp|migration 001; default CURRENT_TIMESTAMP|
|display_name|text|migration 010|
|profile_picture|text|migration 010|
|height_cm|numeric(5,1)|migration 010|
|weight_kg|numeric(5,1)|migration 010|
|date_of_birth|date|migration 010|
|gender|text|migration 010|
|units_weight|text not null|migration 010; default 'lbs'|
|units_distance|text not null|migration 010; default 'mi'|
|theme_preference|text not null|migration 010; default 'system'|
|goals|jsonb not null|migration 010; default '[]'|
|email_verified|boolean not null|migration 010; default false|
|email_verify_token|text|migration 010|
|email_verify_sent_at|timestamptz|migration 010|
|initials|text|migration 011|
|workout_rating_prefs|jsonb not null|migration 012; default '{"label": "Effort & Vibes", "scale": 5, "display": "slider"}'|
|is_admin|boolean not null|migration 013; default false|
|units_pace|text|migration 016; default 'min/mile'|
|units_split_distance|integer|migration 016; default 500|
|reorder_mode|varchar|migration 026; default 'drag'|
|previous_notes_scope|varchar|migration 026; default 'all'|
|tempo_visual_enabled|boolean|migration 026; default false|
|tempo_audio_enabled|boolean|migration 026; default false|
|timezone|text|migration 030; IANA zone from the browser; NULL means UTC. Used for hour/day-of-week stats|
|workout_age_limit_hours|integer not null|migration 032; default 24. Auto-cancel and resume window; one of 1–12, 24, 36, 48|
|pause_note_minutes|integer not null|migration 032; default 15. Shortest pause noted on the detail page; 5–60 in steps of 5|
|log_set_button_position|text not null|migration 033; default 'inline'. 'inline' or 'pinned' (bar above Previous / Next on phones)|
|tempo_countdown_beeps|integer not null|migration 033; default 3. Tempo lead-in beeps before the first rep, 0–5 (0 = off)|
|tempo_click_track_enabled|boolean not null|migration 034; default true|
|tempo_track_with_timers|boolean not null|migration 034; default false|
|readiness_checkin_default|boolean not null|migration 036; default false|

Constraints: `oauth_unique` UNIQUE (oauth_provider, oauth_id); `users_email_key` UNIQUE (email); `users_previous_notes_scope_check` CHECK (((previous_notes_scope)::text = ANY ((ARRAY['all'::character varying, 'program'::character varying, 'non_program'::character varying])::text[]))); `users_reorder_mode_check` CHECK (((reorder_mode)::text = ANY ((ARRAY['drag'::character varying, 'arrows'::character varying])::text[]))); `users_username_key` UNIQUE (username); `users_workout_age_limit_hours_allowed` CHECK (workout_age_limit_hours IN (1,2,3,4,5,6,7,8,9,10,11,12,24,36,48)); `users_pause_note_minutes_allowed` CHECK (pause_note_minutes IN (5,10,15,20,25,30,35,40,45,50,55,60)); `users_log_set_button_position_allowed` CHECK (log_set_button_position IN ('inline','pinned')); `users_tempo_countdown_beeps_allowed` CHECK (tempo_countdown_beeps BETWEEN 0 AND 5)

### workout_cardio_segments

Created in migration 016. Cardio segments logged inside a workouts row.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 016|
|workout_exercise_id|integer FK → workout_exercises (cascade) not null|migration 016|
|workout_id|integer FK → workouts (cascade) not null|migration 016|
|segment_number|integer not null|migration 016|
|segment_label|text|migration 016|
|duration_seconds|integer|migration 016|
|distance|numeric(10,3)|migration 016|
|distance_unit|text|migration 016|
|pace|numeric(10,4)|migration 016|
|pace_unit|text|migration 016|
|pace_overridden|boolean|migration 016; default false|
|reps|integer|migration 016|
|notes|text|migration 016|
|created_at|timestamptz|migration 016; default now()|
|updated_at|timestamptz|migration 016; default now()|
|avg_speed|numeric(6,2)|migration 019|
|max_speed|numeric(6,2)|migration 019|
|edited_at|timestamptz|migration 036|
|deleted_at|timestamptz|migration 036|
|deleted_reason|text|migration 036|
|avg_heart_rate|integer|migration 036|
|max_heart_rate|integer|migration 036|
|min_heart_rate|integer|migration 036|
|hr_zone_1_seconds|integer|migration 036|
|hr_zone_2_seconds|integer|migration 036|
|hr_zone_3_seconds|integer|migration 036|
|hr_zone_4_seconds|integer|migration 036|
|hr_zone_5_seconds|integer|migration 036|
|elevation_gain|numeric(8,2)|migration 036|
|elevation_loss|numeric(8,2)|migration 036|
|elevation_max|numeric(8,2)|migration 036|
|route_data|jsonb|migration 036|
|avg_cadence|integer|migration 036|
|max_cadence|integer|migration 036|
|calories_burned|integer|migration 036|
|source_device|text|migration 036|
|external_id|text|migration 036|
|saved_route_id|integer FK → saved_routes (set null)|migration 036|

### workout_exercises

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|workout_id|integer FK → workouts (cascade) not null|migration 001|
|exercise_id|integer FK → exercises (cascade) not null|migration 001|
|order_index|integer not null|migration 001|
|exercise_notes|text|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|
|target_sets|integer|migration 008|
|target_weight|numeric|migration 008|
|goal_duration_seconds|integer|migration 017|
|goal_distance|numeric(10,3)|migration 017|
|goal_distance_unit|text|migration 017|
|goal_pace|numeric(10,4)|migration 017|
|goal_pace_unit|text|migration 017|
|goal_laps|integer|migration 017|
|goal_lap_distance|numeric(8,2)|migration 017|
|target_reps_min|integer|migration 029|
|target_reps_max|integer|migration 029|
|target_rpe|smallint|migration 035|

Constraints: `positive_workout_order` CHECK ((order_index > 0))

Added constraints (Phase 1A): `workout_exercises_target_rpe_range` CHECK (((target_rpe IS NULL) OR ((target_rpe >= 1) AND (target_rpe <= 11))))

### workout_routines

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|user_id|integer FK → users (cascade) not null|migration 001|
|name|varchar(255) not null|migration 001|
|description|text|migration 001|
|is_active|boolean|migration 001; default true|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|
|updated_at|timestamp|migration 001; default CURRENT_TIMESTAMP|
|primary_muscles|text[]|migration 018; default '{}'|
|secondary_muscles|text[]|migration 018; default '{}'|
|tags|text[]|migration 018; default '{}'|
|readiness_checkin|boolean|migration 036|

### workout_session_events

Created in migration 032. One row per lifecycle event of a workout (Phase 0A-2). Rows backfilled by 032 carry `metadata = {"backfilled": true}`.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 032|
|workout_id|integer FK → workouts (cascade) not null|migration 032|
|event_type|text not null|migration 032; started, paused, resumed, cancelled, auto_cancelled, reopened, finished|
|occurred_at|timestamptz not null|migration 032; default now()|
|metadata|jsonb|migration 032; e.g. paused_seconds, reason, gap_seconds, swept_at, age_limit_hours|

Constraints: `workout_session_events_type_allowed` CHECK (event_type IN ('started','paused','resumed','cancelled','auto_cancelled','reopened','finished')). Index: `idx_workout_session_events_workout` (workout_id, occurred_at).

### workout_sets

Created in migration 001.

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|workout_exercise_id|integer FK → workout_exercises (cascade) not null|migration 001|
|set_number|integer not null|migration 001|
|reps_completed|integer not null|migration 001; the real reps column (not "reps")|
|weight_used|numeric(6,2) not null|migration 001; the real weight column (not "weight")|
|rpe|integer|migration 001|
|rest_seconds|integer|migration 001|
|tempo|varchar(20)|migration 001|
|set_type|varchar(20)|migration 001; default 'normal'; 028: 'normal' \| 'warmup' \| 'drop' \| 'superset' \| 'emom' \| 'tabata' \| 'amrap' \| 'interval'|
|superset_group|integer|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP; naive timestamp, session TimeZone (UTC on production); used by the 24h stale sweep|
|edited_at|timestamptz|migration 036|
|deleted_at|timestamptz|migration 036|
|deleted_reason|text|migration 036|

Constraints: `non_negative_weight` CHECK ((weight_used >= (0)::numeric)); `positive_set_number` CHECK ((set_number > 0)); `workout_sets_reps_nonnegative` CHECK ((reps_completed >= 0)); `workout_sets_rest_seconds_check` CHECK ((rest_seconds >= 0)); `workout_sets_rpe_check` CHECK (((rpe >= 1) AND (rpe <= 11))) (widened from 10 to 11 in migration 034); `workout_sets_set_type_allowed` CHECK (((set_type)::text = ANY ((ARRAY['normal'::character varying, 'warmup'::character varying, 'drop'::character varying, 'superset'::character varying, 'emom'::character varying, 'tabata'::character varying, 'amrap'::character varying, 'interval'::character varying])::text[])))

### workouts

Created in migration 001. One row per session (strength, cardio, mixed, open, meditation). Status lifecycle from Phase 0A-1 (030/031).

|Column|Type|Notes|
|---|---|---|
|id|serial PK|migration 001|
|user_id|integer FK → users (cascade) not null|migration 001|
|routine_id|integer FK → workout_routines (set null)|migration 001|
|workout_date|date not null|migration 001; bare DATE, the user's local calendar day|
|start_time|timestamp|migration 001; naive timestamp holding UTC (written as toISOString() or NOW() on a UTC server)|
|end_time|timestamp|migration 001; naive UTC; set only when a workout completes (NULL while in progress or cancelled since 0A-1)|
|overall_notes|text|migration 001|
|created_at|timestamp|migration 001; default CURRENT_TIMESTAMP|
|status|varchar(20) not null|migration 007; 'in_progress' \| 'completed' \| 'cancelled'; no default since 030/031, every insert sets it|
|session_rating|smallint|migration 012|
|session_notes|text|migration 012|
|workout_title|text|migration 014|
|workout_type|text|migration 019; default 'open'; 'strength' \| 'cardio' \| 'mixed' \| 'open' \| 'meditation'|
|duration_seconds|integer|migration 027; explicit length, written for meditation; wins over end - start - paused|
|program_id|integer FK → programs (set null)|migration 030; shell change on production; added to repo migrations in 030 (FK NOT VALID)|
|program_routine_id|integer FK → program_routines (set null)|migration 030; shell change on production; added to repo migrations in 030 (FK NOT VALID)|
|paused_at|timestamptz|migration 030; shell change on production; added to repo in 030. Pause is client-side; cleared on finish/cancel|
|total_paused_seconds|integer|migration 030; default 0; shell change on production; added to repo in 030. Written on finish (0A-1)|
|vibes_rating|smallint|migration 036|
|fuel_rating|smallint|migration 036|
|readiness_sleep|smallint|migration 036|
|readiness_soreness|smallint|migration 036|
|readiness_energy|smallint|migration 036|
|readiness_recorded_at|timestamptz|migration 036|
|edited_at|timestamptz|migration 036|
|deleted_at|timestamptz|migration 036|
|deleted_reason|text|migration 036|

Constraints: `valid_workout_time` CHECK (((end_time IS NULL) OR (end_time >= start_time))); `workouts_duration_seconds_check` CHECK (((duration_seconds IS NULL) OR (duration_seconds >= 0))); `workouts_session_rating_check` CHECK (((session_rating >= 1) AND (session_rating <= 10))); `workouts_status_allowed` CHECK (((status)::text = ANY ((ARRAY['in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
---

## Known differences from production

This doc describes what the repo migrations build. Production also has hand-made shell changes, and some columns may differ in type, default or nullability. For example, the previous version of this doc listed `program_routines.routine_id` and `day_slot` as nullable on production, while the migrations create them `not null`. Migration 030 now creates `workouts.program_id`, `program_routine_id`, `paused_at` and `total_paused_seconds` with `IF NOT EXISTS`, so on production they keep whatever type the shell change gave them.

To compare, run the read-only dump in the Northflank shell and diff it against this file:

```
node backend/scripts/one-off/dump-schema.js > schema-prod.md
```

It prints every table's columns (type, default, nullable) and constraints, the session TimeZone, and the applied migrations.

---

## Shell Query Reference

To run any SQL query in the Northflank shell, use this format (replace the SQL on the pool.query line):

```
node << 'EOF'
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: false } });
pool.query('YOUR SQL HERE').then(r => { console.log(JSON.stringify(r.rows, null, 2)); pool.end(); }).catch(e => { console.error(e); pool.end(); });
EOF
```

---

## How to update this doc

- When a migration is run: add new columns/tables with the migration number in Notes
- When a shell change is made: add the column/change with `shell change` in Notes
- Claude Code will output exact lines to add here after any schema-affecting build

Added constraints (Phase 1A): `workouts_fuel_rating_range` CHECK (((fuel_rating IS NULL) OR ((fuel_rating >= 1) AND (fuel_rating <= 5)))); `workouts_readiness_range` CHECK ((((readiness_sleep IS NULL) OR ((readiness_sleep >= 1) AND (readiness_sleep <= 5))) AND ((readiness_soreness IS NULL) OR ((readiness_soreness >= 1) AND (readiness_soreness <= 5))) AND ((readiness_energy IS NULL) OR ((readiness_energy >= 1) AND (readiness_energy <= 5))))); `workouts_vibes_rating_range` CHECK (((vibes_rating IS NULL) OR ((vibes_rating >= 1) AND (vibes_rating <= 10))))

