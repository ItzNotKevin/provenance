import { Pressable, Text, type PressableProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type IoniconName = keyof typeof Ionicons.glyphMap;

type ButtonProps = PressableProps & {
  label: string;
  className?: string;
  labelClassName?: string;
  icon?: IoniconName;
  /** Set false to size the button with your own width class instead of w-full. */
  fullWidth?: boolean;
};

/** Solid white button with black uppercase mono label. */
export function PrimaryButton({
  label,
  className = "",
  labelClassName = "",
  icon,
  fullWidth = true,
  ...rest
}: ButtonProps) {
  return (
    <Pressable
      className={`${fullWidth ? "w-full" : ""} flex-row bg-primary border border-primary py-4 px-4 items-center justify-center gap-2 active:opacity-80 ${className}`}
      {...rest}
    >
      {icon && <Ionicons name={icon} size={14} color="#0a0a0b" />}
      <Text
        className={`font-mono-medium text-xs text-background uppercase tracking-widest ${labelClassName}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Outlined button. Border is `muted`, not `hairline` — hairline is a divider
 * color, nearly invisible against the background, and reads as decorative
 * rather than interactive. Buttons need enough contrast to look tappable.
 */
export function GhostButton({
  label,
  className = "",
  labelClassName = "",
  icon,
  fullWidth = true,
  ...rest
}: ButtonProps) {
  return (
    <Pressable
      className={`${fullWidth ? "w-full" : ""} flex-row bg-surface-container-low border border-muted py-4 px-4 items-center justify-center gap-2 active:opacity-70 active:border-accent active:bg-surface-container ${className}`}
      {...rest}
    >
      {icon && <Ionicons name={icon} size={14} color="#e5e2e3" />}
      <Text
        className={`font-mono-medium text-xs text-on-surface uppercase tracking-widest ${labelClassName}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
