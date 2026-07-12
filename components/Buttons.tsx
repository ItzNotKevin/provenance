import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  Text,
  type PressableProps,
} from "react-native";
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
      hitSlop={8}
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

const SCALE_DOWN = 0.97;
const SCALE_MS = 100;
const RELEASE_MS = 140;
const SHEEN_MS = 320;

/**
 * Solid accent-purple button, the app's secondary/repeatable action style
 * (view on explorer, verify another, capture another, etc). Filled + a press
 * sheen instead of an outline — outlines under real thumb pressure on mobile
 * read as "maybe tappable"; a filled surface reads as unambiguous.
 */
export function AccentButton({
  label,
  className = "",
  labelClassName = "",
  icon,
  fullWidth = true,
  onPressIn,
  onPressOut,
  ...rest
}: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const sheen = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => {
      reduceMotion.current = v;
    });
  }, []);

  return (
    <Pressable
      className={`${fullWidth ? "w-full" : ""} ${className}`}
      hitSlop={8}
      onPressIn={(e) => {
        if (!reduceMotion.current) {
          Animated.timing(scale, {
            toValue: SCALE_DOWN,
            duration: SCALE_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
          sheen.setValue(0);
          Animated.timing(sheen, {
            toValue: 1,
            duration: SHEEN_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.timing(scale, {
          toValue: 1,
          duration: RELEASE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View
        className="flex-row bg-accent border border-accent py-4 px-4 items-center justify-center gap-2 overflow-hidden"
        style={{ transform: [{ scale }] }}
      >
        {icon && <Ionicons name={icon} size={14} color="#0a0a0b" />}
        <Text
          className={`font-mono-medium text-xs text-background uppercase tracking-widest ${labelClassName}`}
        >
          {label}
        </Text>
        <Animated.View
          pointerEvents="none"
          className="absolute top-0 bottom-0"
          style={{
            width: 60,
            backgroundColor: "rgba(255,255,255,0.35)",
            transform: [
              { skewX: "-20deg" },
              {
                translateX: sheen.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-80, 360],
                }),
              },
            ],
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

/**
 * Outlined button — reserved for the least-emphasized action on a screen
 * (e.g. dismissing a permission prompt). Border is `muted`, not `hairline`
 * — hairline is a divider color, nearly invisible against the background.
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
      hitSlop={8}
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
