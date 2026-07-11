import { View, type ViewProps } from "react-native";

const MARK_SIZE = 8;
const markStyle = { width: MARK_SIZE, height: MARK_SIZE, pointerEvents: "none" as const };

/** Thin L-shaped forensic registration marks in each corner of its children. */
export default function RegistrationFrame({
  children,
  className = "",
  ...rest
}: ViewProps & { className?: string }) {
  return (
    <View className={`relative ${className}`} {...rest}>
      <View
        style={markStyle}
        className="absolute top-0 left-0 border-t border-l border-accent"
      />
      <View
        style={markStyle}
        className="absolute top-0 right-0 border-t border-r border-accent"
      />
      <View
        style={markStyle}
        className="absolute bottom-0 left-0 border-b border-l border-accent"
      />
      <View
        style={markStyle}
        className="absolute bottom-0 right-0 border-b border-r border-accent"
      />
      {children}
    </View>
  );
}
