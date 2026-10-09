import { HEARD_ABOUT_LABEL, DESK_HEARD_ABOUT, type DeskHeardAbout } from "@/lib/desk-intake";
import { cn } from "@/lib/utils";

export function HeardAboutPicker({
  value,
  onChange,
}: {
  value: DeskHeardAbout | null;
  onChange: (value: DeskHeardAbout) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {DESK_HEARD_ABOUT.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "min-h-14 rounded-md border px-3 text-left text-base font-medium",
            key === "other" && "col-span-2",
            value === key
              ? "border-primary bg-primary/15 text-foreground"
              : "border-border bg-card text-foreground",
          )}
        >
          {HEARD_ABOUT_LABEL[key]}
        </button>
      ))}
    </div>
  );
}
