import { useState } from "react";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { withLayoutContext } from "expo-router";
import { Animated, Text, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Header from "@/components/Header";

const { Navigator } = createMaterialTopTabNavigator();
// Material top tabs (pager-backed) exposed as an expo-router layout: gives
// swipeable screens plus an animated `position` for the indicator.
const MaterialTopTabs = withLayoutContext(Navigator);

type IoniconName = keyof typeof Ionicons.glyphMap;
const TAB_ICON: Record<string, { active: IoniconName; inactive: IoniconName }> = {
  capture: { active: "camera", inactive: "camera-outline" },
  verify: { active: "search", inactive: "search-outline" },
  registry: { active: "list", inactive: "list-outline" },
};

function TabBar({ state, descriptors, navigation, position }: any) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);
  const tabWidth = barWidth / state.routes.length;

  // Slides with taps AND tracks the finger mid-swipe.
  const translateX =
    barWidth > 0
      ? position.interpolate({
          inputRange: state.routes.map((_: any, i: number) => i),
          outputRange: state.routes.map((_: any, i: number) => i * tabWidth),
        })
      : 0;

  return (
    <View
      className="border-t border-hairline bg-surface"
      style={{ paddingBottom: insets.bottom }}
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
    >
      {barWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: -1,
            left: 0,
            width: tabWidth,
            height: 2,
            backgroundColor: "#c4b5fd",
            transform: [{ translateX }],
          }}
        />
      )}
      <View className="flex-row">
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
            >
              <Ionicons
                name={isFocused ? TAB_ICON[route.name].active : TAB_ICON[route.name].inactive}
                size={18}
                color={isFocused ? "#c4b5fd" : "#8e9192"}
                style={{ marginBottom: 4 }}
              />
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
    </View>
  );
}

export default function TabsLayout() {
  return (
    <View className="flex-1 bg-background">
      <Header />
      <MaterialTopTabs
        initialRouteName="verify"
        tabBarPosition="bottom"
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{
          swipeEnabled: true,
          lazy: true,
          sceneStyle: { backgroundColor: "transparent" },
        }}
      >
        <MaterialTopTabs.Screen name="capture" options={{ title: "CAPTURE" }} />
        <MaterialTopTabs.Screen name="verify" options={{ title: "VERIFY" }} />
        <MaterialTopTabs.Screen name="registry" options={{ title: "REGISTRY" }} />
      </MaterialTopTabs>
    </View>
  );
}
