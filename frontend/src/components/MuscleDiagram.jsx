import Model from 'react-body-highlighter';
import './MuscleDiagram.css';

// Slugs react-body-highlighter recognises. Anything else in the DB is dropped
// rather than passed through, since an unknown slug renders nothing anyway.
const VALID_MUSCLES = new Set([
  'trapezius', 'upper-back', 'lower-back', 'chest', 'biceps', 'triceps', 'forearm',
  'back-deltoids', 'front-deltoids', 'abs', 'obliques', 'adductor', 'abductors',
  'hamstring', 'quadriceps', 'calves', 'gluteal', 'head', 'neck', 'knees',
  'left-soleus', 'right-soleus',
]);

const clean = (list) => (Array.isArray(list) ? list : []).filter(m => VALID_MUSCLES.has(m));

/**
 * Front and back body views with the exercise's muscles highlighted.
 *
 * Primary muscles are passed at frequency 2 and secondary at frequency 1, which
 * maps them onto the two entries of highlightedColors. With no muscle data the
 * model still renders, just unhighlighted.
 */
export default function MuscleDiagram({ primary, secondary, exerciseName = 'Exercise' }) {
  const primaryMuscles = clean(primary);
  const secondaryMuscles = clean(secondary);

  const data = [];
  if (secondaryMuscles.length) data.push({ name: exerciseName, muscles: secondaryMuscles, frequency: 1 });
  if (primaryMuscles.length) data.push({ name: exerciseName, muscles: primaryMuscles, frequency: 2 });

  const hasData = data.length > 0;

  return (
    <div className="muscle-diagram">
      <div className="muscle-diagram-models">
        <div className="muscle-diagram-view">
          <Model
            type="anterior"
            data={data}
            highlightedColors={['#93c5fd', '#2563eb']}
            style={{ width: '100%' }}
          />
          <span className="muscle-diagram-caption">Front</span>
        </div>
        <div className="muscle-diagram-view">
          <Model
            type="posterior"
            data={data}
            highlightedColors={['#93c5fd', '#2563eb']}
            style={{ width: '100%' }}
          />
          <span className="muscle-diagram-caption">Back</span>
        </div>
      </div>

      {hasData ? (
        <div className="muscle-diagram-legend">
          {primaryMuscles.length > 0 && (
            <span className="muscle-diagram-key"><i className="swatch primary" /> Primary</span>
          )}
          {secondaryMuscles.length > 0 && (
            <span className="muscle-diagram-key"><i className="swatch secondary" /> Secondary</span>
          )}
        </div>
      ) : (
        <p className="muscle-diagram-empty">No muscle data recorded for this exercise yet.</p>
      )}
    </div>
  );
}
