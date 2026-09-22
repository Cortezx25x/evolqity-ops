import type { InspectionItemCondition } from '../../api/inspections.api';
import {
  INSPECTION_CONDITIONS,
  inspectionConditionLabel,
} from '../../lib/inspections';

export interface InspectionConditionSelectorProps {
  value: InspectionItemCondition | null;
  disabled?: boolean;
  pending?: boolean;
  readOnly?: boolean;
  highlightMissing?: boolean;
  namePrefix: string;
  onSelect: (condition: InspectionItemCondition) => void;
}

export function InspectionConditionSelector({
  value,
  disabled = false,
  pending = false,
  readOnly = false,
  highlightMissing = false,
  namePrefix,
  onSelect,
}: InspectionConditionSelectorProps) {
  if (readOnly) {
    return (
      <p className="inspection-condition-readonly">
        {value === null
          ? 'Sin condición'
          : inspectionConditionLabel(value)}
      </p>
    );
  }

  return (
    <div
      className={
        highlightMissing && value === null
          ? 'inspection-condition-group inspection-condition-group--missing'
          : 'inspection-condition-group'
      }
      role="group"
      aria-label="Condición del punto"
    >
      {INSPECTION_CONDITIONS.map((condition) => {
        const selected = value === condition;
        const controlId = `${namePrefix}-${condition}`;

        return (
          <button
            key={condition}
            id={controlId}
            type="button"
            className={
              selected
                ? `inspection-condition-btn inspection-condition-btn--${condition === 'NOT_APPLICABLE' ? 'na' : condition.toLowerCase()} is-selected`
                : `inspection-condition-btn inspection-condition-btn--${condition === 'NOT_APPLICABLE' ? 'na' : condition.toLowerCase()}`
            }
            disabled={disabled || pending}
            aria-pressed={selected}
            onClick={() => onSelect(condition)}
          >
            {inspectionConditionLabel(condition)}
          </button>
        );
      })}
    </div>
  );
}
