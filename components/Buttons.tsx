import { Pressable, Text, type PressableProps } from "react-native";

type ButtonProps = PressableProps & { label: string };

/** Full-width solid white button with black uppercase mono label. */
export function PrimaryButton({ label, className = "", ...rest }: ButtonProps & { className?: string }) {
  return (
    <Pressable
      className={`w-full bg-primary border border-primary py-4 items-center justify-center active:opacity-80 ${className}`}
      {...rest}
    >
      <Text className="font-mono-medium text-xs text-background uppercase tracking-widest">
        {label}
      </Text>
    </Pressable>
  );
}

/** Full-width outlined button, grey mono label. */
export function GhostButton({ label, className = "", ...rest }: ButtonProps & { className?: string }) {
  return (
    <Pressable
      className={`w-full border border-hairline py-4 items-center justify-center active:opacity-70 active:border-accent ${className}`}
      {...rest}
    >
      <Text className="font-mono-medium text-xs text-on-surface-variant uppercase tracking-widest">
        {label}
      </Text>
    </Pressable>
  );
}
