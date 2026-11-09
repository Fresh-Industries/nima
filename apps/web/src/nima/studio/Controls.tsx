import type { ReactNode } from "react";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "../../components/ui/select";
export function StudioField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function StudioNumber({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const displayedValue = Math.round(value * 1_000_000) / 1_000_000;
  return (
    <StudioField label={label}>
      <Input
        key={value}
        aria-label={label}
        type="number"
        size="sm"
        defaultValue={displayedValue}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onBlur={(event) => {
          const next = event.target.valueAsNumber;
          if (
            !Number.isFinite(next) ||
            (min !== undefined && next < min) ||
            (max !== undefined && next > max)
          ) {
            event.currentTarget.value = String(displayedValue);
            return;
          }
          if (next !== displayedValue) onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </StudioField>
  );
}
export function StudioChoice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly (string | { value: string; label: string })[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const items = options.map((option) =>
    typeof option === "string" ? { value: option, label: option.replaceAll("_", " ") } : option,
  );
  return (
    <StudioField label={label}>
      <Select
        items={items}
        value={value}
        onValueChange={(value) => {
          if (value) onChange(value);
        }}
        disabled={disabled}
      >
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {options.map((option) => {
            const item =
              typeof option === "string"
                ? { value: option, label: option.replaceAll("_", " ") }
                : option;
            return (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
    </StudioField>
  );
}
