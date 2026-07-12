import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const TYPE_DURATION_MS = 380;
const TICK_MS = 60;

function formatElapsed(ms: number | null): string {
  if (ms === null) return "--:--.--";
  const totalCentis = Math.floor(Math.max(0, ms) / 10);
  const seconds = Math.floor(totalCentis / 100);
  const centis = totalCentis % 100;
  return `${String(seconds).padStart(2, "0")}:${String(centis).padStart(2, "0")}`;
}

/**
 * Terminal-style execution log: each step gets its own timestamp (captured the
 * moment it becomes active, blank "--:--.--" until reached), the active line
 * reveals with a typewriter effect, and completed lines get a checkmark that
 * pops in rather than appearing instantly. Mirrors the original forensic
 * "EXECUTION SEQUENCE" mockup — real timestamps, not decoration.
 */
export default function TerminalLog({
  steps,
  currentIndex,
}: {
  steps: string[];
  currentIndex: number;
}) {
  const startTimeRef = useRef(Date.now());
  const stepTimesRef = useRef<(number | null)[]>(steps.map(() => null));
  const [, forceTick] = useState(0);
  const [typedLength, setTypedLength] = useState(0);
  const checkAnims = useRef(steps.map(() => new Animated.Value(0))).current;
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => {
      reduceMotionRef.current = v;
    });
  }, []);

  // Live clock while any step is still pending or active.
  useEffect(() => {
    if (currentIndex >= steps.length) return;
    const id = setInterval(() => forceTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [currentIndex, steps.length]);

  // Stamp the moment each step first becomes active, and animate the
  // checkmark of whichever step just completed.
  useEffect(() => {
    if (currentIndex < steps.length && stepTimesRef.current[currentIndex] === null) {
      stepTimesRef.current[currentIndex] = Date.now() - startTimeRef.current;
    }
    const justCompleted = currentIndex - 1;
    if (justCompleted >= 0) {
      const anim = checkAnims[justCompleted];
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: reduceMotionRef.current ? 0 : 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [currentIndex]);

  // Typewriter reveal for the active line.
  useEffect(() => {
    setTypedLength(0);
    const label = steps[currentIndex];
    if (!label) return;
    if (reduceMotionRef.current) {
      setTypedLength(label.length);
      return;
    }
    const stepMs = Math.max(10, TYPE_DURATION_MS / label.length);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTypedLength(i);
      if (i >= label.length) clearInterval(id);
    }, stepMs);
    return () => clearInterval(id);
  }, [currentIndex, steps]);

  return (
    <View className="bg-[#0a0a0b] border border-hairline p-3 gap-2">
      {steps.map((label, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const pending = i > currentIndex;
        const timestamp = formatElapsed(stepTimesRef.current[i]);

        return (
          <View key={label} className="flex-row items-center gap-2">
            <Text
              className={`font-mono text-[9px] ${pending ? "text-on-surface-variant/40" : "text-on-surface-variant"}`}
            >
              [{timestamp}]
            </Text>
            <Text
              className={`flex-1 font-mono text-[10px] uppercase tracking-wide ${
                pending ? "text-on-surface-variant/40" : done ? "text-on-surface" : "text-primary"
              }`}
            >
              {active ? label.slice(0, typedLength) : label}
              {active && (
                <Text className="text-accent">
                  {typedLength < label.length ? "▍" : "..."}
                </Text>
              )}
            </Text>
            {done && (
              <Animated.View
                style={{
                  opacity: checkAnims[i],
                  transform: [
                    {
                      scale: checkAnims[i].interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.4, 1],
                      }),
                    },
                  ],
                }}
              >
                <Ionicons name="checkmark" size={12} color="#22c55e" />
              </Animated.View>
            )}
          </View>
        );
      })}
    </View>
  );
}
