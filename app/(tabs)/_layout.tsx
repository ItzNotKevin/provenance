import { Tabs } from "expo-router";
import { Text, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Header from "@/components/Header";

const TAB_ICON: Record<string, string> = {
  capture: "◉",
  verify: "⌕",
  registry: "☰",
};

function TabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-row border-t border-hairline bg-surface"
      style={{ paddingBottom: insets.bottom }}
    >
      {state.routes.map((route: any, index: number) => {
        const { options } = descriptors[route.key];
        const label = options.title ?? route.name;
        const isFocused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            className={`flex-1 h-16 items-center justify-center ${
              isFocused ? "bg-surface-container-low" : ""
            }`}
            style={
              isFocused
                ? { borderTopWidth: 2, borderTopColor: "#c4b5fd" }
                : { borderTopWidth: 2, borderTopColor: "transparent" }
            }
          >
            <Text
              className={`text-[18px] mb-1 ${
                isFocused ? "text-accent" : "text-on-surface-variant"
              }`}
            >
              {TAB_ICON[route.name]}
            </Text>
            <Text
              className={`font-mono text-[9px] uppercase tracking-widest ${
                isFocused ? "text-primary" : "text-on-surface-variant"
              }`}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <View className="flex-1 bg-background">
      <Header />
      <Tabs
        initialRouteName="verify"
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="capture" options={{ title: "CAPTURE" }} />
        <Tabs.Screen name="verify" options={{ title: "VERIFY" }} />
        <Tabs.Screen name="registry" options={{ title: "REGISTRY" }} />
      </Tabs>
    </View>
  );
}
