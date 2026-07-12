import { Pressable, Text, type PressableProps } from "react-native";

type ButtonProps = PressableProps & {
  label: string;
  className?: string;
  labelClassName?: string;
  /** Set false to size the button with your own width class instead of w-full. */
  fullWidth?: boolean;
};

/** Solid white button with black uppercase mono label. */
export function PrimaryButton({
  label,
  className = "",
  labelClassName = "",
  fullWidth = true,
  ...rest
}: ButtonProps) {
  return (
    <Pressable
      className={`${fullWidth ? "w-full" : ""} bg-primary border border-primary py-4 items-center justify-center active:opacity-80 ${className}`}
      {...rest}
    >
      <Text
        className={`font-mono-medium text-xs text-background uppercase tracking-widest ${labelClassName}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Outlined button, grey mono label. */
export function GhostButton({
  label,
  className = "",
  labelClassName = "",
  fullWidth = true,
  ...rest
}: ButtonProps) {
  return (
    <Pressable
      className={`${fullWidth ? "w-full" : ""} border border-hairline py-4 items-center justify-center active:opacity-70 active:border-accent ${className}`}
      {...rest}
    >
      <Text
        className={`font-mono-medium text-xs text-on-surface-variant uppercase tracking-widest ${labelClassName}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
