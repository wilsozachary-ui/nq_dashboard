import SessionStartChecklist from './SessionStartChecklist';
import './ChecklistTab.css';

// The checklist renders as a floating modal by default.
// Wrapping it here keeps it within the tab's visual context while
// preserving all existing autorun + DOM-check behaviour.
export default function ChecklistTab() {
  return (
    <div className="clt-tab">
      <SessionStartChecklist />
    </div>
  );
}
