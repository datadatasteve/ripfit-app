import { useState } from 'react';
import {
  DndContext, DragOverlay, closestCenter,
  MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import './SortableList.css';

/**
 * Drag handle: the only element that starts a drag, so scrolling and tapping
 * the rest of a row behave normally on touch screens.
 */
function DragHandle({ listeners, attributes, label }) {
  return (
    <button
      type="button"
      className="sortable-handle"
      aria-label={label}
      title="Drag to reorder"
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  );
}

function SortableRow({ id, index, item, renderItem, dropPosition, handleLabel }) {
  const { setNodeRef, listeners, attributes, isDragging } = useSortable({ id });
  // Rows are deliberately not shifted while dragging: the lifted copy follows
  // the pointer in DragOverlay and a drop line marks where it will land.
  return (
    <div
      ref={setNodeRef}
      className={`sortable-row ${isDragging ? 'is-source' : ''} ${dropPosition ? `drop-${dropPosition}` : ''}`}
    >
      {renderItem(item, index, {
        handle: <DragHandle listeners={listeners} attributes={attributes} label={handleLabel(item, index)} />,
        isDragging,
      })}
    </div>
  );
}

/**
 * Reorderable vertical list honouring the user's reorder_mode preference.
 *
 *   mode 'drag'   → each row gets a ⠿ handle (click-drag on desktop, 300 ms
 *                   press-and-hold on touch, arrow keys via keyboard).
 *   mode 'arrows' → no handle; renderItem draws its own ↑/↓ buttons, exactly
 *                   as the component did before, and no drag context is made.
 *
 * renderItem(item, index, { handle, isDragging, overlay }) — `handle` is null
 * in arrows mode.
 */
export default function SortableList({ items, getKey, onMove, mode, renderItem, className = '', handleLabel }) {
  const [activeKey, setActiveKey] = useState(null);
  const [overKey, setOverKey] = useState(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const labelFor = handleLabel || ((_, i) => `Reorder item ${i + 1}`);

  if (mode !== 'drag') {
    return (
      <div className={className}>
        {items.map((item, index) => (
          <div key={getKey(item, index)} className="sortable-row">
            {renderItem(item, index, { handle: null, isDragging: false })}
          </div>
        ))}
      </div>
    );
  }

  const keys = items.map((item, i) => getKey(item, i));
  const activeIndex = activeKey === null ? -1 : keys.indexOf(activeKey);
  const overIndex = overKey === null ? -1 : keys.indexOf(overKey);

  const reset = () => { setActiveKey(null); setOverKey(null); };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => { setActiveKey(active.id); setOverKey(active.id); }}
      onDragOver={({ over }) => setOverKey(over ? over.id : null)}
      onDragCancel={reset}
      onDragEnd={({ active, over }) => {
        const from = keys.indexOf(active.id);
        const to = over ? keys.indexOf(over.id) : -1;
        reset();
        if (from !== -1 && to !== -1 && from !== to) onMove(from, to);
      }}
    >
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        <div className={className}>
          {items.map((item, index) => {
            const key = keys[index];
            let dropPosition = null;
            if (activeIndex !== -1 && overIndex !== -1 && overIndex !== activeIndex && index === overIndex) {
              dropPosition = overIndex > activeIndex ? 'after' : 'before';
            }
            return (
              <SortableRow
                key={key}
                id={key}
                index={index}
                item={item}
                renderItem={renderItem}
                dropPosition={dropPosition}
                handleLabel={labelFor}
              />
            );
          })}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeIndex !== -1 ? (
          <div className="sortable-overlay">
            {renderItem(items[activeIndex], activeIndex, {
              handle: <span className="sortable-handle" aria-hidden="true">⠿</span>,
              isDragging: true,
              overlay: true,
            })}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Stable per-row keys for lists whose items have no id of their own. */
let keySeq = 0;
export const newRowKey = () => `row-${Date.now().toString(36)}-${(keySeq++).toString(36)}`;
