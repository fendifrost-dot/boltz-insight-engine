import { HEARD_ABOUT_LABEL, DESK_HEARD_ABOUT, type DeskHeardAbout } from "@/lib/desk-intake";

export function HeardAboutPicker({
  value,
  onChange,
}: {
  value: DeskHeardAbout | null;
  onChange: (value: DeskHeardAbout) => void;
}) {
  return (
    <select
      aria-label="How did they hear about us?"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value as DeskHeardAbout)}
      className="desk-field"
      required
    >
      <option value="" disabled>
        Choose their answer
      </option>
      {DESK_HEARD_ABOUT.map((key) => (
        <option key={key} value={key}>
          {HEARD_ABOUT_LABEL[key]}
        </option>
      ))}
    </select>
  );
}
