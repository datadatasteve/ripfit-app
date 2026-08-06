-- Migration 015: Seed cardio exercise types into exercises table
-- These allow cardio to be logged within strength workouts via the exercise picker.
-- Category = 'Cardio', subcategory = type group, equipment_type = modality.
-- All entries use IF NOT EXISTS pattern via name uniqueness check.

INSERT INTO exercises (name, category, subcategory, equipment_type, description)
SELECT name, category, subcategory, equipment_type, description
FROM (VALUES
  ('Treadmill',            'Cardio', 'Machine',   'Treadmill',      'Indoor treadmill running or walking at any pace or incline.'),
  ('Indoor Running',       'Cardio', 'Running',   'None',           'Running on an indoor track or treadmill without machine assistance.'),
  ('Outdoor Running',      'Cardio', 'Running',   'None',           'Running outdoors on roads, trails, or tracks.'),
  ('Walking',              'Cardio', 'Walking',   'None',           'Low-intensity walking, indoors or outdoors.'),
  ('Hiking',               'Cardio', 'Walking',   'None',           'Walking on trails, typically with elevation change.'),
  ('Outdoor Cycling',      'Cardio', 'Cycling',   'Bicycle',        'Road, trail, or gravel cycling outdoors.'),
  ('Indoor Cycling',       'Cardio', 'Cycling',   'Stationary Bike','Stationary bike or spin bike session.'),
  ('Elliptical',           'Cardio', 'Machine',   'Elliptical',     'Low-impact elliptical trainer session.'),
  ('Rowing Machine',       'Cardio', 'Machine',   'Rowing Machine', 'Indoor rowing ergometer session.'),
  ('Stair Climber',        'Cardio', 'Machine',   'Stair Climber',  'Stair climber or StairMaster machine session.'),
  ('Swimming',             'Cardio', 'Swimming',  'Pool',           'Freestyle, lap, or open water swimming.'),
  ('Jump Rope',            'Cardio', 'Bodyweight','Jump Rope',      'Continuous or interval jump rope cardio.'),
  ('HIIT',                 'Cardio', 'Interval',  'Varies',         'High-intensity interval training — short max-effort bursts with rest periods.'),
  ('Sprints',              'Cardio', 'Interval',  'None',           'Short all-out sprint efforts with full recovery between reps.'),
  ('Suicides / Shuttles',  'Cardio', 'Interval',  'None',           'Shuttle runs back and forth across set distances, typically with progressive touch points.')
) AS new_exercises(name, category, subcategory, equipment_type, description)
WHERE NOT EXISTS (
  SELECT 1 FROM exercises e WHERE LOWER(e.name) = LOWER(new_exercises.name)
);
